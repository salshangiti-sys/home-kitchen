// Ingredients proposed for recipes whose OneNote page has no ingredient lines (they are written inside
// the method or the notes). Each is a SUGGESTION until an owner or editor confirms it; nothing is used
// (shopping list, prep) before that. They are kept apart from the recipe text, so reading the page
// from OneNote never overwrites them, and they never change OneNote. See the ingredient_suggestions
// migration.

import { supabase } from '../lib/supabase'
import { explain, looksOffline, readThrough } from '../offline/readThrough'

export type SuggestionStatus = 'suggested' | 'confirmed' | 'ignored'
export type SuggestionSource = 'method' | 'notes' | 'text' | 'manual'

export interface Suggestion {
  id: string
  recipe_id: string
  position: number
  text: string
  quote: string | null
  status: SuggestionStatus
  source: SuggestionSource
}

const COLUMNS = 'id,recipe_id,position,text,quote,status,source'

export const loadSuggestions = (recipeId: string): Promise<Suggestion[]> =>
  readThrough(`ingredient-suggestions:${recipeId}`, async () => {
    const { data, error } = await supabase.from('recipe_ingredient_suggestions').select(COLUMNS).eq('recipe_id', recipeId).order('position').order('id')
    if (error) throw new Error(error.message)
    return data as Suggestion[]
  })

export interface RecipeRef {
  id: string
  title: string
  section: string
}

export interface ReviewData {
  suggestions: Suggestion[]
  recipes: RecipeRef[]
}

// Every suggestion of the household, with the recipes they belong to.
export const loadReview = (): Promise<ReviewData> =>
  readThrough('ingredient-review', async () => {
    const found = await supabase.from('recipe_ingredient_suggestions').select(COLUMNS).order('recipe_id').order('position').limit(5000)
    if (found.error) throw new Error(found.error.message)
    const suggestions = found.data as Suggestion[]
    const ids = [...new Set(suggestions.map((s) => s.recipe_id))]
    if (!ids.length) return { suggestions, recipes: [] }
    const recipes = await supabase.from('recipes').select('id,title,section').in('id', ids).is('deleted_at', null)
    if (recipes.error) throw new Error(recipes.error.message)
    return { suggestions, recipes: recipes.data as RecipeRef[] }
  })

async function rpc<T = void>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  return data as T
}

export const setSuggestion = (id: string, status: SuggestionStatus, text: string | null = null) => rpc('set_ingredient_suggestion', { p_id: id, p_status: status, p_text: text })
export const addIngredient = (recipeId: string, text: string) => rpc<string>('add_ingredient', { p_recipe: recipeId, p_text: text })
export const confirmAll = (recipeId: string) => rpc<number>('confirm_recipe_suggestions', { p_recipe: recipeId })

const MESSAGES: Array<[RegExp, string]> = [
  [/duplicate key|unique/i, 'هذا المقدار مكتوب أصلًا لهذه الوصفة.'],
  [/check constraint|char_length/i, 'نص المقدار من 1 إلى 200 حرف.'],
  [/not allowed|42501/i, 'لا تملكين صلاحية تعديل المقادير.'],
]

export function ingredientMessage(error: unknown): string {
  if (looksOffline(error)) return explain(error).message
  const text = error instanceof Error ? error.message : String(error)
  return MESSAGES.find(([pattern]) => pattern.test(text))?.[1] ?? text
}

// ---- Pure helpers (tested) ----

export interface ReviewGroup {
  recipe: RecipeRef
  lines: Suggestion[]
  waiting: number // lines still "suggested"
  quotes: string[] // the passages of the recipe the lines came from, each once
}

const bySectionThenTitle = (a: ReviewGroup, b: ReviewGroup) => a.recipe.section.localeCompare(b.recipe.section, 'ar') || a.recipe.title.localeCompare(b.recipe.title, 'ar')

// The suggestions grouped by recipe: the recipes with lines still waiting first, the ones fully
// reviewed apart. A suggestion whose recipe is not in `recipes` (in the trash) is left out.
export function groupReview(data: ReviewData): { waiting: ReviewGroup[]; done: ReviewGroup[] } {
  const recipes = new Map(data.recipes.map((r) => [r.id, r]))
  const byRecipe = new Map<string, Suggestion[]>()
  for (const s of data.suggestions) if (recipes.has(s.recipe_id)) byRecipe.set(s.recipe_id, [...(byRecipe.get(s.recipe_id) ?? []), s])
  const groups: ReviewGroup[] = [...byRecipe].map(([id, all]) => {
    const lines = [...all].sort((a, b) => a.position - b.position)
    return { recipe: recipes.get(id)!, lines, waiting: lines.filter((l) => l.status === 'suggested').length, quotes: [...new Set(lines.flatMap((l) => (l.quote ? [l.quote] : [])))] }
  })
  return { waiting: groups.filter((g) => g.waiting > 0).sort(bySectionThenTitle), done: groups.filter((g) => g.waiting === 0).sort(bySectionThenTitle) }
}

// The ingredient lines the app uses for a recipe: the ones read from OneNote when there are any;
// otherwise the lines the person confirmed here (in order). Lines still waiting or ignored are never used.
export function usableIngredients(oneNoteLines: string[], suggestions: Suggestion[]): { lines: string[]; from: 'onenote' | 'app' | 'none' } {
  if (oneNoteLines.length) return { lines: oneNoteLines, from: 'onenote' }
  const confirmed = suggestions.filter((s) => s.status === 'confirmed').sort((a, b) => a.position - b.position).map((s) => s.text)
  return confirmed.length ? { lines: confirmed, from: 'app' } : { lines: [], from: 'none' }
}
