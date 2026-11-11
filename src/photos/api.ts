// Recipe photos: the files are in a private storage bucket (see the recipe_photos migration), and a
// photo is only ever shown through a short-lived signed address. Adding uploads both files first,
// then records the photo, so the list never points at a file that is not there.

import { supabase } from '../lib/supabase'
import { explain, looksOffline } from '../offline/readThrough'
import { PhotoError, processPhoto, type ProcessedPhoto } from './image'

export const BUCKET = 'recipe-photos'
export const MAX_PHOTOS = 10
const URL_SECONDS = 3600
// Signed addresses are reused for most of their life, then asked for again.
const URL_REUSE_MS = (URL_SECONDS - 600) * 1000

export interface Photo {
  id: string
  recipe_id: string
  path: string
  thumb_path: string
  width: number
  height: number
  bytes: number
  position: number
  created_at: string
}

const COLUMNS = 'id,recipe_id,path,thumb_path,width,height,bytes,position,created_at'

// The same paths the database computes (private.photo_path).
export const photoPath = (household: string, recipe: string, photo: string, thumb: boolean) =>
  `${household}/${recipe}/${photo}${thumb ? '-thumb' : ''}.jpg`

const MESSAGES: Array<[RegExp, string]> = [
  [/photo_limit/, `لكل وصفة حتى ${MAX_PHOTOS} صور. احذفي صورة لتضيفي أخرى.`],
  [/photo_files_missing/, 'لم يكتمل رفع الصورة. حاولي مرة أخرى.'],
  [/row-level security|not allowed|42501/i, 'لا تملكين صلاحية تعديل صور هذه الوصفة.'],
  [/exceeded the maximum|too large|payload/i, 'حجم الصورة كبير جدًا بعد التصغير. جرّبي صورة أخرى.'],
]

// A message for the person. Errors from this file are kept as they are.
export function photoMessage(error: unknown): string {
  if (error instanceof PhotoError) return error.message
  if (looksOffline(error)) return explain(error).message
  const text = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error)
  return MESSAGES.find(([pattern]) => pattern.test(text))?.[1] ?? text
}

const fail = (error: { message: string } | null): void => {
  if (error) throw new Error(error.message)
}

export async function listPhotos(recipeId: string): Promise<Photo[]> {
  const { data, error } = await supabase.from('recipe_photos').select(COLUMNS).eq('recipe_id', recipeId).is('deleted_at', null).order('position')
  fail(error)
  return data as Photo[]
}

const cache = new Map<string, { url: string; until: number }>()

// Signed addresses for the paths, asking only for those not already held.
export async function signedUrls(paths: string[]): Promise<Map<string, string>> {
  const now = Date.now()
  const result = new Map<string, string>()
  const missing = paths.filter((path) => {
    const held = cache.get(path)
    if (held && held.until > now) {
      result.set(path, held.url)
      return false
    }
    return true
  })
  for (let i = 0; i < missing.length; i += 100) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(missing.slice(i, i + 100), URL_SECONDS)
    fail(error)
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) {
        cache.set(item.path, { url: item.signedUrl, until: now + URL_REUSE_MS })
        result.set(item.path, item.signedUrl)
      }
    }
  }
  return result
}

export const forgetSignedUrls = () => cache.clear()

export async function addPhoto(recipeId: string, file: Blob, process: (file: Blob) => Promise<ProcessedPhoto> = processPhoto): Promise<Photo> {
  const processed = await process(file)

  const { data: recipe, error: recipeError } = await supabase.from('recipes').select('household_id').eq('id', recipeId).single()
  fail(recipeError)
  const household = (recipe as { household_id: string }).household_id

  const id = crypto.randomUUID()
  const files: Array<[string, Blob]> = [
    [photoPath(household, recipeId, id, false), processed.full],
    [photoPath(household, recipeId, id, true), processed.thumb],
  ]
  for (const [path, blob] of files) {
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false })
    fail(error)
  }

  const { data, error } = await supabase.rpc('add_recipe_photo', {
    p_id: id,
    p_recipe_id: recipeId,
    p_width: processed.width,
    p_height: processed.height,
    p_bytes: processed.full.size,
  })
  fail(error)
  return data as Photo
}

export async function removePhoto(id: string): Promise<void> {
  const { error } = await supabase.rpc('remove_recipe_photo', { p_id: id })
  fail(error)
}

export async function makeCover(id: string): Promise<void> {
  const { error } = await supabase.rpc('make_cover_photo', { p_id: id })
  fail(error)
}

// The cover photo's small version for each recipe that has one, for the library list. A problem
// (for example no connection) just means no pictures, never an error on the list.
export async function coverThumbs(): Promise<Map<string, string>> {
  try {
    const { data, error } = await supabase.from('recipe_photos').select('recipe_id,thumb_path,position').is('deleted_at', null).order('position')
    fail(error)
    const cover = new Map<string, string>()
    for (const row of data as Array<{ recipe_id: string; thumb_path: string }>) if (!cover.has(row.recipe_id)) cover.set(row.recipe_id, row.thumb_path)
    const urls = await signedUrls([...cover.values()])
    return new Map([...cover].flatMap(([recipe, path]) => (urls.has(path) ? [[recipe, urls.get(path)!] as [string, string]] : [])))
  } catch {
    return new Map()
  }
}
