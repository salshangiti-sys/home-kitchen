// The shopping list's data: what the week's recipes need (their ingredient lines, or else the
// ingredients the person confirmed in the app), and what she marked. Everyone in the household reads;
// only owners and editors write, through database functions (see the shopping_list migration).
// Ticking, adding and removing work with no connection: they wait in the outbox and are sent later.

import { supabase } from '../lib/supabase'
import { explain, looksOffline, readThrough } from '../offline/readThrough'
import { registerHandler } from '../offline/outbox'
import { usableIngredients, type Suggestion } from '../ingredients/api'
import { ADD_KIND, CLEAR_KIND, CONFIRM_KIND, MARK_KIND, PANTRY_KIND, UNCONFIRM_KIND, type Confirmation, type Mark, type MarkStatus, type PantryItem, type RecipeLines } from './model'
import type { Unit } from './quantity'

const fail = (error: { message: string } | null): void => {
  if (error) throw new Error(error.message)
}

export interface ShoppingData {
  recipes: Record<string, RecipeLines>
  marks: Mark[]
  pantry: PantryItem[]
  confirmations: Confirmation[]
}

// For a plan week: the ingredient lines of the given recipes, the week's marks, and the pantry.
export const loadShopping = (weekStart: string, recipes: Array<{ id: string; title: string }>): Promise<ShoppingData> =>
  readThrough(`shopping:${weekStart}`, async () => {
    const ids = recipes.map((r) => r.id)
    const [lines, suggestions, marks, pantry, confirmations] = await Promise.all([
      ids.length ? supabase.from('recipe_ingredients').select('recipe_id,position,text').in('recipe_id', ids).order('position') : Promise.resolve({ data: [], error: null }),
      ids.length
        ? supabase.from('recipe_ingredient_suggestions').select('id,recipe_id,position,text,quote,status,source').in('recipe_id', ids).eq('status', 'confirmed').order('position')
        : Promise.resolve({ data: [], error: null }),
      supabase.from('shopping_marks').select('key,label,status,is_manual').eq('week_start', weekStart),
      supabase.from('pantry_items').select('key,label').order('key'),
      ids.length ? supabase.from('quantity_confirmations').select('recipe_id,line,item_key,quantity,unit').in('recipe_id', ids) : Promise.resolve({ data: [], error: null }),
    ])
    fail(lines.error)
    fail(suggestions.error)
    fail(marks.error)
    fail(pantry.error)
    fail(confirmations.error)

    const written = new Map<string, string[]>()
    for (const row of lines.data as Array<{ recipe_id: string; text: string }>) written.set(row.recipe_id, [...(written.get(row.recipe_id) ?? []), row.text])
    const confirmed = suggestions.data as Suggestion[]
    const out: Record<string, RecipeLines> = {}
    for (const recipe of recipes) {
      // the lines written in the recipe, else the ingredients she confirmed in the app
      const used = usableIngredients(written.get(recipe.id) ?? [], confirmed.filter((s) => s.recipe_id === recipe.id))
      out[recipe.id] = { title: recipe.title, lines: used.lines }
    }
    return { recipes: out, marks: marks.data as Mark[], pantry: pantry.data as PantryItem[], confirmations: (confirmations.data as Array<Confirmation & { quantity: number | string }>).map((c) => ({ ...c, quantity: Number(c.quantity) })) }
  })

async function rpc(name: string, args: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.rpc(name, args)
  fail(error)
}

export const setMark = (week: string, key: string, status: MarkStatus) => rpc('set_shopping_mark', { p_week: week, p_key: key, p_status: status })
export const addItem = (week: string, key: string, label: string) => rpc('add_shopping_item', { p_week: week, p_key: key, p_label: label })
export const clearMark = (week: string, key: string) => rpc('clear_shopping_mark', { p_week: week, p_key: key })
export const setPantry = (key: string, label: string, on: boolean) => rpc('set_pantry_item', { p_key: key, p_label: label, p_on: on })

export const confirmQuantity = (recipe: string, line: string, key: string, quantity: number, unit: Unit) =>
  rpc('confirm_quantity', { p_recipe: recipe, p_line: line, p_key: key, p_quantity: quantity, p_unit: unit })
export const unconfirmQuantity = (recipe: string, line: string, key: string) => rpc('unconfirm_quantity', { p_recipe: recipe, p_line: line, p_key: key })

// How the changes made with no connection are sent later (sending one again changes nothing).
registerHandler(MARK_KIND, 'تعليم صنف في المقاضي', (a) => setMark(String(a.week), String(a.key), a.status as MarkStatus))
registerHandler(ADD_KIND, 'إضافة صنف إلى المقاضي', (a) => addItem(String(a.week), String(a.key), String(a.label)))
registerHandler(CLEAR_KIND, 'حذف صنف من المقاضي', (a) => clearMark(String(a.week), String(a.key)))
registerHandler(PANTRY_KIND, 'تعديل «متوفر في البيت»', (a) => setPantry(String(a.key), String(a.label ?? a.key), a.on === true))

registerHandler(CONFIRM_KIND, 'تأكيد كمية', (a) => confirmQuantity(String(a.recipe), String(a.line), String(a.key), Number(a.quantity), (a.unit as Unit) ?? null))
registerHandler(UNCONFIRM_KIND, 'إلغاء تأكيد كمية', (a) => unconfirmQuantity(String(a.recipe), String(a.line), String(a.key)))

const MESSAGES: Array<[RegExp, string]> = [
  [/quantity|check constraint|char_length/i, 'تحقّقي من الكمية (رقم أكبر من صفر) ومن اسم الصنف (حتى 120 حرفًا).'],
  [/recipe not found/i, 'الوصفة غير موجودة.'],
  [/not allowed|42501/i, 'لا تملكين صلاحية تعديل المقاضي.'],
]

export function shoppingMessage(error: unknown): string {
  if (looksOffline(error)) return explain(error).message
  const text = error instanceof Error ? error.message : String(error)
  return MESSAGES.find(([pattern]) => pattern.test(text))?.[1] ?? text
}
