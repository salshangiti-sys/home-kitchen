// «القاموس»: the ingredient names the app does not know yet (found in the recipes' ingredient lines),
// with a way to teach each one: "the same as" a name the dictionary knows, or "an item of its own" in a
// shop aisle. What is taught applies at once to the shopping list, the order of a recipe's ingredients
// and the search by main ingredient. It never changes a recipe or OneNote. Owners and editors teach.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { href } from '../router'
import { Button, LinkButton, Notice } from '../ui'
import { loadIngredientLines } from '../library/mainIngredient'
import { AISLE_CHOICES, SAME_AS, forget, lessonMessage, loadLessons, teach, unknownNames, type Lesson } from './lessons'
import { useLessonsVersion, useReloadLessons } from './LessonsContext'

export interface DictionaryApi {
  loadIngredientLines: typeof loadIngredientLines
  loadLessons: typeof loadLessons
  teach: typeof teach
  forget: typeof forget
}

const real: DictionaryApi = { loadIngredientLines, loadLessons, teach, forget }
const SHOWN = 40

interface Props {
  canEdit: boolean
  api?: DictionaryApi
  onChanged?: () => void // tests; the app reloads the lessons through its context
}

export default function DictionaryPage({ canEdit, api = real, onChanged }: Props) {
  const version = useLessonsVersion()
  const reload = useReloadLessons()
  const [lines, setLines] = useState<Record<string, string[]> | null>(null)
  const [lessons, setLessonList] = useState<Lesson[]>([])
  const [error, setError] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [l, ls] = await Promise.all([api.loadIngredientLines(), api.loadLessons()])
      setLines(l)
      setLessonList(ls)
      setError(null)
    } catch (e) {
      setError(lessonMessage(e))
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load, version])

  // The unknown names are worked out with the lessons already taught (the catalog holds them).
  const unknown = useMemo(() => (lines ? unknownNames(lines) : []), [lines, version, lessons]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (key: string, choice: string) => {
    const [kind, value] = [choice.slice(0, choice.indexOf(':')), choice.slice(choice.indexOf(':') + 1)]
    setBusy(key)
    setError(null)
    try {
      if (kind === 'same') {
        const known = SAME_AS.find((s) => s.name === value)
        await api.teach(key, value, (known?.aisle === 'none' ? 'other' : known?.aisle) ?? 'other')
      } else {
        await api.teach(key, null, value as Lesson['aisle'])
      }
      reload()
      onChanged?.()
      await load()
    } catch (e) {
      setError(lessonMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const remove = async (key: string) => {
    setBusy(key)
    setError(null)
    try {
      await api.forget(key)
      reload()
      onChanged?.()
      await load()
    } catch (e) {
      setError(lessonMessage(e))
    } finally {
      setBusy(null)
    }
  }

  if (!lines) return error ? <Notice tone="error">{error}</Notice> : <p className="text-muted">جارٍ التحميل…</p>

  const list = more ? unknown : unknown.slice(0, SHOWN)

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-2xl font-bold">القاموس</h2>
      <p className="text-sm text-muted">
        أسماء في مقادير وصفاتك لا يعرفها التطبيق، فتظهر في المقاضي أصنافًا قائمة بذاتها. علّميه أنها «نفس» صنف يعرفه (مثل «فلفل هالبينو» = «فلفل حار») أو صنف مستقل في قسم من السوق. لا يتغير نص أي وصفة ولا OneNote.
      </p>
      <div>
        <LinkButton href={href.shopping()}>← إلى المقاضي</LinkButton>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {!canEdit && <Notice>التعليم للمحررات فقط. ترين هنا ما عُلِّم.</Notice>}

      {unknown.length === 0 ? (
        <Notice>كل الأسماء في المقادير معروفة للتطبيق.</Notice>
      ) : (
        <section aria-label="أسماء غير معروفة" className="flex flex-col gap-2">
          <h3 className="text-lg font-semibold">أسماء لا يعرفها التطبيق ({unknown.length})</h3>
          <ul className="flex flex-col gap-2">
            {list.map((u) => (
              <UnknownRow key={u.key} item={u} canEdit={canEdit} busy={busy === u.key} onSave={(choice) => void save(u.key, choice)} />
            ))}
          </ul>
          {!more && unknown.length > SHOWN && <Button kind="plain" onClick={() => setMore(true)}>أرني الباقي ({unknown.length - SHOWN})</Button>}
        </section>
      )}

      {lessons.length > 0 && (
        <section aria-label="ما علّمتِه" className="flex flex-col gap-2">
          <h3 className="text-lg font-semibold">ما علّمتِه ({lessons.length})</h3>
          <ul className="flex flex-col gap-2">
            {lessons.map((l) => (
              <li key={l.name_key} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface p-3">
                <span dir="auto">
                  <strong>{l.name_key}</strong> <span className="text-muted">← {l.target ? `نفس «${l.target}»` : `صنف مستقل (${AISLE_CHOICES.find((a) => a.aisle === l.aisle)?.label})`}</span>
                </span>
                {canEdit && <Button kind="plain" disabled={busy === l.name_key} onClick={() => void remove(l.name_key)}>أزيليه</Button>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function UnknownRow({ item, canEdit, busy, onSave }: { item: { key: string; label: string; recipes: number; example: string }; canEdit: boolean; busy: boolean; onSave: (choice: string) => void }) {
  const [choice, setChoice] = useState('')
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
      <span dir="auto" className="font-medium">{item.label}</span>
      <span dir="auto" className="text-sm text-muted">في {item.recipes === 1 ? 'وصفة واحدة' : `${item.recipes} وصفات`} · مثل: {item.example}</span>
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium">
            هذا الاسم
            <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label={`تعليم ${item.label}`} className="min-h-11 rounded-xl border border-line bg-bg px-3 text-base font-normal">
              <option value="">اختاري…</option>
              <optgroup label="نفس صنف يعرفه التطبيق">
                {SAME_AS.map((s) => (
                  <option key={s.name} value={`same:${s.name}`}>{s.name}</option>
                ))}
              </optgroup>
              <optgroup label="صنف مستقل في قسم">
                {AISLE_CHOICES.map((a) => (
                  <option key={a.aisle} value={`aisle:${a.aisle}`}>{a.label}</option>
                ))}
              </optgroup>
            </select>
          </label>
          <Button disabled={busy || choice === ''} onClick={() => onSave(choice)}>احفظي</Button>
        </div>
      )}
    </li>
  )
}
