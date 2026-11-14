// "Which recipes have chicken / meat / fish": a search aid worked out from the recipe's ingredient lines
// (the lines on its OneNote page, else the ingredients she confirmed in the app) and its title. It is
// never saved and never changes a recipe. Chicken stock, spice mixes and the like do not count as the
// thing they are made from. A recipe with no ingredient lines is judged by its title alone.

import { supabase } from '../lib/supabase'
import { readThrough } from '../offline/readThrough'
import { normalizeAr } from './normalize'
import { identifyAll } from '../shopping/catalog'
import { usableIngredients, type Suggestion } from '../ingredients/api'

export type Protein = 'chicken' | 'meat' | 'fish'

export const PROTEIN_LABELS: Record<Protein, string> = { chicken: 'دجاج', meat: 'لحم', fish: 'سمك وروبيان' }
export const PROTEINS: Protein[] = ['chicken', 'meat', 'fish']

const KEY_KIND: Record<string, Protein> = {
  دجاج: 'chicken', 'صدور دجاج': 'chicken', 'دجاج كامل': 'chicken',
  لحم: 'meat', 'لحم مفروم': 'meat', كفتة: 'meat',
  تونة: 'fish', روبيان: 'fish',
}

// A word may carry a glued prefix («بالدجاج», «والسمك»).
const word = (names: string) => new RegExp(`(^|\\s)(?:ب|ل|و|ال|بال|وال)?(?:${names})(\\s|$)`)
const WORDS: Array<[Protein, RegExp]> = [
  ['chicken', word('دجاج\\S*|فراخ|بروستد')],
  ['meat', word('لحم\\S*|ستيك|ضان|خروف|بقر\\S*|كفته|كباب|بيف')],
  ['fish', word('سمك|سلمون|هامور|روبيان|ربيان|قمبري|جمبري|تونه|تونا|سردين')],
]

// Words that say the line is a stock, a seasoning or a sauce, not the thing itself.
const NOT_THE_THING = /مرق|مرقه|مكعب|ماجي|بهارات|بهار|نكهه|صوص|صلصه|زيت|مسحوق|بودره/

function fromText(text: string): Protein[] {
  const norm = normalizeAr(text).replace(/[()\[\]{}،,:؛/\-–—.+]/g, ' ').replace(/\s+/g, ' ').trim()
  if (NOT_THE_THING.test(norm)) return []
  return WORDS.filter(([, pattern]) => pattern.test(norm)).map(([kind]) => kind)
}

// The kinds of main ingredient a recipe has, in a fixed order.
export function mainIngredients(title: string, lines: string[]): Protein[] {
  const found = new Set<Protein>(fromText(title))
  for (const line of lines) {
    for (const item of identifyAll(line)) {
      if (item.sentence) continue
      if (item.known) {
        const kind = KEY_KIND[item.key]
        if (kind) found.add(kind)
      } else {
        for (const kind of fromText(item.label)) found.add(kind)
      }
    }
  }
  return PROTEINS.filter((p) => found.has(p))
}

// Reads every row of a table in pages (the server hands out at most 1000 rows at a time).
async function allRows<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await read(from, from + 999)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) return rows
  }
}

// recipe id -> its ingredient lines (OneNote's, else the confirmed ones). Kept for use with no connection.
export const loadIngredientLines = (): Promise<Record<string, string[]>> =>
  readThrough('ingredient-lines', async () => {
    const [lines, confirmed] = await Promise.all([
      allRows<{ recipe_id: string; text: string }>((from, to) => supabase.from('recipe_ingredients').select('recipe_id,text').order('recipe_id').order('position').range(from, to)),
      allRows<Suggestion>((from, to) => supabase.from('recipe_ingredient_suggestions').select('id,recipe_id,position,text,quote,status,source').eq('status', 'confirmed').order('recipe_id').order('position').range(from, to)),
    ])
    const written: Record<string, string[]> = {}
    for (const row of lines) (written[row.recipe_id] ??= []).push(row.text)
    const proposed: Record<string, Suggestion[]> = {}
    for (const row of confirmed) (proposed[row.recipe_id] ??= []).push(row)
    const out: Record<string, string[]> = {}
    for (const id of new Set([...Object.keys(written), ...Object.keys(proposed)])) out[id] = usableIngredients(written[id] ?? [], proposed[id] ?? []).lines
    return out
  })
