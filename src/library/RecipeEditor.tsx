// Add a recipe, or edit one, with the same template as the OneNote pages. Lines are saved exactly
// as typed; nothing is filled in automatically. Saving checks the recipe's version, so an edit
// made elsewhere in the meantime is never overwritten.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { href, navigate } from '../router'
import { Button, Notice } from '../ui'
import { listRecipes, loadRecipe, saveRecipe } from './api'
import { docToFields, emptyFields, fieldsToDoc, GROUP_PREFIX, isFromOneNote, type EditorFields, type TriState } from './editorFields'
import { MEAL_TYPE_LABELS, MEAL_TYPES, STATUS_LABELS, type RecipeDoc, type RecipeStatus } from './types'
import { recipeErrors } from './validate'

export default function RecipeEditor({ id }: { id: string | null }) {
  const [before, setBefore] = useState<{ doc: RecipeDoc; version: number } | null>(null)
  const [fields, setFields] = useState<EditorFields | null>(id ? null : emptyFields())
  const [sections, setSections] = useState<string[]>([])
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    listRecipes().then(({ recipes }) => setSections([...new Set(recipes.map((r) => r.section))].sort((a, b) => a.localeCompare(b, 'ar'))))
    if (!id) return
    loadRecipe(id).then(
      (loaded) => {
        if (!loaded) return setMessage({ text: 'لم تُعثر على هذه الوصفة.', error: true })
        setBefore({ doc: loaded.doc, version: loaded.version })
        setFields(docToFields(loaded.doc))
      },
      (e: Error) => setMessage({ text: e.message, error: true }),
    )
  }, [id])

  const set = <K extends keyof EditorFields>(key: K, value: EditorFields[K]) => setFields((f) => (f ? { ...f, [key]: value } : f))
  const problems = useMemo(() => (fields ? checkFields(fields) : []), [fields])

  if (!fields) return message ? <Notice tone="error">{message.text}</Notice> : <p className="text-muted">جارٍ التحميل…</p>

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const doc = fieldsToDoc(fields, before?.doc ?? null)
      const errors = recipeErrors({ ...doc, id: doc.id || 'new' })
      if (errors.length) throw new Error(`الوصفة لا تطابق المخطط:\n${errors.join('\n')}`)
      const savedId = await saveRecipe(doc, before?.version ?? null)
      navigate(href.recipe(savedId))
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true })
      setSaving(false)
    }
  }

  const imported = before ? isFromOneNote(before.doc) : false

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <a href={id ? href.recipe(id) : href.library} className="text-sm text-accent">→ رجوع بدون حفظ</a>
      <h2 className="text-2xl font-bold">{id ? 'تعديل الوصفة' : 'وصفة جديدة'}</h2>

      <Field label="اسم الوصفة">
        <input dir="auto" required value={fields.title} onChange={(e) => set('title', e.target.value)} className={INPUT} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="القسم" hint="مثل: سلطات، شوربات، حلويات">
          <input dir="auto" required list="hk-sections" value={fields.section} onChange={(e) => set('section', e.target.value)} className={INPUT} />
          <datalist id="hk-sections">
            {sections.map((s) => <option key={s} value={s} />)}
          </datalist>
        </Field>
        <Field label="نوع الصفحة">
          <select value={fields.status} onChange={(e) => set('status', e.target.value as RecipeStatus)} className={INPUT}>
            {(Object.keys(STATUS_LABELS) as RecipeStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </Field>
      </div>

      <TextArea label="المصدر" hint="سطر لكل رابط: «الاسم | الرابط» أو الرابط فقط" rows={2} value={fields.sources} onChange={(v) => set('sources', v)} ltrPlaceholder="https://…" />
      <TextArea label="المقادير" hint={`سطر لكل مكوّن، كما تكتبينه. سطر يبدأ بـ «${GROUP_PREFIX.trim()}» يبدأ مجموعة، مثل: ${GROUP_PREFIX}الصوص`} rows={7} value={fields.ingredients} onChange={(v) => set('ingredients', v)} />
      <TextArea label="الطريقة" hint="سطر لكل خطوة. الترقيم يُضاف تلقائيًا عند العرض." rows={6} value={fields.steps} onChange={(v) => set('steps', v)} />
      <TextArea label="ملاحظاتي" hint="سطر لكل ملاحظة" rows={3} value={fields.notes} onChange={(v) => set('notes', v)} />

      <fieldset className="flex flex-col gap-4 rounded-2xl border border-line p-4">
        <legend className="px-1 font-semibold">للتخطيط (اختياري)</legend>
        <div className="flex flex-wrap gap-2">
          {MEAL_TYPES.map((type) => {
            const on = fields.mealTypes.includes(type)
            return (
              <label key={type} className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm ${on ? 'border-accent text-accent' : 'border-line'}`}>
                <input
                  type="checkbox"
                  className="accent-[var(--accent)]"
                  checked={on}
                  onChange={() => set('mealTypes', on ? fields.mealTypes.filter((t) => t !== type) : [...fields.mealTypes, type])}
                />
                {MEAL_TYPE_LABELS[type]}
              </label>
            )
          })}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Tri label="مناسبة للأطفال" value={fields.kidFriendly} onChange={(v) => set('kidFriendly', v)} />
          <Tri label="تصلح للانش بوكس" value={fields.lunchbox} onChange={(v) => set('lunchbox', v)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="عدد الحصص"><input inputMode="decimal" value={fields.servings} onChange={(e) => set('servings', e.target.value)} className={INPUT} /></Field>
          <Field label="التحضير (دقيقة)"><input inputMode="numeric" value={fields.prepTime} onChange={(e) => set('prepTime', e.target.value)} className={INPUT} /></Field>
          <Field label="الطبخ (دقيقة)"><input inputMode="numeric" value={fields.cookTime} onChange={(e) => set('cookTime', e.target.value)} className={INPUT} /></Field>
        </div>
        <Field label="وسوم خاصة" hint="افصلي بينها بفاصلة، مثل: شتوي، سريع">
          <input dir="auto" value={fields.customTags} onChange={(e) => set('customTags', e.target.value)} className={INPUT} />
        </Field>
        <Field label="اسم القسم بالإنجليزية" hint="يُستخدم في معرّف الوصفات الجديدة فقط، مثل Salads">
          <input dir="ltr" value={fields.sectionEn} onChange={(e) => set('sectionEn', e.target.value)} className={INPUT} />
        </Field>
      </fieldset>

      {imported && (
        <p className="text-sm text-muted">هذه الوصفة مستوردة من OneNote. «النص الأصلي» يبقى كما كان في الصفحة، وتعديلك يُحفظ في الأقسام أعلاه.</p>
      )}
      {problems.length > 0 && <Notice>{problems.join('\n')}</Notice>}
      {message && <Notice tone={message.error ? 'error' : 'plain'}>{message.text}</Notice>}

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-line bg-bg px-4 py-3">
        <Button type="submit" disabled={saving || problems.length > 0}>{saving ? 'جارٍ الحفظ…' : 'احفظ'}</Button>
      </div>
    </form>
  )
}

function checkFields(fields: EditorFields): string[] {
  const problems: string[] = []
  if (!fields.title.trim()) problems.push('اكتبي اسم الوصفة.')
  if (!fields.section.trim()) problems.push('اختاري القسم أو اكتبي قسمًا جديدًا.')
  const badLinks = fields.sources
    .split('\n')
    .map((line) => line.split('|').at(-1)!.trim())
    .filter((url) => url && !/^https?:\/\//i.test(url))
  if (badLinks.length) problems.push(`هذه الأسطر في «المصدر» ليست روابط تبدأ بـ http: ${badLinks.join('، ')}`)
  return problems
}

const INPUT = 'min-h-11 w-full rounded-xl border border-line bg-bg px-3'

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  )
}

function TextArea({ label, hint, rows, value, onChange, ltrPlaceholder }: { label: string; hint: string; rows: number; value: string; onChange: (v: string) => void; ltrPlaceholder?: string }) {
  return (
    <Field label={label} hint={hint}>
      <textarea dir="auto" rows={rows} value={value} placeholder={ltrPlaceholder} onChange={(e) => onChange(e.target.value)} className="w-full rounded-xl border border-line bg-bg p-3 leading-relaxed" />
    </Field>
  )
}

function Tri({ label, value, onChange }: { label: string; value: TriState; onChange: (v: TriState) => void }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value as TriState)} className={INPUT}>
        <option value="unknown">غير محدد</option>
        <option value="yes">نعم</option>
        <option value="no">لا</option>
      </select>
    </Field>
  )
}
