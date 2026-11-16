// What is in the freezer: items with a quantity, a unit, the day they were frozen, an optional link to
// a recipe page (of the section «مفرزنات») and a note. Owners and editors write, through database
// functions; everyone in the household reads. Needs a connection to change (reading keeps the last copy).

import { supabase } from '../lib/supabase'
import { explain, looksOffline, readThrough } from '../offline/readThrough'

export interface FreezerItem {
  id: string
  name: string
  quantity: number
  unit: string
  frozen_on: string // YYYY-MM-DD
  recipe_id: string | null
  note: string | null
}

export interface FreezerInput {
  name: string
  quantity: number
  unit: string
  frozenOn: string | null
  recipeId: string | null
  note: string | null
}

export const UNITS = ['قطعة', 'كيس', 'علبة', 'كرة', 'حبة', 'لفة', 'قرص', 'كجم', 'غ', 'حصة']

export const loadFreezer = (): Promise<FreezerItem[]> =>
  readThrough('freezer', async () => {
    const { data, error } = await supabase.from('freezer_items').select('id,name,quantity,unit,frozen_on,recipe_id,note').order('name').order('id')
    if (error) throw new Error(error.message)
    return (data as Array<Omit<FreezerItem, 'quantity'> & { quantity: number | string }>).map((row) => ({ ...row, quantity: Number(row.quantity) }))
  })

export async function saveFreezerItem(id: string | null, input: FreezerInput): Promise<string> {
  const { data, error } = await supabase.rpc('save_freezer_item', {
    p_id: id,
    p_name: input.name,
    p_quantity: input.quantity,
    p_unit: input.unit,
    p_frozen_on: input.frozenOn,
    p_recipe_id: input.recipeId,
    p_note: input.note,
  })
  if (error) throw new Error(error.message)
  return data as string
}

// Takes an amount off (one by default); the item goes when nothing is left. Returns what is left.
export async function useFreezerItem(id: string, amount = 1): Promise<number> {
  const { data, error } = await supabase.rpc('use_freezer_item', { p_id: id, p_amount: amount })
  if (error) throw new Error(error.message)
  return Number(data)
}

export async function removeFreezerItem(id: string): Promise<void> {
  const { error } = await supabase.rpc('remove_freezer_item', { p_id: id })
  if (error) throw new Error(error.message)
}

const MESSAGES: Array<[RegExp, string]> = [
  [/not allowed|42501/i, 'لا تملكين صلاحية تعديل الفريزر.'],
  [/recipe_not_found/, 'صفحة المفرزنات المختارة غير موجودة أو في سلة المحذوفات.'],
  [/item_not_found/, 'هذا الصنف لم يعد في الفريزر. حدّثي الصفحة.'],
  [/check constraint|freezer_items_(name|quantity|unit|note)/i, 'الاسم من 1 إلى 80 حرفًا، والكمية أكبر من صفر، والوحدة حتى 20 حرفًا.'],
]

export function freezerMessage(error: unknown): string {
  if (looksOffline(error)) return explain(error).message
  const text = error instanceof Error ? error.message : String(error)
  return MESSAGES.find(([pattern]) => pattern.test(text))?.[1] ?? text
}
