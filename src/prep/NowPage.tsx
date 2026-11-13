// «إيش أسوي الآن؟»: the prep tasks that matter now. What is late, what is for today (morning, timed,
// before cooking, and tonight's tasks for tomorrow's meal), and a peek at tomorrow. Anyone in the
// household can tick a task; owners and editors can also change, dismiss, or add one.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge, Button, Notice } from '../ui'
import { dayLabel, todayIso, weekdayName } from '../plan/dates'
import {
  KIND_LABELS,
  TIMINGS,
  TIMING_LABELS,
  addTask,
  dismissTask,
  generateTasks,
  groupNow,
  loadNow,
  prepMessage,
  setDone,
  shortTime,
  updateTask,
  type NowData,
  type PrepTiming,
  type Task,
  type TaskInput,
} from './api'

export interface NowApi {
  loadNow: typeof loadNow
  generateTasks: typeof generateTasks
  setDone: typeof setDone
  addTask: typeof addTask
  updateTask: typeof updateTask
  dismissTask: typeof dismissTask
}

const real: NowApi = { loadNow, generateTasks, setDone, addTask, updateTask, dismissTask }

interface Props {
  canEdit: boolean
  today?: () => string
  api?: NowApi
}

export default function NowPage({ canEdit, today = todayIso, api = real }: Props) {
  const now = today()
  const [data, setData] = useState<NowData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const synced = useRef(false)

  const load = useCallback(async () => {
    try {
      // Owners and editors bring the tasks up to date with the plan when they open the page.
      if (canEdit && !synced.current) {
        synced.current = true
        await api.generateTasks(now).catch(() => undefined)
      }
      setData(await api.loadNow(now))
    } catch (e) {
      setData((current) => current)
      setError(prepMessage(e))
    }
  }, [api, canEdit, now])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
      setEditing(null)
      setConfirming(null)
      setData(await api.loadNow(now))
    } catch (e) {
      setError(prepMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (!data) return error ? <Notice tone="error">{error}</Notice> : <p className="text-muted">جارٍ التحميل…</p>

  const groups = groupNow(data.tasks, now)
  const nothing = groups.overdue.length + groups.today.length + groups.doneToday.length === 0

  const row = (task: Task) => (
    <TaskRow
      key={task.id}
      task={task}
      meal={task.planned_meal_id ? data.meals[task.planned_meal_id] : undefined}
      canEdit={canEdit}
      busy={busy}
      editing={editing === task.id}
      confirming={confirming === task.id}
      onTick={(done) => void run(() => api.setDone(task.id, done))}
      onEdit={() => setEditing(task.id)}
      onCancel={() => { setEditing(null); setConfirming(null) }}
      onSave={(input) => void run(() => api.updateTask(task.id, input))}
      onAskDismiss={() => setConfirming(task.id)}
      onDismiss={() => void run(() => api.dismissTask(task.id))}
    />
  )

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-2xl font-bold">إيش أسوي الآن؟</h2>
      <p className="text-sm text-muted">{weekdayName(now)} {dayLabel(now)}</p>
      {error && <Notice tone="error">{error}</Notice>}

      {groups.overdue.length > 0 && (
        <section aria-label="متأخرة" className="flex flex-col gap-2">
          <h3 className="text-lg font-semibold text-red-700 dark:text-red-400">متأخرة</h3>
          <ul className="flex flex-col gap-2">{groups.overdue.map(row)}</ul>
        </section>
      )}

      <section aria-label="اليوم" className="flex flex-col gap-2">
        <h3 className="text-lg font-semibold">اليوم</h3>
        {groups.today.length > 0 ? <ul className="flex flex-col gap-2">{groups.today.map(row)}</ul> : <p className="text-sm text-muted">{nothing ? 'لا مهام تجهيز اليوم.' : 'أنجزتِ كل مهام اليوم.'}</p>}
      </section>

      {groups.tomorrow.length > 0 && (
        <details className="rounded-2xl border border-line p-3">
          <summary className="cursor-pointer font-medium">غدًا ({groups.tomorrow.length})</summary>
          <ul className="mt-2 flex flex-col gap-2">{groups.tomorrow.map(row)}</ul>
        </details>
      )}

      {groups.doneToday.length > 0 && (
        <details className="rounded-2xl border border-line p-3">
          <summary className="cursor-pointer font-medium">أُنجز اليوم ({groups.doneToday.length})</summary>
          <ul className="mt-2 flex flex-col gap-2">{groups.doneToday.map(row)}</ul>
        </details>
      )}

      {canEdit && editing !== 'new' && <div><Button kind="plain" onClick={() => setEditing('new')}>+ مهمة جديدة</Button></div>}
      {canEdit && editing === 'new' && (
        <TaskForm initial={{ day: now, timing: 'before_cooking', atTime: null, body: '' }} busy={busy} submitLabel="أضيفي المهمة" onSubmit={(input) => void run(() => api.addTask(input))} onCancel={() => setEditing(null)} />
      )}
    </div>
  )
}

