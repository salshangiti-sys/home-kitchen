// Reading and writing recipes. Recipe content is written only through the database functions
// save_recipe / import_recipes, which check the caller's role and the recipe's version.

import { supabase } from '../lib/supabase'
import type { ImportOutcome } from './importReport'
import type { MealType, RecipeDoc, RecipeStatus } from './types'

export interface RecipeSummary {
  id: string
  title: string
  status: RecipeStatus
  section: string
  search_norm: string
  meal_types: MealType[]
  kid_friendly: boolean | null
  lunchbox: boolean | null
  updated_at: string
}

export interface RecipeFlag {
  id: string
  flag: string
  status: 'open' | 'reviewed'
}

export interface LoadedRecipe {
  doc: RecipeDoc
  version: number
  favorite: boolean
  flags: RecipeFlag[]
}

export class VersionConflictError extends Error {
  constructor() {
    super('تعدّلت هذه الوصفة من مكان آخر بعد أن فتحتها، فلم يُحفظ شيء. انسخ تعديلك، ثم أعد فتح الوصفة.')
  }
}

function fail(error: { message: string } | null): asserts error is null {
  if (error) throw new Error(error.message)
}

export async function listRecipes(): Promise<{ recipes: RecipeSummary[]; favorites: Set<string>; openFlags: Set<string> }> {
  const [recipes, favorites, flags] = await Promise.all([
    supabase
      .from('recipes')
      .select('id,title,status,section,search_norm,meal_types,kid_friendly,lunchbox,updated_at')
      .is('deleted_at', null)
      .order('title'),
    supabase.from('user_favorites').select('recipe_id'),
    supabase.from('recipe_flags').select('recipe_id').eq('status', 'open'),
  ])
  fail(recipes.error)
  fail(favorites.error)
  fail(flags.error)
  return {
    recipes: recipes.data as RecipeSummary[],
    favorites: new Set(favorites.data.map((f) => f.recipe_id as string)),
    openFlags: new Set(flags.data.map((f) => f.recipe_id as string)),
  }
}

export async function loadRecipe(id: string): Promise<LoadedRecipe | null> {
  const [doc, row, favorite, flags] = await Promise.all([
    supabase.rpc('recipe_doc', { recipe_id: id }),
    supabase.from('recipes').select('version').eq('id', id).maybeSingle(),
    supabase.from('user_favorites').select('recipe_id').eq('recipe_id', id).maybeSingle(),
    supabase.from('recipe_flags').select('id,flag,status').eq('recipe_id', id).order('flag'),
  ])
  fail(doc.error)
  fail(row.error)
  if (!doc.data || !row.data) return null
  return {
    doc: doc.data as RecipeDoc,
    version: row.data.version as number,
    favorite: !!favorite.data,
    flags: (flags.data ?? []) as RecipeFlag[],
  }
}

// Saves an edited or new recipe. Returns its id (new recipes get one from the server).
export async function saveRecipe(doc: RecipeDoc, expectedVersion: number | null): Promise<string> {
  const { data, error } = await supabase.rpc('save_recipe', { p_doc: doc, p_expected_version: expectedVersion, p_origin: 'app' })
  if (error?.message === 'version_conflict') throw new VersionConflictError()
  fail(error)
  return (data as { id: string }).id
}

export async function setFavorite(recipeId: string, userId: string, favorite: boolean): Promise<void> {
  const { error } = favorite
    ? await supabase.from('user_favorites').insert({ user_id: userId, recipe_id: recipeId })
    : await supabase.from('user_favorites').delete().eq('recipe_id', recipeId).eq('user_id', userId)
  fail(error)
}

export async function setFlagStatus(flagId: string, status: 'open' | 'reviewed'): Promise<void> {
  const { error } = await supabase.rpc('set_flag_status', { p_flag_id: flagId, p_status: status })
  fail(error)
}

export async function importBatch(docs: RecipeDoc[], dryRun: boolean): Promise<ImportOutcome[]> {
  const { data, error } = await supabase.rpc('import_recipes', { p_docs: docs, p_dry_run: dryRun })
  fail(error)
  return data as ImportOutcome[]
}

export async function exportRecipes(): Promise<RecipeDoc[]> {
  const { data, error } = await supabase.rpc('export_recipes')
  fail(error)
  return data as RecipeDoc[]
}

export function downloadJson(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}
