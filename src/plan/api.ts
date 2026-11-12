// The weekly plan: reading a week (slots, people, meals, manual food-group changes) and the database
// functions that change it. Everyone in the household reads; only owners and editors write, through
// functions that check who is asking (see the weekly_plan migration).

import { supabase } from '../lib/supabase'
import { explain, looksOffline, readThrough } from '../offline/readThrough'
import { FOOD_GROUPS, type FoodGroup } from '../nutrition/api'
import { addDays, weekStartOf } from './dates'

export interface Slot {
  id: string
  name: string
  position: number
}

export interface Person {
  id: string
  name: string
  kind: 'adult' | 'child'
  allergies: string[]
  notes: string | null
  position: number
}

export type MealStatus = 'planned' | 'cooked' | 'skipped'

export interface PlannedMeal {
  id: string
  day: string
  slot_id: string
  recipe_id: string | null
  title: string
  free_text: string | null
  servings: number | null
  people: string[]
  position: number
  status: MealStatus
}

export interface Override {
  day: string
  slot_id: string
  food_group: FoodGroup
  mode: 'add' | 'remove'
}

export interface WeekData {
  weekStart: string
  startDow: number
  slots: Slot[]
  people: Person[]
  meals: PlannedMeal[]
  overrides: Override[]
  recipeGroups: Record<string, FoodGroup[]>
}

const fail = (error: { message: string } | null): void => {
  if (error) throw new Error(error.message)
}

// The week that holds `anyDay`. Kept on the device for reading without a connection.
export const loadWeek = (anyDay: string): Promise<WeekData> =>
  readThrough(`plan:${anyDay}`, async () => {
    const settings = await supabase.from('plan_settings').select('week_start_dow').maybeSingle()
    fail(settings.error)
    const startDow = (settings.data?.week_start_dow as number | undefined) ?? 6
    const weekStart = weekStartOf(anyDay, startDow)

    const [slots, people, plan] = await Promise.all([
      supabase.from('meal_slots').select('id,name,position').is('deleted_at', null).order('position').order('id'),
      supabase.from('people').select('id,name,kind,allergies,notes,position').is('deleted_at', null).order('position').order('id'),
      supabase.from('week_plans').select('id').eq('week_start', weekStart).maybeSingle(),
    ])
    fail(slots.error)
    fail(people.error)
    fail(plan.error)

    let meals: PlannedMeal[] = []
    let overrides: Override[] = []
    let recipeGroups: Record<string, FoodGroup[]> = {}
    if (plan.data) {
      const [m, o] = await Promise.all([
        supabase.from('planned_meals').select('id,day,slot_id,recipe_id,title,free_text,servings,people,position,status').eq('week_plan_id', plan.data.id).order('day').order('position'),
        supabase.from('slot_food_groups').select('day,slot_id,food_group,mode').eq('week_plan_id', plan.data.id),
      ])
      fail(m.error)
      fail(o.error)
      meals = (m.data as PlannedMeal[]).map((meal) => ({ ...meal, servings: meal.servings === null ? null : Number(meal.servings) }))
      overrides = o.data as Override[]
      const recipeIds = [...new Set(meals.flatMap((meal) => (meal.recipe_id ? [meal.recipe_id] : [])))]
      if (recipeIds.length) {
        const g = await supabase.from('recipe_food_groups').select('recipe_id,food_group').in('recipe_id', recipeIds)
        fail(g.error)
        for (const row of g.data as Array<{ recipe_id: string; food_group: FoodGroup }>) (recipeGroups[row.recipe_id] ??= []).push(row.food_group)
      }
    }
    recipeGroups = Object.fromEntries(Object.entries(recipeGroups).map(([id, groups]) => [id, FOOD_GROUPS.filter((g) => groups.includes(g))]))
    return { weekStart, startDow, slots: slots.data as Slot[], people: people.data as Person[], meals, overrides, recipeGroups }
  })

async function rpc<T = void>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args)
  fail(error)
  return data as T
}

export const planDefaults = () => rpc('plan_defaults', {})
export const setWeekStart = (dow: number) => rpc('set_week_start', { p_dow: dow })
export const savePerson = (id: string | null, name: string, kind: 'adult' | 'child', allergies: string[], notes: string) =>
  rpc<string>('save_person', { p_id: id, p_name: name, p_kind: kind, p_allergies: allergies, p_notes: notes })
