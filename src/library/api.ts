// Reading and writing recipes. Recipe content is written only through the database functions
// save_recipe / import_recipes, which check the caller's role and the recipe's version.

import { supabase } from '../lib/supabase'
import { readThrough, save, saved } from '../offline/readThrough'
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
  // When it was moved to the trash, if it is there.
  trashedAt: string | null
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

type RecipeList = { recipes: RecipeSummary[]; favorites: Set<string>; openFlags: Set<string> }

// With no connection, the last list seen on this device is shown (see src/offline).
export const listRecipes = (): Promise<RecipeList> => readThrough('list', fetchRecipeList)

async function fetchRecipeList(): Promise<RecipeList> {
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
  // Favorites and flags of deleted recipes stay in their tables; only shown recipes count.
  const shown = new Set((recipes.data as RecipeSummary[]).map((r) => r.id))
  const ids = (rows: Array<{ recipe_id: unknown }>) => new Set(rows.map((row) => row.recipe_id as string).filter((id) => shown.has(id)))
  return {
    recipes: recipes.data as RecipeSummary[],
    favorites: ids(favorites.data),
    openFlags: ids(flags.data),
  }
}

// With no connection, the recipe as last opened here, or else as last saved in the background copy
// of every recipe (without its review notes, and read-only: it has no version to save against).
export const loadRecipe = (id: string): Promise<LoadedRecipe | null> =>
  readThrough(`recipe:${id}`, () => fetchRecipe(id), async () => {
    const doc = (await saved<Record<string, RecipeDoc>>('docs'))?.[id]
    if (!doc) return undefined
    const list = await saved<RecipeList>('list')
    return { doc, version: 0, trashedAt: null, favorite: list?.favorites.has(id) ?? false, flags: [] }
  })

async function fetchRecipe(id: string): Promise<LoadedRecipe | null> {
  const [doc, row, favorite, flags] = await Promise.all([
    supabase.rpc('recipe_doc', { recipe_id: id }),
    supabase.from('recipes').select('version,deleted_at').eq('id', id).maybeSingle(),
    supabase.from('user_favorites').select('recipe_id').eq('recipe_id', id).maybeSingle(),
    supabase.from('recipe_flags').select('id,flag,status').eq('recipe_id', id).order('flag'),
  ])
  fail(doc.error)
  fail(row.error)
  if (!doc.data || !row.data) return null
  return {
    doc: doc.data as RecipeDoc,
    version: row.data.version as number,
    trashedAt: (row.data.deleted_at as string | null) ?? null,
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

// Trash: a recipe is hidden, not erased, and can be restored. Only owners and editors can do either.
export interface TrashedRecipe {
  id: string
  title: string
  section: string
  deleted_at: string
}

export async function trashRecipe(id: string): Promise<void> {
  const { error } = await supabase.rpc('trash_recipe', { p_id: id })
  fail(error)
}

export async function restoreRecipe(id: string): Promise<void> {
  const { error } = await supabase.rpc('restore_recipe', { p_id: id })
  fail(error)
}

export async function countTrash(): Promise<number> {
  const { count, error } = await supabase.from('recipes').select('id', { count: 'exact', head: true }).not('deleted_at', 'is', null)
  fail(error)
  return count ?? 0
}

export async function listTrash(): Promise<TrashedRecipe[]> {
  const { data, error } = await supabase.from('recipes').select('id,title,section,deleted_at').not('deleted_at', 'is', null).order('deleted_at', { ascending: false })
  fail(error)
  return data as TrashedRecipe[]
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

const COPY_EVERY_MS = 6 * 60 * 60 * 1000

// Saves every recipe on this device (one request) so any of them can be read with no signal.
// Runs at most every few hours.
export async function keepRecipesForOffline(): Promise<void> {
  const last = await saved<string>('docs-saved-at')
  if (last && Date.now() - Date.parse(last) < COPY_EVERY_MS) return
  const docs = await exportRecipes()
  await save('docs', Object.fromEntries(docs.map((doc) => [doc.id, doc])))
  await save('docs-saved-at', new Date().toISOString())
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
