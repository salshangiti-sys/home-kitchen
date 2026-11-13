// The weekly plan: a week at a time, each day with its meal slots. Everyone in the household reads it;
// owners and editors add recipes (or free text) to a slot, change, move and remove meals, set the food
// groups of a meal, copy the week before, and set up people, slots and the first day of the week.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { href, navigate } from '../router'
import { Button, LinkButton, Notice } from '../ui'
import { listRecipes } from '../library/api'
import { generateTasks } from '../prep/api'
import { FOOD_GROUPS, FOOD_GROUP_LABELS, type FoodGroup } from '../nutrition/api'
import AddMeal from './AddMeal'
import MealRow from './MealRow'
import PlanSettings, { type SettingsApi } from './PlanSettings'
import * as real from './api'
import { addDays, dayLabel, isIsoDate, todayIso, weekRange, weekdayName, weekDays } from './dates'
import { effectiveGroups, overridesFor, planMessage, slotUnion, type NewMeal, type WeekData } from './api'
import type { RecipeSummary } from '../library/api'

export interface PlanApi extends SettingsApi {
  loadWeek: typeof real.loadWeek
  planDefaults: typeof real.planDefaults
  addMeal: typeof real.addMeal
  updateMeal: typeof real.updateMeal
  moveMeal: typeof real.moveMeal
  removeMeal: typeof real.removeMeal
  copyWeek: typeof real.copyWeek
  setSlotGroups: typeof real.setSlotGroups
  loadRecipes: () => Promise<RecipeSummary[]>
  // Brings the prep tasks of the week up to date after the plan changes (best effort).
  generatePrepTasks?: (day: string) => Promise<unknown>
}

const realApi: PlanApi = {
  loadWeek: real.loadWeek,
  planDefaults: real.planDefaults,
  addMeal: real.addMeal,
  updateMeal: real.updateMeal,
  moveMeal: real.moveMeal,
  removeMeal: real.removeMeal,
  copyWeek: real.copyWeek,
  setSlotGroups: real.setSlotGroups,
  setWeekStart: real.setWeekStart,
  saveSlot: real.saveSlot,
  removeSlot: real.removeSlot,
  savePerson: real.savePerson,
  removePerson: real.removePerson,
  loadRecipes: async () => (await listRecipes()).recipes,
  generatePrepTasks: generateTasks,
}

interface Props {
  week?: string // a date in the week to show; today's week when missing
  canEdit: boolean
  today?: () => string
  api?: PlanApi
}

