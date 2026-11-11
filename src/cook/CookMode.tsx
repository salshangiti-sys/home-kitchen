// Cook mode: the recipe for standing at the stove. Big text, one step at a time, ingredients you
// can tick off, the screen kept awake, and none of the app's menus in the way. It works from the
// copy saved on the device, so it opens with no signal. Your place is remembered until you finish.

import { useEffect, useState } from 'react'
import { loadRecipe as defaultLoad, type LoadedRecipe } from '../library/api'
import { explain } from '../offline/readThrough'
import { href, navigate } from '../router'
import { Button, Notice } from '../ui'
import { SIZES, clampSize, clampStep, clearProgress, ingredientKey, loadProgress, loadSize, saveProgress, saveSize, type CookView, type Progress } from './cookState'
import { keepScreenAwake, type WakeState } from './wakeLock'
import type { RecipeDoc } from '../library/types'

const VIEW_LABELS: Record<CookView, string> = { ingredients: 'المقادير', steps: 'الخطوات', notes: 'ملاحظاتي' }

export default function CookMode({ id, load = defaultLoad }: { id: string; load?: (id: string) => Promise<LoadedRecipe | null> }) {
  const [loaded, setLoaded] = useState<LoadedRecipe | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    load(id).then(setLoaded, (e: unknown) => setError(explain(e).message))
  }, [id, load])

  if (error) return <Back><Notice tone="error">{error}</Notice></Back>
  if (loaded === undefined) return <p className="text-muted">جارٍ التحميل…</p>
  if (loaded === null) return <Back><Notice>لم تُعثر على هذه الوصفة.</Notice></Back>
  return <Cooking id={id} doc={loaded.doc} />
}

function Back({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <a href={href.library} className="text-accent">→ كل الوصفات</a>
      {children}
    </div>
  )
}

