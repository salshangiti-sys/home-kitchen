// Food groups of a recipe ("العناصر الغذائية"): which of the basic groups the dish contains, chosen by
// hand by owners and editors, read by everyone. Nothing is worked out from the ingredients, and this
// is not a medical or calorie judgement. Written only through set_recipe_food_groups.

import { supabase } from '../lib/supabase'
import { explain, looksOffline, readThrough } from '../offline/readThrough'

export const FOOD_GROUPS = ['vegetables', 'protein', 'carbs', 'fruit', 'dairy'] as const
export type FoodGroup = (typeof FOOD_GROUPS)[number]

export const FOOD_GROUP_LABELS: Record<FoodGroup, string> = {
  vegetables: 'خضار',
  protein: 'بروتين',
  carbs: 'نشويات',
  fruit: 'فواكه',
  dairy: 'ألبان',
}

export const listFoodGroups = (recipeId: string): Promise<FoodGroup[]> =>
  readThrough(`foodgroups:${recipeId}`, async () => {
    const { data, error } = await supabase.from('recipe_food_groups').select('food_group').eq('recipe_id', recipeId)
    if (error) throw new Error(error.message)
    const found = new Set((data as Array<{ food_group: FoodGroup }>).map((row) => row.food_group))
    return FOOD_GROUPS.filter((group) => found.has(group)) // always in the same order
  })

export async function setFoodGroups(recipeId: string, groups: FoodGroup[]): Promise<void> {
  const { error } = await supabase.rpc('set_recipe_food_groups', { p_recipe_id: recipeId, p_groups: groups })
  if (error) throw new Error(error.message)
}

export function foodGroupMessage(error: unknown): string {
  if (looksOffline(error)) return explain(error).message
  const text = error instanceof Error ? error.message : String(error)
  if (/in_trash/.test(text)) return 'الوصفة في سلة المحذوفات. استرجعيها أولًا.'
  if (/not allowed|42501/i.test(text)) return 'لا تملكين صلاحية تعديل هذه الوصفة.'
  return text
}

// The groups after tapping one: added if absent, removed if present, always in the same order.
export const toggleGroup = (current: FoodGroup[], group: FoodGroup): FoodGroup[] =>
  FOOD_GROUPS.filter((g) => (g === group ? !current.includes(g) : current.includes(g)))