export const removePerson = (id: string) => rpc('remove_person', { p_id: id })
export const saveSlot = (id: string | null, name: string, position: number | null) => rpc<string>('save_slot', { p_id: id, p_name: name, p_position: position })
export const removeSlot = (id: string) => rpc('remove_slot', { p_id: id })

export interface NewMeal {
  day: string
  slot: string
  recipeId: string | null
  freeText: string | null
  servings: number | null
  people: string[]
}
export const addMeal = (m: NewMeal) =>
  rpc('add_planned_meal', { p_day: m.day, p_slot: m.slot, p_recipe_id: m.recipeId, p_free_text: m.freeText, p_servings: m.servings, p_people: m.people })
export const updateMeal = (id: string, servings: number | null, people: string[], status: MealStatus) =>
  rpc('update_planned_meal', { p_id: id, p_servings: servings, p_people: people, p_status: status })
export const moveMeal = (id: string, day: string, slot: string) => rpc('move_planned_meal', { p_id: id, p_day: day, p_slot: slot })
export const removeMeal = (id: string) => rpc('remove_planned_meal', { p_id: id })
export const copyWeek = (from: string, to: string) => rpc<{ copied: number; skipped: number }>('copy_week', { p_from: from, p_to: to })
export const setSlotGroups = (day: string, slot: string, add: FoodGroup[], remove: FoodGroup[]) =>
  rpc('set_slot_food_groups', { p_day: day, p_slot: slot, p_add: add, p_remove: remove })

// The week before `weekStart`, to copy from.
export const previousWeek = (weekStart: string) => addDays(weekStart, -7)

const MESSAGES: Array<[RegExp, string]> = [
  [/target_not_empty/, 'في هذا الأسبوع وجبات أصلًا. النسخ يكون إلى أسبوع فارغ.'],
  [/nothing_to_copy/, 'الأسبوع السابق لا وجبات فيه.'],
  [/same_week/, 'اختاري أسبوعًا مختلفًا.'],
  [/slot_in_use/, 'في هذه الخانة وجبات مخطَّطة (في أسبوع ما)، فلا تُحذف.'],
  [/recipe not found or in the trash/, 'الوصفة غير موجودة أو في سلة المحذوفات.'],
  [/bad_meal/, 'اختاري وصفة أو اكتبي نصًّا، لا الاثنين معًا.'],
  [/bad_date/, 'التاريخ غير صالح.'],
  [/check constraint|servings/i, 'عدد الحصص من 1 إلى 100.'],
  [/not allowed|42501/i, 'لا تملكين صلاحية تعديل الخطة.'],
]

export function planMessage(error: unknown): string {
  if (looksOffline(error)) return explain(error).message
  const text = error instanceof Error ? error.message : String(error)
  return MESSAGES.find(([pattern]) => pattern.test(text))?.[1] ?? text
}

// ---- Pure helpers (tested) ----

// The food groups of the recipes planned in a day's slot.
export function slotUnion(meals: PlannedMeal[], day: string, slot: string, recipeGroups: Record<string, FoodGroup[]>): FoodGroup[] {
  const found = new Set<FoodGroup>()
  for (const meal of meals) {
    if (meal.day === day && meal.slot_id === slot && meal.status !== 'skipped' && meal.recipe_id) for (const g of recipeGroups[meal.recipe_id] ?? []) found.add(g)
  }
  return FOOD_GROUPS.filter((g) => found.has(g))
}

// The union with the manual changes on top: added groups come in, removed groups go out.
export function effectiveGroups(union: FoodGroup[], overrides: Override[], day: string, slot: string): FoodGroup[] {
  const mine = overrides.filter((o) => o.day === day && o.slot_id === slot)
  const added = new Set(mine.filter((o) => o.mode === 'add').map((o) => o.food_group))
  const removed = new Set(mine.filter((o) => o.mode === 'remove').map((o) => o.food_group))
  return FOOD_GROUPS.filter((g) => (union.includes(g) || added.has(g)) && !removed.has(g))
}

// The manual changes that make `wanted` the groups of a slot whose recipes give `union`.
export function overridesFor(union: FoodGroup[], wanted: FoodGroup[]): { add: FoodGroup[]; remove: FoodGroup[] } {
  return {
    add: FOOD_GROUPS.filter((g) => wanted.includes(g) && !union.includes(g)),
    remove: FOOD_GROUPS.filter((g) => union.includes(g) && !wanted.includes(g)),
  }
}
