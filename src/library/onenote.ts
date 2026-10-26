// The recipe notebook in OneNote, as the app sees it. The app reads pages and can create new ones;
// it never changes an existing page (see supabase/functions/onenote-library).

import { callFunction, supabase } from '../lib/supabase'
import type { RecipeDoc } from './types'

export interface LibraryInfo {
  notebook_name: string
  sections: Array<{ id: string; name: string }>
  last_checked_at: string | null
  last_error: string | null
}

export interface RecipePage {
  page_id: string
  section_name: string | null
  web_url: string | null
  client_url: string | null
  created_by_app: boolean
  read_status: 'ok' | 'missing' | 'error'
  last_read_at: string | null
  last_error: string | null
}

export interface UnlinkedPage {
  page_id: string
  title: string
  section_name: string | null
  web_url: string | null
}

export interface MissingPage {
  recipe_id: string
  title: string
  section_name: string | null
}

export interface CheckSummary {
  pages: number
  unlinked: number
  missing: string[]
  refreshed: number
  changed: number
}

export interface RefreshOutcome {
  status: 'ok' | 'missing' | 'error'
  result: 'created' | 'updated' | 'unchanged' | null
  error: string | null
}

// The notebook's name for recipes (decided 2026-10-26).
export const RECIPE_NOTEBOOK = 'وصفاتي'
// How often the app looks for new and changed pages on its own.
export const CHECK_EVERY_MS = 3 * 60 * 60 * 1000

// What the OneNote function's error codes mean, for the owner.
const ERRORS: Record<string, string> = {
  notebook_not_found: 'لا يوجد دفتر بهذا الاسم في حساب OneNote. اختاري اسمه من القائمة.',
  not_linked: 'دفتر الوصفات غير مربوط بعد.',
  wrong_notebook: 'هذه الصفحة ليست في دفتر الوصفات.',
  unknown_section: 'هذا القسم غير موجود في دفتر الوصفات. افحصي الدفتر ثم حاولي مرة أخرى.',
  needs_reconnect: 'يلزم ربط حساب Microsoft من جديد (من صفحة OneNote في التطبيق).',
  version_conflict: 'تغيّرت الوصفة أثناء القراءة. أعيدي فتحها.',
  forbidden: 'هذا متاح لصاحبة الحساب فقط.',
  graph_error: 'لم يردّ OneNote كما يجب. حاولي بعد قليل.',
}

async function call<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  try {
    return await callFunction<T>('onenote-library', { action, ...body })
  } catch (error) {
    const code = (error as { code?: string }).code
    throw new Error(code && ERRORS[code] ? ERRORS[code] : (error as Error).message)
  }
}

export const listNotebooks = () => call<string[]>('notebooks')

export async function loadLibrary(): Promise<LibraryInfo | null> {
  const { data, error } = await supabase.from('onenote_library').select('notebook_name,sections,last_checked_at,last_error').maybeSingle()
  if (error) throw new Error(error.message)
  return data as LibraryInfo | null
}

export async function loadRecipePage(recipeId: string): Promise<RecipePage | null> {
  const { data, error } = await supabase
    .from('recipe_pages')
    .select('page_id,section_name,web_url,client_url,created_by_app,read_status,last_read_at,last_error')
    .eq('recipe_id', recipeId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as RecipePage | null
}

export async function listUnlinked(): Promise<UnlinkedPage[]> {
  const { data, error } = await supabase.from('onenote_unlinked_pages').select('page_id,title,section_name,web_url').order('section_name').order('title')
  if (error) throw new Error(error.message)
  return data as UnlinkedPage[]
}

export async function listMissing(): Promise<MissingPage[]> {
  const { data, error } = await supabase
    .from('recipe_pages')
    .select('recipe_id,section_name,recipes!inner(title,deleted_at)')
    .eq('read_status', 'missing')
    .is('recipes.deleted_at', null)
  if (error) throw new Error(error.message)
  return (data as unknown as Array<{ recipe_id: string; section_name: string | null; recipes: { title: string } }>).map((row) => ({
    recipe_id: row.recipe_id,
    section_name: row.section_name,
    title: row.recipes.title,
  }))
}

export async function msConnection(): Promise<{ status: string; display_name: string | null } | null> {
  const { data } = await supabase.from('ms_connections').select('status,display_name').maybeSingle()
  return data
}

export async function connectMicrosoft(returnTo: string) {
  const { url } = await callFunction<{ url: string }>('ms-oauth-start', { returnTo })
  window.location.assign(url)
}

export const connectNotebook = (notebookName: string) => call<{ notebookName: string }>('connect', { notebookName })
export const checkNotebook = () => call<CheckSummary>('check')
export const refreshFromPage = (recipeId: string) => call<RefreshOutcome>('refresh', { recipeId })
export const addPageAsRecipe = (pageId: string) => call<{ recipeId: string }>('add-page', { pageId })
export const linkPageToRecipe = (pageId: string, recipeId: string) => call<RefreshOutcome>('link-page', { pageId, recipeId })
export const linkImportedRecipes = () => call<{ linked: number; missing: number; remaining: boolean }>('link-imported')
export const createPage = (doc: RecipeDoc, sectionName: string, blank: boolean) =>
  call<{ recipeId: string; webUrl: string | null; clientUrl: string | null }>('create-page', { doc, sectionName, blank })

// Looks for new and changed pages when the last look was more than CHECK_EVERY_MS ago. Runs at
// most once at a time per tab; failures are kept on the library row and shown on the OneNote page.
let checking: Promise<void> | null = null
export function checkIfDue(library: LibraryInfo | null, now = Date.now()): Promise<void> {
  if (!library || checking) return checking ?? Promise.resolve()
  const last = library.last_checked_at ? Date.parse(library.last_checked_at) : 0
  if (now - last < CHECK_EVERY_MS) return Promise.resolve()
  checking = checkNotebook()
    .then(() => undefined, () => undefined)
    .finally(() => {
      checking = null
    })
  return checking
}

export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return 'لم يحدث بعد'
  const minutes = Math.round((now - Date.parse(iso)) / 60_000)
  if (minutes < 1) return 'الآن'
  if (minutes < 60) return `قبل ${minutes} دقيقة`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `قبل ${hours} ساعة`
  return `قبل ${Math.round(hours / 24)} يوم`
}
