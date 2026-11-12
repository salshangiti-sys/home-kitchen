// One planned meal in a slot: its title (a link when it is a recipe), servings, who it is for, and
// for owners and editors: change servings, people or status, move it to another day or slot, remove it.

import { useState } from 'react'
import { href } from '../router'
import { Badge, Button } from '../ui'
import { dayLabel, weekdayName } from './dates'
import type { MealStatus, Person, PlannedMeal, Slot } from './api'

const STATUS_LABELS: Record<MealStatus, string> = { planned: 'مخطّطة', cooked: 'تم طبخها', skipped: 'تخطّيناها' }

interface Props {
  meal: PlannedMeal
  people: Person[]
  slots: Slot[]
  days: string[]
  canEdit: boolean
  busy: boolean
  onUpdate: (servings: number | null, people: string[], status: MealStatus) => void
  onMove: (day: string, slot: string) => void
  onRemove: () => void
}

export default function MealRow({ meal, people, slots, days, canEdit, busy, onUpdate, onMove, onRemove }: Props) {
  const [panel, setPanel] = useState<'edit' | 'move' | 'remove' | null>(null)
  const [servings, setServings] = useState(meal.servings === null ? '' : String(meal.servings))
  const [chosen, setChosen] = useState<string[]>(meal.people)
  const [status, setStatus] = useState<MealStatus>(meal.status)
  const [day, setDay] = useState(meal.day)
  const [slot, setSlot] = useState(meal.slot_id)

  const names = meal.people.flatMap((id) => people.find((p) => p.id === id)?.name ?? [])
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {meal.recipe_id ? (
          <a href={href.recipe(meal.recipe_id)} dir="auto" className={`font-medium text-accent underline ${meal.status === 'skipped' ? 'line-through opacity-60' : ''}`}>{meal.title}</a>
        ) : (
          <span dir="auto" className={`font-medium ${meal.status === 'skipped' ? 'line-through opacity-60' : ''}`}>{meal.title}</span>
        )}
        {meal.servings !== null && <Badge>{meal.servings} {meal.servings === 1 ? 'حصة' : 'حصص'}</Badge>}
        {names.map((name) => <Badge key={name} tone="accent">{name}</Badge>)}
        {meal.status !== 'planned' && <Badge tone={meal.status === 'cooked' ? 'accent' : 'warn'}>{STATUS_LABELS[meal.status]}</Badge>}
      </div>

      {canEdit && panel === null && (
        <div className="flex flex-wrap gap-2">
          <Button kind="plain" onClick={() => setPanel('edit')}>تعديل</Button>
          <Button kind="plain" onClick={() => setPanel('move')}>نقل</Button>
          <Button kind="plain" onClick={() => setPanel('remove')}>حذف</Button>
        </div>
      )}

      {panel === 'edit' && (
        <form
          className="flex flex-col gap-3 rounded-lg border border-line p-3"
          onSubmit={(e) => {
            e.preventDefault()
            onUpdate(servings.trim() === '' ? null : Number(servings), chosen, status)
            setPanel(null)
          }}
        >
          <label className="flex flex-col gap-1 text-sm font-medium">
            عدد الحصص (اختياري)
            <input type="number" min="1" max="100" step="any" inputMode="decimal" value={servings} onChange={(e) => setServings(e.target.value)} className="min-h-11 rounded-xl border border-line bg-bg px-3 text-base font-normal" />
          </label>
          {people.length > 0 && (
            <fieldset className="flex flex-wrap gap-2">
              <legend className="mb-1 text-sm font-medium">لمن؟</legend>
              {people.map((p) => (
                <label key={p.id} className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm">
                  <input type="checkbox" checked={chosen.includes(p.id)} onChange={() => toggle(p.id)} className="size-5 accent-[var(--accent)]" />
                  {p.name}
                </label>
              ))}
            </fieldset>
          )}
          <label className="flex flex-col gap-1 text-sm font-medium">
            الحالة
            <select value={status} onChange={(e) => setStatus(e.target.value as MealStatus)} className="min-h-11 rounded-xl border border-line bg-bg px-3 text-base font-normal">
              {(Object.keys(STATUS_LABELS) as MealStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </label>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>احفظي</Button>
            <Button kind="plain" onClick={() => setPanel(null)}>إلغاء</Button>
          </div>
        </form>
      )}

      {panel === 'move' && (
        <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            إلى يوم
            <select value={day} onChange={(e) => setDay(e.target.value)} className="min-h-11 rounded-xl border border-line bg-bg px-3 text-base font-normal">
              {days.map((d) => <option key={d} value={d}>{weekdayName(d)} {dayLabel(d)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            وإلى خانة
            <select value={slot} onChange={(e) => setSlot(e.target.value)} className="min-h-11 rounded-xl border border-line bg-bg px-3 text-base font-normal">
              {slots.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <div className="flex gap-2">
            <Button disabled={busy || (day === meal.day && slot === meal.slot_id)} onClick={() => { onMove(day, slot); setPanel(null) }}>انقلي</Button>
            <Button kind="plain" onClick={() => setPanel(null)}>إلغاء</Button>
          </div>
        </div>
      )}

      {panel === 'remove' && (
        <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
          <p className="text-sm">تُحذف هذه الوجبة من الخطة. الوصفة نفسها لا تتأثر.</p>
          <div className="flex gap-2">
            <Button kind="danger" disabled={busy} onClick={() => { onRemove(); setPanel(null) }}>نعم، احذفيها</Button>
            <Button kind="plain" onClick={() => setPanel(null)}>إلغاء</Button>
          </div>
        </div>
      )}
    </li>
  )
}
