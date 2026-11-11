// The cooking history of one recipe, on its page: how many times it was cooked, the last time, the
// average rating, and each time with its note. Anyone in the family can add an entry and change or
// remove their own. Opening the page from "done cooking" in cook mode starts the form right away.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Notice } from '../ui'
import {
  MAX_NOTE,
  addCookEntry,
  daysAgo,
  formatDate,
  historyMessage,
  listCookLog,
  localDate,
  removeCookEntry,
  summarize,
  timesLabel,
  updateCookEntry,
  type CookEntry,
  type EntryInput,
} from './api'

interface Api {
  listCookLog: typeof listCookLog
  addCookEntry: typeof addCookEntry
  updateCookEntry: typeof updateCookEntry
  removeCookEntry: typeof removeCookEntry
}

const real: Api = { listCookLog, addCookEntry, updateCookEntry, removeCookEntry }

interface Props {
  recipeId: string
  userId: string
  canLog: boolean // false for a recipe in the trash
  startLogging?: boolean
  today?: () => string
  api?: Api
}

export default function CookHistory({ recipeId, userId, canLog, startLogging = false, today = localDate, api = real }: Props) {
  const [entries, setEntries] = useState<CookEntry[] | null>(null)
  const [editing, setEditing] = useState<string | 'new' | null>(startLogging && canLog ? 'new' : null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const section = useRef<HTMLElement>(null)

  const load = useCallback(async () => {
    try {
      setEntries(await api.listCookLog(recipeId))
    } catch (e) {
      setEntries((current) => current ?? [])
      setError(historyMessage(e))
    }
  }, [api, recipeId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (startLogging) section.current?.scrollIntoView?.({ block: 'start' })
  }, [startLogging])

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
      setEditing(null)
      setConfirming(null)
      await load()
    } catch (e) {
      setError(historyMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (entries === null) return null
  const summary = summarize(entries)
  const now = today()
  const editingEntry = editing && editing !== 'new' ? entries.find((e) => e.id === editing) : undefined

  return (
    <section ref={section} aria-label="سجل التجارب" className="rounded-2xl border border-line bg-surface p-5">
      <h3 className="mb-1 text-lg font-semibold">سجل التجارب</h3>

      {summary.count === 0 ? (
        <p className="text-sm text-muted">لم تُسجَّل تجربة لهذه الوصفة بعد.</p>
      ) : (
        <p className="text-sm text-muted">
          {timesLabel(summary.count)} · آخر مرة {daysAgo(summary.lastOn!, now)}
          {summary.average !== null && ` · متوسط التقييم ${summary.average}`}
        </p>
      )}

      {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}

      {canLog && editing === null && (
        <div className="mt-3">
          <Button onClick={() => setEditing('new')}>سجّلي أنكِ طبختِها</Button>
        </div>
      )}

      {editing === 'new' && (
        <EntryForm
          key="new"
          initial={{ cooked_on: now, rating: null, note: '' }}
          max={now}
          busy={busy}
          submitLabel="احفظي التجربة"
          onSubmit={(input) => run(() => api.addCookEntry(recipeId, input))}
          onCancel={() => setEditing(null)}
        />
      )}

      {entries.length > 0 && (
        <ul className="mt-4 flex flex-col gap-3">
          {entries.map((entry) => {
            const mine = entry.user_id === userId
            if (editingEntry?.id === entry.id) {
              return (
                <li key={entry.id}>
                  <EntryForm
                    initial={{ cooked_on: entry.cooked_on, rating: entry.rating, note: entry.note ?? '' }}
                    max={now}
                    busy={busy}
                    submitLabel="احفظي التعديل"
                    onSubmit={(input) => run(() => api.updateCookEntry(entry.id, input))}
                    onCancel={() => setEditing(null)}
                  />
                </li>
              )
            }
            return (
              <li key={entry.id} className="flex flex-col gap-1 rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {formatDate(entry.cooked_on)} <span className="text-sm font-normal text-muted">({daysAgo(entry.cooked_on, now)})</span>
                  </span>
                  {entry.rating !== null && <Stars value={entry.rating} />}
                </div>
                {entry.note && <p dir="auto" className="whitespace-pre-line leading-relaxed">{entry.note}</p>}
                <p className="text-xs text-muted">{mine ? 'سجّلتِها أنتِ' : 'سجّلها أحد أفراد العائلة'}</p>
                {mine && confirming !== entry.id && (
                  <div className="flex gap-2">
                    <Button kind="plain" onClick={() => setEditing(entry.id)}>تعديل</Button>
                    <Button kind="plain" onClick={() => setConfirming(entry.id)}>حذف</Button>
                  </div>
                )}
                {mine && confirming === entry.id && (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm">تُحذف هذه التجربة من السجل. هل تريدين ذلك؟</p>
                    <div className="flex gap-2">
                      <Button kind="danger" disabled={busy} onClick={() => run(() => api.removeCookEntry(entry.id))}>نعم، احذفيها</Button>
                      <Button kind="plain" onClick={() => setConfirming(null)}>إلغاء</Button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function Stars({ value }: { value: number }) {
  return (
    <span role="img" aria-label={`التقييم ${value} من 5`} className="text-amber-500">
      {'★'.repeat(value)}
      <span className="text-line">{'★'.repeat(5 - value)}</span>
    </span>
  )
}

function EntryForm({
  initial,
  max,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: EntryInput
  max: string
  busy: boolean
  submitLabel: string
  onSubmit: (input: EntryInput) => void
  onCancel: () => void
}) {
  const [date, setDate] = useState(initial.cooked_on)
  const [rating, setRating] = useState<number | null>(initial.rating)
  const [note, setNote] = useState(initial.note)

  return (
    <form
      className="mt-3 flex flex-col gap-3 rounded-xl border border-line p-3"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit({ cooked_on: date, rating, note })
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-medium">
        تاريخ الطبخ
        <input type="date" required value={date} max={max} onChange={(e) => setDate(e.target.value)} className="min-h-11 rounded-xl border border-line bg-bg px-3 text-base" />
      </label>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">التقييم (اختياري)</span>
        <div role="group" aria-label="التقييم" className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-label={`${n} من 5`}
              aria-pressed={rating !== null && n <= rating}
              onClick={() => setRating(rating === n ? null : n)}
              className={`min-h-11 min-w-11 rounded-xl border border-line text-2xl ${rating !== null && n <= rating ? 'text-amber-500' : 'text-line'}`}
            >
              ★
            </button>
          ))}
        </div>
        <span className="text-xs text-muted">اضغطي على النجمة نفسها مرة ثانية لإلغاء التقييم.</span>
      </div>

      <label className="flex flex-col gap-1 text-sm font-medium">
        ملاحظة (اختياري): ماذا غيّرتِ؟ وكيف خرجت؟
        <textarea
          dir="auto"
          rows={4}
          maxLength={MAX_NOTE}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="rounded-xl border border-line bg-bg p-3 text-base font-normal"
        />
      </label>

      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !date}>{submitLabel}</Button>
        <Button kind="plain" onClick={onCancel}>إلغاء</Button>
      </div>
    </form>
  )
}