export default function PlanPage({ week, canEdit, today = todayIso, api = realApi }: Props) {
  const anyDay = isIsoDate(week) ? week : today()
  const [data, setData] = useState<WeekData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState<{ day: string; slot: string } | null>(null)
  const seeded = useRef(false)

  const load = useCallback(async () => {
    try {
      let result = await api.loadWeek(anyDay)
      // The first time an owner or editor opens the plan, the settings and default slots are made.
      if (canEdit && result.slots.length === 0 && !seeded.current) {
        seeded.current = true
        await api.planDefaults()
        result = await api.loadWeek(anyDay)
      }
      setData(result)
    } catch (e) {
      setData((current) => current)
      setError(planMessage(e))
    }
  }, [api, anyDay, canEdit])

  useEffect(() => {
    setData(null)
    setAdding(null)
    setNote(null)
    void load()
  }, [load])

  const act = async (work: () => Promise<unknown>, after?: () => void) => {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      await work()
      after?.()
      // Tasks follow the plan: a meal added, moved, skipped or removed changes its prep tasks.
      if (canEdit) await api.generatePrepTasks?.(anyDay)?.catch(() => undefined)
      await load()
    } catch (e) {
      setError(planMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const days = useMemo(() => (data ? weekDays(data.weekStart) : []), [data])
  const goTo = (start: string) => navigate(href.plan(start))

  if (!data) return error ? <Notice tone="error">{error}</Notice> : <p className="text-muted">جارٍ التحميل…</p>

  const now = today()
  const empty = data.meals.length === 0
  const thisWeek = days.includes(now)

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-2xl font-bold">الخطة الأسبوعية</h2>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button kind="plain" onClick={() => goTo(addDays(data.weekStart, -7))}>→ الأسبوع السابق</Button>
        <div className="flex flex-col items-center">
          <span className="font-medium">{weekRange(data.weekStart)}</span>
          {!thisWeek && <button type="button" onClick={() => navigate(href.plan())} className="text-sm text-accent underline">إلى هذا الأسبوع</button>}
        </div>
        <Button kind="plain" onClick={() => goTo(addDays(data.weekStart, 7))}>الأسبوع التالي ←</Button>
      </div>

      {!empty && (
        <div>
          <LinkButton href={href.print(data.weekStart, false)}>طباعة الأسبوع / PDF</LinkButton>
        </div>
      )}

      {error && <Notice tone="error">{error}</Notice>}
      {note && <Notice>{note}</Notice>}

      {canEdit && empty && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-line p-4">
          <p className="text-sm text-muted">لا وجبات في هذا الأسبوع بعد.</p>
          <Button
            kind="plain"
            disabled={busy}
            onClick={() =>
              void act(
                async () => {
                  const result = await api.copyWeek(addDays(data.weekStart, -7), data.weekStart)
                  setNote(`نُسخت ${result.copied} ${result.copied === 1 ? 'وجبة' : 'وجبات'} من الأسبوع السابق${result.skipped ? `، وتُخطّيت ${result.skipped} لأن وصفتها في سلة المحذوفات` : ''}.`)
                },
              )
            }
          >
            انسخي الأسبوع السابق
          </Button>
        </div>
      )}
      {!canEdit && empty && <p className="text-muted">لم تُخطَّط وجبات لهذا الأسبوع بعد.</p>}

      {data.slots.length === 0 && !canEdit && <p className="text-muted">لم تُجهَّز خانات الوجبات بعد. تُجهَّز حين تفتح المالكة الخطة.</p>}

      <ul className="flex flex-col gap-4">
        {days.map((day) => (
          <li key={day}>
            <section aria-label={`${weekdayName(day)} ${dayLabel(day)}`} className={`flex flex-col gap-3 rounded-2xl border bg-surface p-4 ${day === now ? 'border-accent' : 'border-line'}`}>
              <h3 className="text-lg font-semibold">
                {weekdayName(day)} <span className="text-sm font-normal text-muted">{dayLabel(day)}</span>
                {day === now && <span className="ms-2 text-sm font-normal text-accent">اليوم</span>}
              </h3>
              {data.slots.map((slot) => {
                const meals = data.meals.filter((m) => m.day === day && m.slot_id === slot.id)
                const union = slotUnion(data.meals, day, slot.id, data.recipeGroups)
                const effective = effectiveGroups(union, data.overrides, day, slot.id)
                const isAdding = adding?.day === day && adding.slot === slot.id
                if (!canEdit && meals.length === 0) return null
                return (
                  <div key={slot.id} className="flex flex-col gap-2">
                    <h4 className="text-sm font-semibold text-muted">{slot.name}</h4>
                    {meals.length > 0 && (
                      <ul className="flex flex-col gap-2">
                        {meals.map((meal) => (
                          <MealRow
                            key={meal.id}
                            meal={meal}
                            people={data.people}
                            slots={data.slots}
                            days={days}
                            canEdit={canEdit}
                            busy={busy}
                            onUpdate={(servings, people, status) => void act(() => api.updateMeal(meal.id, servings, people, status))}
                            onMove={(d, s) => void act(() => api.moveMeal(meal.id, d, s))}
                            onRemove={() => void act(() => api.removeMeal(meal.id))}
                          />
                        ))}
                      </ul>
                    )}
                    {meals.length > 0 && (canEdit || effective.length > 0) && (
                      <Groups
                        label={`العناصر الغذائية: ${weekdayName(day)} ${slot.name}`}
                        effective={effective}
                        canEdit={canEdit}
                        busy={busy}
                        onToggle={(group) => {
                          const wanted = effective.includes(group) ? effective.filter((g) => g !== group) : FOOD_GROUPS.filter((g) => g === group || effective.includes(g))
                          const { add, remove } = overridesFor(union, wanted)
                          void act(() => api.setSlotGroups(day, slot.id, add, remove))
                        }}
                      />
                    )}
                    {canEdit && !isAdding && (
                      <div>
                        <Button kind="plain" onClick={() => setAdding({ day, slot: slot.id })}>+ أضيفي إلى {slot.name}</Button>
                      </div>
                    )}
                    {isAdding && (
                      <AddMeal
                        day={day}
                        slot={slot.id}
                        people={data.people}
                        loadRecipes={api.loadRecipes}
                        busy={busy}
                        onCancel={() => setAdding(null)}
                        onAdd={(meal: NewMeal) => void act(() => api.addMeal(meal), () => setAdding(null))}
                      />
                    )}
                  </div>
                )
              })}
            </section>
          </li>
        ))}
      </ul>

      {canEdit && <PlanSettings startDow={data.startDow} slots={data.slots} people={data.people} api={api} onChanged={() => void load()} />}
    </div>
  )
}

function Groups({ label, effective, canEdit, busy, onToggle }: { label: string; effective: FoodGroup[]; canEdit: boolean; busy: boolean; onToggle: (group: FoodGroup) => void }) {
  if (!canEdit) {
    return (
      <p className="text-xs text-muted">
        العناصر الغذائية: {effective.map((g) => FOOD_GROUP_LABELS[g]).join('، ')}
      </p>
    )
  }
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted">العناصر الغذائية:</span>
      {FOOD_GROUPS.map((group) => {
        const on = effective.includes(group)
        return (
          <button key={group} type="button" aria-pressed={on} disabled={busy} onClick={() => onToggle(group)} className={`min-h-9 rounded-full border px-3 text-xs font-medium disabled:opacity-60 ${on ? 'border-accent bg-accent text-on-accent' : 'border-line'}`}>
            {FOOD_GROUP_LABELS[group]}
          </button>
        )
      })}
    </div>
  )
}