function Cooking({ id, doc }: { id: string; doc: RecipeDoc }) {
  const steps = [...doc.steps].sort((a, b) => a.order - b.order)
  const groups = doc.ingredient_groups.filter((group) => group.items.length)
  const views: CookView[] = [groups.length && 'ingredients', steps.length && 'steps', doc.notes.length && 'notes'].filter(Boolean) as CookView[]
  const total = groups.reduce((sum, group) => sum + group.items.length, 0)

  const [progress, setProgress] = useState<Progress>(() => {
    const saved = loadProgress(id, steps.length)
    return { step: saved?.step ?? 0, checked: saved?.checked ?? [], view: saved && views.includes(saved.view) ? saved.view : (views[0] ?? 'steps') }
  })
  const [size, setSize] = useState(loadSize)
  const [wake, setWake] = useState<WakeState | null>(null) // unknown until the device answers

  useEffect(() => saveProgress(id, progress), [id, progress])
  useEffect(() => {
    const awake = keepScreenAwake(setWake)
    return () => awake.release()
  }, [])

  const text = SIZES[size]
  const step = clampStep(progress.step, steps.length)
  const last = step === steps.length - 1
  const move = (delta: number) => setProgress((p) => ({ ...p, step: clampStep(p.step + delta, steps.length) }))
  const show = (view: CookView) => setProgress((p) => ({ ...p, view }))
  const resize = (next: number) => {
    setSize(clampSize(next))
    saveSize(next)
  }
  const tick = (key: string) =>
    setProgress((p) => ({ ...p, checked: p.checked.includes(key) ? p.checked.filter((k) => k !== key) : [...p.checked, key] }))
  const finish = () => {
    clearProgress(id)
    navigate(href.recipe(id))
  }

  // The page is right to left, so "next" is toward the left.
  useEffect(() => {
    if (progress.view !== 'steps') return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') move(1)
      if (event.key === 'ArrowRight') move(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [progress.view, steps.length])

  const ticked = groups.flatMap((group, g) => group.items.map((_, i) => ingredientKey(g, i))).filter((key) => progress.checked.includes(key)).length

  return (
    <div className="flex min-h-[85dvh] flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <a href={href.recipe(id)} className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-sm font-medium">→ خروج</a>
        <div role="group" aria-label="حجم الخط" className="flex gap-1">
          <button type="button" aria-label="تصغير الخط" disabled={size === 0} onClick={() => resize(size - 1)} className="min-h-11 min-w-11 rounded-xl border border-line text-sm font-medium disabled:opacity-40">أ-</button>
          <button type="button" aria-label="تكبير الخط" disabled={size === SIZES.length - 1} onClick={() => resize(size + 1)} className="min-h-11 min-w-11 rounded-xl border border-line text-lg font-medium disabled:opacity-40">أ+</button>
        </div>
      </div>

      <h2 dir="auto" className="text-xl font-bold leading-snug">{doc.title}</h2>

      {views.length > 1 && (
        <div role="tablist" className="flex gap-1 rounded-xl border border-line bg-surface p-1">
          {views.map((view) => (
            <button
              key={view}
              type="button"
              role="tab"
              aria-selected={progress.view === view}
              onClick={() => show(view)}
              className={`min-h-11 flex-1 rounded-lg px-2 text-base font-medium ${progress.view === view ? 'bg-accent text-on-accent' : 'text-muted'}`}
            >
              {VIEW_LABELS[view]}
            </button>
          ))}
        </div>
      )}

      {views.length === 0 && <Notice>ليس في هذه الوصفة مقادير ولا خطوات لعرضها هنا.</Notice>}

      {progress.view === 'ingredients' && groups.length > 0 && (
        <section className="flex flex-col gap-4" aria-label="المقادير">
          <p className="text-sm text-muted">جهّزتِ {ticked} من {total}</p>
          {groups.map((group, g) => (
            <div key={g} className="flex flex-col gap-1">
              {group.name !== null && <h3 dir="auto" className="text-lg font-semibold text-muted">{group.name}</h3>}
              {group.items.map((item, i) => {
                const key = ingredientKey(g, i)
                const done = progress.checked.includes(key)
                return (
                  <label key={key} className="flex min-h-14 cursor-pointer items-center gap-4 rounded-2xl border border-line bg-surface px-4 py-3">
                    <input type="checkbox" checked={done} onChange={() => tick(key)} className="size-7 shrink-0 accent-[var(--accent)]" />
                    <span dir="auto" className={`${text} leading-snug ${done ? 'text-muted line-through' : ''}`}>{item.text}</span>
                  </label>
                )
              })}
            </div>
          ))}
          {steps.length > 0 && <Button onClick={() => show('steps')}>ابدئي الخطوات</Button>}
        </section>
      )}

      {progress.view === 'steps' && steps.length > 0 && (
        <section className="flex flex-1 flex-col gap-4" aria-label="الخطوات">
          <div className="flex items-center justify-between text-sm text-muted">
            <span>الخطوة {step + 1} من {steps.length}</span>
          </div>
          <div role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={step + 1} className="h-2 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-accent transition-all" style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
          </div>
          <p dir="auto" className={`${text} flex-1 py-4 font-medium leading-relaxed`}>{steps[step].text}</p>
          {!last && <p dir="auto" className="text-sm text-muted">بعدها: {steps[step + 1].text}</p>}
          <div className="sticky bottom-0 -mx-4 flex gap-3 border-t border-line bg-bg px-4 py-3">
            <button type="button" disabled={step === 0} onClick={() => move(-1)} className="min-h-16 flex-1 rounded-2xl border border-line text-xl font-semibold disabled:opacity-40">السابقة</button>
            {last ? (
              <button type="button" onClick={finish} className="min-h-16 flex-[2] rounded-2xl bg-accent text-xl font-semibold text-on-accent">تم الطبخ ✓</button>
            ) : (
              <button type="button" onClick={() => move(1)} className="min-h-16 flex-[2] rounded-2xl bg-accent text-xl font-semibold text-on-accent">التالية</button>
            )}
          </div>
        </section>
      )}

      {progress.view === 'notes' && doc.notes.length > 0 && (
        <section className="flex flex-col gap-3" aria-label="ملاحظاتي">
          {doc.notes.map((note, i) => (
            <p key={i} dir="auto" className={`${text} rounded-2xl border border-line bg-surface px-4 py-3 leading-relaxed`}>{note}</p>
          ))}
        </section>
      )}

      <p className="text-center text-xs text-muted">
        {wake === 'on' && 'الشاشة تبقى مضاءة أثناء الطبخ.'}
        {wake === 'unsupported' && 'هذا الجهاز لا يدعم إبقاء الشاشة مضاءة. اضبطي مهلة الشاشة من إعدادات الجهاز.'}
        {wake === 'off' && 'تعذّر إبقاء الشاشة مضاءة الآن.'}
      </p>
    </div>
  )
}
