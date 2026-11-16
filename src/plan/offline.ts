// Adding a meal to the plan with no connection: the meal waits on this device (in the outbox) and is
// sent when the connection returns. Until then it shows in its day marked «لم تُرسل بعد», and she can
// take it back. Only adding works this way; changing or removing a meal that is already in the plan
// still needs a connection.

import { discard, enqueue, pending, registerHandler, subscribe, type Op } from '../offline/outbox'
import { deviceOffline, looksOffline } from '../offline/readThrough'
import { generateTasks } from '../prep/api'
import { addMeal, type NewMeal, type PlannedMeal } from './api'

export const PLAN_ADD_KIND = 'plan_add'
const PREFIX = 'plan-add:'
export const UNSENT_PREFIX = 'unsent:'

// Where waiting changes are kept (the app's own outbox unless a test brings another).
export interface PlanOutbox {
  enqueue: (kind: string, key: string, args: Record<string, unknown>) => Promise<void>
  pending: () => Promise<Op[]>
  subscribe: (listener: (event: 'queued' | 'flushed' | 'failed') => void) => () => void
  discard: (key: string) => Promise<void>
}
export const realOutbox: PlanOutbox = { enqueue, pending, subscribe, discard }

const newId = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)

// Sends the meal now; with no connection, keeps it on the device instead. Says which happened.
// (`title` is only for showing the waiting meal.)
export async function addMealOrQueue(meal: NewMeal, title: string, send: (meal: NewMeal) => Promise<unknown>, outbox: PlanOutbox = realOutbox): Promise<'sent' | 'queued'> {
  if (!deviceOffline()) {
    try {
      await send(meal)
      return 'sent'
    } catch (error) {
      if (!looksOffline(error)) throw error
    }
  }
  await outbox.enqueue(PLAN_ADD_KIND, `${PREFIX}${newId()}`, { ...meal, title })
  return 'queued'
}

// The waiting meals that fall in the given days, shaped like planned meals (their id says they are unsent).
export function unsentMeals(ops: Op[], days: string[]): PlannedMeal[] {
  return ops
    .filter((op) => op.kind === PLAN_ADD_KIND && days.includes(String(op.args.day)))
    .map((op, index) => ({
      id: `${UNSENT_PREFIX}${op.key}`,
      day: String(op.args.day),
      slot_id: String(op.args.slot),
      recipe_id: (op.args.recipeId as string | null) ?? null,
      title: String(op.args.title ?? op.args.freeText ?? ''),
      free_text: (op.args.freeText as string | null) ?? null,
      servings: (op.args.servings as number | null) ?? null,
      people: (op.args.people as string[] | undefined) ?? [],
      position: 100000 + index,
      status: 'planned' as const,
    }))
}

export const isUnsent = (meal: { id: string }): boolean => meal.id.startsWith(UNSENT_PREFIX)
export const unsentKey = (meal: { id: string }): string => meal.id.slice(UNSENT_PREFIX.length)

registerHandler(PLAN_ADD_KIND, 'إضافة وجبة إلى الخطة', async (a) => {
  await addMeal({
    day: String(a.day),
    slot: String(a.slot),
    recipeId: (a.recipeId as string | null) ?? null,
    freeText: (a.freeText as string | null) ?? null,
    servings: (a.servings as number | null) ?? null,
    people: (a.people as string[] | undefined) ?? [],
  })
  await generateTasks(String(a.day)).catch(() => undefined) // the meal's prep tasks follow it
})
