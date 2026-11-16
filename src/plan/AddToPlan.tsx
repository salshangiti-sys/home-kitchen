// "Add to the plan" from a recipe's page: pick the day, the meal slot (lunch, dinner…) and, if wanted,
// the servings, and the meal is added to that day's week, as if added from the plan page. For owners
// and editors. Its prep tasks are brought up to date, like after any change to the plan.

import { useEffect, useState } from 'react'
import { href } from '../router'
import { Button, Notice } from '../ui'
import { addMeal, loadWeek, planMessage, type Slot } from './api'
import { dayLabel, todayIso, weekdayName } from './dates'
import { addMealOrQueue, realOutbox, type PlanOutbox } from './offline'
import { generateTasks } from '../prep/api'

export interface AddToPlanApi {
  loadWeek: typeof loadWeek
  addMeal: typeof addMeal
  generateTasks: typeof generateTasks
}

const real: AddToPlanApi = { loadWeek, addMeal, generateTasks }

interface Props {
  recipeId: string
  title?: string // the recipe's title, to show the meal if it has to wait for a connection
  today?: () => string
  api?: AddToPlanApi
  outbox?: PlanOutbox
}

export default function AddToPlan({ recipeId, title = 'وصفة', today = todayIso, api = real, outbox = realOutbox }: Props) {
  const [open, setOpen] = useState(false)
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [day, setDay] = useState(today())
  const [slot, setSlot] = useState('')
  const [servings, setServings] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<{ day: string; slot: string; week: string; waiting?: boolean } | null>(null)

  useEffect(() => {
    if (!open || slots) return
    api.loadWeek(day).then(
      (week) => {
        setSlots(week.slots)
        setSlot((current) => current || week.slots[0]?.id || '')
      },
      (e) => setError(planMessage(e)),
    )
  }, [open, slots, api, day])

  const servingsNumber = servings.trim() === '' ? null : Number(servings)
  const ready = day !== '' && slot !== '' && (servingsNumber === null || (Number.isInteger(servingsNumber) && servingsNumber >= 1 && servingsNumber <= 100))

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const how = await addMealOrQueue({ day, slot, recipeId, freeText: null, servings: servingsNumber, people: [] }, title, (m) => api.addMeal(m), outbox)
      if (how === 'sent') await api.generateTasks(day).catch(() => undefined) // tasks follow the plan; a failure here does not undo the meal
      const week = await api.loadWeek(day).catch(() => null)
      setAdded({ day, slot: slots?.find((s) => s.id === slot)?.name ?? '', week: week?.weekStart ?? day, waiting: how === 'queued' })
      setOpen(false)
    } catch (e) {
      setError(planMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="إضافة إلى الخطة" className="flex flex-col gap-2">
      {added && (
        <Notice>
          {added.waiting ? 'لا يوجد اتصال: حُفظت على هذا الجهاز وتُضاف إلى الخطة' : 'أُضيفت إلى الخطة'}: {weekdayName(added.day)} {dayLabel(added.day)}{added.slot ? ` (${added.slot})` : ''}{added.waiting ? ' حين يعود الاتصال' : ''}. <a href={href.plan(added.week)} className="underline">افتحي الخطة</a>
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {!open ? (
        <div>
          <Button kind="plain" onClick={() => { setOpen(true); setAdded(null) }}>+ أضيفي إلى الخطة</Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3 rounded-xl border border-accent p-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (ready) void submit()
          }}
        >
          <label className="flex flex-col gap-1 text-sm font-medium">
            اليوم
            <input type="date" required value={day} onChange={(e) => setDay(e.target.value)} className="min-h-11 border border-line bg-bg px-3 text-base font-normal rounded-2xl" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            الوجبة
            <select value={slot} onChange={(e) => setSlot(e.target.value)} disabled={!slots} className="min-h-11 border border-line bg-bg px-3 text-base font-normal rounded-2xl">
              {!slots && <option value="">جارٍ التحميل…</option>}
              {slots?.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          {slots && slots.length === 0 && <p className="text-sm text-muted">لا خانات وجبات بعد: أنشئيها من صفحة الخطة أولًا.</p>}
          <label className="flex flex-col gap-1 text-sm font-medium">
            عدد الحصص (اختياري)
            <input inputMode="numeric" dir="ltr" value={servings} onChange={(e) => setServings(e.target.value)} className="min-h-11 w-28 border border-line bg-bg px-3 text-base font-normal rounded-2xl" />
          </label>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !ready}>أضيفي</Button>
            <Button kind="plain" onClick={() => setOpen(false)}>إلغاء</Button>
          </div>
        </form>
      )}
    </section>
  )
}
