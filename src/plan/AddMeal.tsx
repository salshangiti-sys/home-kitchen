// Adding a meal to a day and slot: pick a recipe (searching the library) or write free text, with
// optional servings and the people it is for.

import { useEffect, useMemo, useState } from 'react'
import { Button } from '../ui'
import { matchesQuery, normalizeAr } from '../library/normalize'
import type { RecipeSummary } from '../library/api'
import type { NewMeal, Person } from './api'

interface Props {
  day: string
  slot: string
  people: Person[]
  loadRecipes: () => Promise<RecipeSummary[]>
  busy: boolean
  onAdd: (meal: NewMeal) => void
  onCancel: () => void
}

export default function AddMeal({ day, slot, people, loadRecipes, busy, onAdd, onCancel }: Props) {
  const [mode, setMode] = useState<'recipe' | 'text'>('recipe')
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<RecipeSummary | null>(null)
  const [text, setText] = useState('')
  const [servings, setServings] = useState('')
  const [chosen, setChosen] = useState<string[]>([])

  useEffect(() => {
    loadRecipes().then(setRecipes, () => setRecipes([]))
  }, [loadRecipes])

  const found = useMemo(
    () => (recipes ?? []).filter((r) => matchesQuery(r.search_norm || normalizeAr(r.title), query)).slice(0, 8),
    [recipes, query],
  )
  const ready = mode === 'recipe' ? picked !== null : text.trim() !== ''
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-accent p-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ready) return
        onAdd({
          day,
          slot,
          recipeId: mode === 'recipe' ? picked!.id : null,
          freeText: mode === 'text' ? text.trim() : null,
          servings: servings.trim() === '' ? null : Number(servings),
          people: chosen,
        })
      }}
    >
      <div role="tablist" className="flex gap-1 rounded-xl border border-line bg-surface p-1">
        {([['recipe', 'وصفة'], ['text', 'نص حر']] as const).map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => setMode(value)} className={`min-h-11 flex-1 rounded-lg px-2 text-sm font-medium ${mode === value ? 'bg-accent text-on-accent' : 'text-muted'}`}>
            {label}
          </button>
        ))}
      </div>

      {mode === 'recipe' ? (
        <div className="flex flex-col gap-2">
          {picked ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2">
              <span dir="auto" className="font-medium">{picked.title}</span>
              <Button kind="plain" onClick={() => setPicked(null)}>غيّري</Button>
            </div>
          ) : (
            <>
              <input type="search" dir="auto" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحثي عن وصفة…" aria-label="بحث عن وصفة" className="min-h-11 rounded-xl border border-line bg-bg px-3 text-base" />
              {recipes === null && <p className="text-sm text-muted">جارٍ التحميل…</p>}
              {recipes !== null && recipes.length === 0 && <p className="text-sm text-muted">لا وصفات في المكتبة بعد. يمكنك كتابة نص حر.</p>}
              {recipes !== null && recipes.length > 0 && found.length === 0 && <p className="text-sm text-muted">لا نتائج.</p>}
              <ul className="flex flex-col gap-1">
                {found.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => setPicked(r)} className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-line px-3 text-start">
                      <span dir="auto" className="truncate">{r.title}</span>
                      <span dir="auto" className="shrink-0 text-xs text-muted">{r.section}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : (
        <label className="flex flex-col gap-1 text-sm font-medium">
          الوجبة
          <input dir="auto" maxLength={120} value={text} onChange={(e) => setText(e.target.value)} placeholder="مثال: أرز أبيض وسلطة" className="min-h-11 rounded-xl border border-line bg-bg px-3 text-base font-normal" />
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm font-medium">
        عدد الحصص (اختياري)
        <input type="number" min="1" max="100" step="any" inputMode="decimal" value={servings} onChange={(e) => setServings(e.target.value)} className="min-h-11 rounded-xl border border-line bg-bg px-3 text-base font-normal" />
      </label>

      {people.length > 0 && (
        <fieldset className="flex flex-wrap gap-2">
          <legend className="mb-1 text-sm font-medium">لمن؟ (اختياري)</legend>
          {people.map((p) => (
            <label key={p.id} className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm">
              <input type="checkbox" checked={chosen.includes(p.id)} onChange={() => toggle(p.id)} className="size-5 accent-[var(--accent)]" />
              {p.name}
            </label>
          ))}
        </fieldset>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !ready}>أضيفي إلى الخطة</Button>
        <Button kind="plain" onClick={onCancel}>إلغاء</Button>
      </div>
    </form>
  )
}
