// What the printed week plan shows, worked out from the plan and the prep tasks (pure, tested).
// Skipped meals are left out (they are not being cooked); tasks the household dismissed never get here.

import type { Person, PlannedMeal, Slot } from '../plan/api'
import { addDays, weekDays } from '../plan/dates'
import { TIMING_LABELS, shortTime, sortTasks, type MealInfo, type Task } from '../prep/api'

export interface PrintMeal {
  id: string
  title: string
  servings: number | null
  people: string[]
}

export interface PrintSlot {
  name: string
  meals: PrintMeal[]
}

export interface PrintTask {
  id: string
  body: string
  when: string // "صباحًا", "في وقت محدد 18:30" ...
  meal: string | null // the meal it is for
  done: boolean
}

export interface PrintDay {
  day: string
  slots: PrintSlot[]
  tasks: PrintTask[]
}

export interface PrintWeek {
  days: PrintDay[]
  // Tasks of the day before the week (evening tasks for the first day's meals); none when there are none.
  before: PrintDay | null
}

const whenOf = (task: Task) => (task.timing === 'at_time' && task.at_time ? `${TIMING_LABELS.at_time} ${shortTime(task.at_time)}` : TIMING_LABELS[task.timing])

function tasksOf(tasks: Task[], meals: Record<string, MealInfo>, day: string): PrintTask[] {
  return sortTasks(tasks.filter((t) => t.day === day)).map((t) => ({
    id: t.id,
    body: t.body,
    when: whenOf(t),
    meal: t.planned_meal_id ? (meals[t.planned_meal_id]?.title ?? null) : null,
    done: t.done_at !== null,
  }))
}

export function buildPrintWeek(input: { weekStart: string; slots: Slot[]; people: Person[]; meals: PlannedMeal[]; tasks: Task[] | null; taskMeals?: Record<string, MealInfo> }): PrintWeek {
  const names = new Map(input.people.map((p) => [p.id, p.name]))
  const slots = [...input.slots].sort((a, b) => a.position - b.position)
  const live = input.meals.filter((m) => m.status !== 'skipped')
  const taskMeals = input.taskMeals ?? {}

  const days: PrintDay[] = weekDays(input.weekStart).map((day) => ({
    day,
    slots: slots
      .map((slot) => ({
        name: slot.name,
        meals: live
          .filter((m) => m.day === day && m.slot_id === slot.id)
          .sort((a, b) => a.position - b.position)
          .map((m) => ({ id: m.id, title: m.title, servings: m.servings, people: m.people.flatMap((id) => names.get(id) ?? []) })),
      }))
      .filter((s) => s.meals.length > 0),
    tasks: input.tasks ? tasksOf(input.tasks, taskMeals, day) : [],
  }))

  const beforeDay = addDays(input.weekStart, -1)
  const beforeTasks = input.tasks ? tasksOf(input.tasks, taskMeals, beforeDay) : []
  return { days, before: beforeTasks.length ? { day: beforeDay, slots: [], tasks: beforeTasks } : null }
}
