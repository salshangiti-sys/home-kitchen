// What she teaches the ingredient dictionary: names it does not know, taught as "the same as" a known
// name, or as an item of their own in a shop aisle. Everyone in the household reads them; owners and
// editors teach and remove them (see the ingredient_aliases migration). They change only how lines are
// grouped and shown, never a recipe or OneNote.

import { supabase } from '../lib/supabase'
import { explain, looksOffline, readThrough } from '../offline/readThrough'
import { identifyAll, type Lesson } from './catalog'
import { AISLE_LABELS, dictionaryNames } from './dictionary'

export type { Lesson }

export const loadLessons = (): Promise<Lesson[]> =>
  readThrough('ingredient-aliases', async () => {
    const { data, error } = await supabase.from('ingredient_aliases').select('name_key,target,aisle').order('name_key')
    if (error) throw new Error(error.message)
    return data as Lesson[]
  })

async function rpc(name: string, args: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
}

export const teach = (key: string, target: string | null, aisle: Lesson['aisle']) => rpc('set_ingredient_alias', { p_key: key, p_target: target, p_aisle: aisle })
export const forget = (key: string) => rpc('remove_ingredient_alias', { p_key: key })

const MESSAGES: Array<[RegExp, string]> = [
  [/check constraint|char_length/i, 'الاسم من 1 إلى 120 حرفًا.'],
  [/not allowed|42501/i, 'لا تملكين صلاحية تعليم القاموس.'],
]

export function lessonMessage(error: unknown): string {
  if (looksOffline(error)) return explain(error).message
  const text = error instanceof Error ? error.message : String(error)
  return MESSAGES.find(([pattern]) => pattern.test(text))?.[1] ?? text
}

// ---- Pure helpers (tested) ----

export interface Unknown {
  key: string // the name the app groups it under (what a lesson is saved by)
  label: string // as written
  recipes: number // in how many recipes
  example: string // a line it came from
}

// The names in these ingredient lines that the dictionary (with the lessons already taught) does not
// know: the most used first. Sentences, links and water are left out.
export function unknownNames(linesByRecipe: Record<string, string[]>): Unknown[] {
  const found = new Map<string, Unknown & { ids: Set<string> }>()
  for (const [recipe, lines] of Object.entries(linesByRecipe)) {
    for (const line of lines) {
      const items = identifyAll(line)
      if (items.length === 1 && items[0].sentence) continue
      for (const item of items) {
        if (item.known || item.sentence || !item.key || item.aisle === 'none') continue
        const entry = found.get(item.key) ?? { key: item.key, label: item.label, recipes: 0, example: line, ids: new Set<string>() }
        entry.ids.add(recipe)
        entry.recipes = entry.ids.size
        found.set(item.key, entry)
      }
    }
  }
  return [...found.values()]
    .map(({ ids: _ids, ...rest }) => rest)
    .sort((a, b) => b.recipes - a.recipes || a.label.localeCompare(b.label, 'ar'))
}

export const AISLE_CHOICES = Object.entries(AISLE_LABELS).map(([aisle, label]) => ({ aisle: aisle as Lesson['aisle'], label }))
export const SAME_AS = dictionaryNames()
