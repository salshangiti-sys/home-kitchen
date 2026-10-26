// Add a recipe, or edit one, with the same template as the OneNote pages. Lines are saved exactly
// as typed; nothing is filled in automatically. Saving checks the recipe's version, so an edit
// made elsewhere in the meantime is never overwritten.
//
// With the recipe notebook linked:
// - a recipe that has a OneNote page is edited in OneNote; here only the app's own fields
//   (tags, planning) can change;
// - a new recipe gets a new page in the notebook, written once: either an empty page with the
//   template headings to fill in OneNote, or the page made from what is typed here.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { href, navigate } from '../router'
import { Button, LinkButton, Notice } from '../ui'
import { listRecipes, loadRecipe, saveRecipe } from './api'
import { docToFields, emptyFields, fieldsToDoc, GROUP_PREFIX, isFromOneNote, planningToDoc, type EditorFields, type TriState } from './editorFields'
import { createPage, libraryLabel, loadLibrary, loadRecipePage, type LibraryInfo, type RecipePage } from './onenote'
import { MEAL_TYPE_LABELS, MEAL_TYPES, STATUS_LABELS, type RecipeDoc, type RecipeStatus } from './types'
import { recipeErrors } from './validate'

export default function RecipeEditor({ id }: { id: string | null }) {
  const [before, setBefore] = useState<{ doc: RecipeDoc; version: number } | null>(null)
  const [fields, setFields] = useState<EditorFields | null>(id ? null : emptyFields())
  const [sections, setSections] = useState<string[]>([])
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [saving, setSaving] = useState(false)
  const [library, setLibrary] = useState<LibraryInfo | null | undefined>(undefined)
  const [page, setPage] = useState<RecipePage | null | undefined>(id ? undefined : null)
  const [blank, setBlank] = useState(true)

  useEffect(() => {
    listRecipes().then(({ recipes }) => setSections([...new Set(recipes.map((r) => r.section))].sort((a, b) => a.localeCompare(b, 'ar'))))
    loadLibrary().then(setLibrary, () => setLibrary(null))
    if (!id) return
    loadRecipePage(id).then(setPage, () => setPage(null))
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
  // planning: the recipe's text is in OneNote. newPage: a new recipe gets a OneNote page.
  const planning = !!(id && page)
  const newPage = !id && !!library
  const sectionNames = newPage ? library.sections.map((s) => s.name) : sections
  const problems = useMemo(() => (fields && !planning ? checkFields(fields, newPage ? library!.sections.map((s) => s.name) : null) : []), [fields, planning, newPage, library])

  if (!fields || library === undefined || page === undefined) return message ? <Notice tone="error">{message.text}</Notice> : <p className="text-muted">جارٍ التحميل…</p>

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      if (planning) {
        await saveRecipe(planningToDoc(fields, before!.doc), before!.version)
        return navigate(href.recipe(id!))
      }
      const typed = newPage && blank ? { ...fields, ingredients: '', steps: '', notes: '', status: fields.sources.trim() ? ('link_only' as const) : ('note_only' as const) } : fields
      const doc = fieldsToDoc(typed, before?.doc ?? null)
      const errors = recipeErrors({ ...doc, id: doc.id || 'new' })
      if (errors.length) throw new Error(`الوصفة لا تطابق المخطط:\n${errors.join('\n')}`)
      if (newPage) {
        const created = await createPage(doc, fields.section.trim(), blank)
        return navigate(href.recipe(created.recipeId))
      }
      const savedId = await saveRecipe(doc, before?.version ?? null)
      navigate(href.recipe(savedId))
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true })
      setSaving(false)
    }
  }

  const imported = before ? isFromOneNote(before.doc) : false
  const showText = !planning && !(newPage && blank)

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <a href={id ? href.recipe(id) : href.library} className="text-sm text-accent">→ رجوع بدون حفظ</a>
      <h2 className="text-2xl font-bold">{planning ? 'الوسوم والتخطيط' : id ? 'تعديل الوصفة' : 'وصفة جديدة'}</h2>

      {planning && (
        <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
          <p dir="auto" className="font-semibold">{fields.title}</p>
          <p className="text-sm text-muted">نص هذه الوصفة في صفحتها في OneNote، ويُعدّل هناك. يقرأ التطبيق الصفحة كلما فتحتِ الوصفة. هنا تعدّلين ما يخص التطبيق فقط.</p>
          {page?.web_url && (
            <div>
              <LinkButton external kind="primary" href={page.web_url}>تعديل في OneNote ↗</LinkButton>
            </div>
          )}
        </div>
      )}

      {!id && !library && (
        <Notice>دفتر الوصفات في OneNote غير مربوط بعد، فستُحفظ الوصفة في التطبيق فقط. <a href={href.onenote} className="underline">اربطي الدفتر</a> لتُنشأ لها صفحة في OneNote.</Notice>
      )}

      {newPage && (
        <fieldset className="flex flex-col gap-2 rounded-2xl border border-line p-4">
          <legend className="px-1 font-semibold">أين تكتبين الوصفة؟</legend>
          <Choice checked={blank} onChange={() => setBlank(true)} title="أنشئ صفحة فارغة في OneNote" hint={`صفحة جديدة في «${libraryLabel(library!)}» بالعنوان والقالب (المصدر، المقادير، الطريقة، ملاحظاتي)، تكملينها في OneNote.`} />
          <Choice checked={!blank} onChange={() => setBlank(false)} title="اكتبيها هنا" hint="تكتبين الوصفة في النموذج، ويُنشئ التطبيق صفحتها في OneNote مرة واحدة. بعدها تُعدّل في OneNote." />
        </fieldset>
      )}

      {!planning && (
        <>
          <Field label="اسم الوصفة">
            <input dir="auto" required value={fields.title} onChange={(e) => set('title', e.target.value)} className={INPUT} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            {newPage ? (
              <Field label="القسم في OneNote">
                <select required value={fields.section} onChange={(e) => set('section', e.target.value)} className={INPUT}>
                  <option value="">اختاري القسم…</option>
                  {sectionNames.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            ) : (
              <Field label="القسم" hint="مثل: سلطات، شوربات، حلويات">
                <input dir="auto" required list="hk-sections" value={fields.section} onChange={(e) => set('section', e.target.value)} className={INPUT} />
                <datalist id="hk-sections">
                  {sectionNames.map((s) => <option key={s} value={s} />)}
                </datalist>
              </Field>
            )}
            {showText && (
              <Field label="نوع الصفحة">
                <select value={fields.status} onChange={(e) => set('status', e.target.value as RecipeStatus)} className={INPUT}>
                  {(Object.keys(STATUS_LABELS) as RecipeStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </Field>
            )}
          </div>

          <TextArea label="المصدر" hint="سطر لكل رابط: «الاسم | الرابط» أو الرابط فقط" rows={2} value={fields.sources} onChange={(v) => set('sources', v)} ltrPlaceholder="https://…" />
        </>
      )}
      {showText && (
        <>
          <TextArea label="المقادير" hint={`سطر لكل مكوّن، كما تكتبينه. سطر يبدأ بـ «${GROUP_PREFIX.trim()}» يبدأ مجموعة، مثل: ${GROUP_PREFIX}الصوص`} rows={7} value={fields.ingredients} onChange={(v) => set('ingredients', v)} />
          <TextArea label="الطريقة" hint="سطر لكل خطوة. الترقيم يُضاف تلقائيًا عند العرض." rows={6} value={fields.steps} onChange={(v) => set('steps', v)} />
          <TextArea label="ملاحظاتي" hint="سطر لكل ملاحظة" rows={3} value={fields.notes} onChange={(v) => set('notes', v)} />
        </>
      )}

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
        {!planning && (
          <Field label="اسم القسم بالإنجليزية" hint="يُستخدم في معرّف الوصفات الجديدة فقط، مثل Salads">
            <input dir="ltr" value={fields.sectionEn} onChange={(e) => set('sectionEn', e.target.value)} className={INPUT} />
          </Field>
        )}
      </fieldset>

      {imported && !planning && (
        <p className="text-sm text-muted">هذه الوصفة مستوردة من OneNote. «النص الأصلي» يبقى كما كان في الصفحة، وتعديلك يُحفظ في الأقسام أعلاه.</p>
      )}
      {problems.length > 0 && <Notice>{problems.join('\n')}</Notice>}
      {message && <Notice tone={message.error ? 'error' : 'plain'}>{message.text}</Notice>}

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-line bg-bg px-4 py-3">
        <Button type="submit" disabled={saving || problems.length > 0}>
          {saving ? 'جارٍ الحفظ…' : newPage ? (blank ? 'أنشئي الصفحة في OneNote' : 'احفظي وأنشئي الصفحة') : 'احفظ'}
        </Button>
      </div>
    </form>
  )
}

// oneNoteSections: for a new page, the section has to be one of the notebook's sections.
function checkFields(fields: EditorFields, oneNoteSections: string[] | null): string[] {
  const problems: string[] = []
  if (!fields.title.trim()) problems.push('اكتبي اسم الوصفة.')
  if (oneNoteSections ? !oneNoteSections.includes(fields.section) : !fields.section.trim()) {
    problems.push(oneNoteSections ? 'اختاري قسم OneNote الذي تُنشأ فيه الصفحة.' : 'اختاري القسم أو اكتبي قسمًا جديدًا.')
  }
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

function Choice({ checked, onChange, title, hint }: { checked: boolean; onChange: () => void; title: string; hint: string }) {
  return (
    <label className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${checked ? 'border-accent' : 'border-line'}`}>
      <input type="radio" name="hk-where" className="mt-1 accent-[var(--accent)]" checked={checked} onChange={onChange} />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-sm text-muted">{hint}</span>
      </span>
    </label>
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