function TaskRow({ task, meal, canEdit, busy, editing, confirming, onTick, onEdit, onCancel, onSave, onAskDismiss, onDismiss }: {
  task: Task
  meal?: { title: string; day: string; slot: string }
  canEdit: boolean
  busy: boolean
  editing: boolean
  confirming: boolean
  onTick: (done: boolean) => void
  onEdit: () => void
  onCancel: () => void
  onSave: (input: TaskInput) => void
  onAskDismiss: () => void
  onDismiss: () => void
}) {
  const done = task.done_at !== null
  if (editing) {
    return (
      <li>
        <TaskForm initial={{ day: task.day, timing: task.timing, atTime: shortTime(task.at_time), body: task.body }} busy={busy} submitLabel="احفظي التعديل" onSubmit={onSave} onCancel={onCancel} />
      </li>
    )
  }
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
      <label className="flex min-h-11 cursor-pointer items-start gap-3">
        <input type="checkbox" checked={done} disabled={busy} onChange={(e) => onTick(e.target.checked)} className="mt-1 size-6 shrink-0 accent-[var(--accent)]" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span dir="auto" className={`leading-relaxed ${done ? 'text-muted line-through' : 'font-medium'}`}>{task.body}</span>
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <Badge tone="accent">{KIND_LABELS[task.kind]}</Badge>
            <span>{task.timing === 'at_time' ? `الساعة ${shortTime(task.at_time)}` : TIMING_LABELS[task.timing]}</span>
            {meal && <span dir="auto">لوجبة: {meal.title} ({weekdayName(meal.day)}{meal.slot ? ` · ${meal.slot}` : ''})</span>}
          </span>
        </span>
      </label>
      {canEdit && !confirming && (
        <div className="flex gap-2">
          <Button kind="plain" onClick={onEdit}>تعديل</Button>
          <Button kind="plain" onClick={onAskDismiss}>إخفاء</Button>
        </div>
      )}
      {canEdit && confirming && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">تُخفى هذه المهمة ولا تعود حتى لو حدّثتِ الخطة.</p>
          <div className="flex gap-2">
            <Button kind="danger" disabled={busy} onClick={onDismiss}>نعم، أخفيها</Button>
            <Button kind="plain" onClick={onCancel}>إلغاء</Button>
          </div>
        </div>
      )}
    </li>
  )
}

function TaskForm({ initial, busy, submitLabel, onSubmit, onCancel }: { initial: TaskInput; busy: boolean; submitLabel: string; onSubmit: (input: TaskInput) => void; onCancel: () => void }) {
  const [day, setDay] = useState(initial.day)
  const [timing, setTiming] = useState<PrepTiming>(initial.timing)
  const [time, setTime] = useState(initial.atTime ?? '')
  const [body, setBody] = useState(initial.body)
  const ready = body.trim() !== '' && day !== '' && (timing !== 'at_time' || time !== '')
  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-accent p-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready) onSubmit({ day, timing, atTime: timing === 'at_time' ? time : null, body })
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-medium">
        ماذا تفعلين؟
        <input dir="auto" maxLength={200} value={body} onChange={(e) => setBody(e.target.value)} className="min-h-11 rounded-xl border border-line bg-bg px-3 text-base font-normal" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        اليوم
        <input type="date" required value={day} onChange={(e) => setDay(e.target.value)} className="min-h-11 rounded-xl border border-line bg-bg px-3 text-base font-normal" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        التوقيت
        <select value={timing} onChange={(e) => setTiming(e.target.value as PrepTiming)} className="min-h-11 rounded-xl border border-line bg-bg px-3 text-base font-normal">
          {TIMINGS.map((t) => <option key={t} value={t}>{TIMING_LABELS[t]}</option>)}
        </select>
      </label>
      {timing === 'at_time' && (
        <label className="flex flex-col gap-1 text-sm font-medium">
          الساعة
          <input type="time" required value={time} onChange={(e) => setTime(e.target.value)} className="min-h-11 rounded-xl border border-line bg-bg px-3 text-base font-normal" />
        </label>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !ready}>{submitLabel}</Button>
        <Button kind="plain" onClick={onCancel}>إلغاء</Button>
      </div>
    </form>
  )
}
