// "مراجعة المقادير": for the recipes whose page has no ingredient lines, the ingredients proposed from
// the recipe's own text. Each line is confirmed, corrected, or ignored by an owner or editor. Nothing
// proposed is used (shopping list, prep tasks) until it is confirmed. Readers see, and cannot change.

import { useCallback, useEffect, useState } from 'react'
import { href } from '../router'
import { Badge, Button, Notice } from '../ui'
import {
  addIngredient,
  confirmAll,
  groupReview,
  ingredientMessage,
  loadReview,
  setSuggestion,
  type ReviewData,
  type ReviewGroup,
  type Suggestion,
} from './api'

export interface ReviewApi {
  loadReview: typeof loadReview
  setSuggestion: typeof setSuggestion
  addIngredient: typeof addIngredient
  confirmAll: typeof confirmAll
}

const real: ReviewApi = { loadReview, setSuggestion, addIngredient, confirmAll }

const STATUS_LABEL = { suggested: 'مقترح', confirmed: 'مؤكَّد', ignored: 'متجاهَل' } as const

export default function ReviewPage({ canEdit, api = real }: { canEdit: boolean; api?: ReviewApi }) {
  const [data, setData] = useState<ReviewData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setData(await api.loadReview())
    } catch (e) {
      setError(ingredientMessage(e))
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
      await load()
    } catch (e) {
      setError(ingredientMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (!data) return error ? <Notice tone="error">{error}</Notice> : <p className="text-muted">جارٍ التحميل…</p>

  const { waiting, done } = groupReview(data)
  const lines = waiting.reduce((n, g) => n + g.waiting, 0)

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-2xl font-bold">مراجعة المقادير</h2>
      <p className="leading-relaxed text-muted">
        هذه وصفات ليست في صفحتها سطور مقادير، فاقترحتُ مقاديرها من نص الوصفة نفسه. <strong>لا يدخل شيء منها قائمة المقاضي ولا التجهيز قبل أن تؤكديه.</strong> يمكنك تأكيد السطر أو تصحيحه أو تجاهله، وإضافة ما فاتني. ولا تتغير صفحة OneNote.
      </p>
      {error && <Notice tone="error">{error}</Notice>}

      {waiting.length === 0 ? (
        <Notice>{done.length ? 'راجعتِ كل المقترحات.' : 'لا مقترحات بعد.'}</Notice>
      ) : (
        <p className="text-sm text-muted">{waiting.length} وصفة بانتظار المراجعة · {lines} مقدارًا</p>
      )}

      <ul className="flex flex-col gap-4">
        {waiting.map((group) => (
          <Group key={group.recipe.id} group={group} canEdit={canEdit} busy={busy} api={api} act={act} />
        ))}
      </ul>

      {done.length > 0 && (
        <details className="p-4 rounded-3xl bg-surface shadow-sm ring-1 ring-line">
          <summary className="cursor-pointer font-medium">تمت مراجعتها ({done.length})</summary>
          <ul className="mt-3 flex flex-col gap-4">
            {done.map((group) => (
              <Group key={group.recipe.id} group={group} canEdit={canEdit} busy={busy} api={api} act={act} />
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function Group({ group, canEdit, busy, api, act }: { group: ReviewGroup; canEdit: boolean; busy: boolean; api: ReviewApi; act: (work: () => Promise<unknown>) => Promise<void> }) {
  const [adding, setAdding] = useState('')
  return (
    <li className="flex flex-col gap-3 bg-surface p-4 rounded-3xl shadow-sm ring-1 ring-line">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <a dir="auto" href={href.recipe(group.recipe.id)} className="text-lg font-semibold text-accent underline">{group.recipe.title}</a>
        <span className="text-sm text-muted">{group.recipe.section}</span>
      </div>

      {group.quotes.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">من نص الوصفة</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {group.quotes.map((q) => <li key={q} dir="auto" className="rounded-lg bg-bg px-3 py-2 leading-relaxed">{q}</li>)}
          </ul>
        </details>
      )}

      <ul className="flex flex-col gap-2">
        {group.lines.map((line) => (
          <Line key={line.id} line={line} canEdit={canEdit} busy={busy} api={api} act={act} />
        ))}
      </ul>

      {canEdit && (
        <div className="flex flex-col gap-2">
          {group.waiting > 1 && (
            <div>
              <Button disabled={busy} onClick={() => void act(() => api.confirmAll(group.recipe.id))}>أكّدي الكل ({group.waiting})</Button>
            </div>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const text = adding.trim()
              if (text) void act(async () => { await api.addIngredient(group.recipe.id, text); setAdding('') })
            }}
          >
            <input dir="auto" maxLength={200} value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="مقدار فاتني…" aria-label={`إضافة مقدار إلى ${group.recipe.title}`} className="min-h-11 flex-1 border border-line bg-bg px-3 text-base rounded-2xl" />
            <Button type="submit" kind="plain" disabled={busy || adding.trim() === ''}>أضيفي</Button>
          </form>
        </div>
      )}
    </li>
  )
}

function Line({ line, canEdit, busy, api, act }: { line: Suggestion; canEdit: boolean; busy: boolean; api: ReviewApi; act: (work: () => Promise<unknown>) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(line.text)

  if (editing) {
    return (
      <li>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (text.trim()) void act(async () => { await api.setSuggestion(line.id, 'confirmed', text); setEditing(false) })
          }}
        >
          <input dir="auto" maxLength={200} value={text} onChange={(e) => setText(e.target.value)} aria-label="نص المقدار" className="min-h-11 min-w-0 flex-1 border border-line bg-bg px-3 text-base rounded-2xl" />
          <Button type="submit" disabled={busy || text.trim() === ''}>أكّدي بعد التصحيح</Button>
          <Button kind="plain" onClick={() => { setText(line.text); setEditing(false) }}>إلغاء</Button>
        </form>
      </li>
    )
  }

  return (
    <li className="flex flex-wrap items-center gap-2">
      <span dir="auto" className={`min-w-0 flex-1 ${line.status === 'ignored' ? 'text-muted line-through' : 'font-medium'}`}>{line.text}</span>
      <Badge tone={line.status === 'confirmed' ? 'accent' : line.status === 'ignored' ? 'plain' : 'warn'}>{STATUS_LABEL[line.status]}</Badge>
      {canEdit && line.status === 'suggested' && (
        <>
          <Button kind="plain" disabled={busy} onClick={() => void act(() => api.setSuggestion(line.id, 'confirmed'))}>✓ أكّدي</Button>
          <Button kind="plain" disabled={busy} onClick={() => setEditing(true)}>تعديل</Button>
          <Button kind="plain" disabled={busy} onClick={() => void act(() => api.setSuggestion(line.id, 'ignored'))}>تجاهلي</Button>
        </>
      )}
      {canEdit && line.status !== 'suggested' && (
        <>
          {line.status === 'confirmed' && <Button kind="plain" disabled={busy} onClick={() => setEditing(true)}>تعديل</Button>}
          <Button kind="plain" disabled={busy} onClick={() => void act(() => api.setSuggestion(line.id, 'suggested'))}>{line.status === 'confirmed' ? 'تراجعي' : 'أعيديه'}</Button>
        </>
      )}
    </li>
  )
}
