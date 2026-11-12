// Cooking history: when a recipe was cooked, how it turned out, and what was changed. Written only
// through database functions that check who you are (see the cook_log migration): everyone in the
// family can add an entry and change or remove their own.

import { supabase } from '../lib/supabase'
import { explain, looksOffline, readThrough } from '../offline/readThrough'

export const MAX_NOTE = 2000

export interface CookEntry {
  id: string
  recipe_id: string
  user_id: string
  cooked_on: string // YYYY-MM-DD
  rating: number | null
  note: string | null
  created_at: string
}

export interface EntryInput {
  cooked_on: string
  rating: number | null
  note: string
}

const COLUMNS = 'id,recipe_id,user_id,cooked_on,rating,note,created_at'

const MESSAGES: Array<[RegExp, string]> = [
  [/bad_date/, 'التاريخ غير صحيح. اختاري يومًا لم يأتِ بعد.'],
  [/bad_rating/, 'التقييم من 1 إلى 5.'],
  [/note_too_long/, `الملاحظة أطول من ${MAX_NOTE} حرف.`],
  [/version_conflict/, 'تغيّرت الوصفة بعد أن فتحتِ هذه الصفحة، فلم يُسترجع شيء. أعيدي تحميل الصفحة ثم حاولي مرة أخرى.'],
  [/linked_to_onenote/, 'نص هذه الوصفة يُغيَّر في OneNote، فلا يُسترجع هنا.'],
  [/in_trash/, 'الوصفة في سلة المحذوفات. استرجعيها من السلة أولًا.'],
  [/no_such_version/, 'هذا الإصدار غير موجود.'],
  [/row-level security|not allowed|42501/i, 'لا يمكنك تعديل هذه التجربة، أو أن الوصفة في سلة المحذوفات.'],
]

// A message for the person: no connection says so, known database refusals are in Arabic.
export function historyMessage(error: unknown): string {
  if (looksOffline(error)) return explain(error).message
  const text = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error)
  return MESSAGES.find(([pattern]) => pattern.test(text))?.[1] ?? text
}

const fail = (error: { message: string } | null): void => {
  if (error) throw new Error(error.message)
}

// Newest first. Kept on the device for reading without a connection (a copy per signed-in person).
export const listCookLog = (recipeId: string): Promise<CookEntry[]> =>
  readThrough(`cooklog:${recipeId}`, async () => {
    const { data, error } = await supabase
      .from('cook_log')
      .select(COLUMNS)
      .eq('recipe_id', recipeId)
      .is('deleted_at', null)
      .order('cooked_on', { ascending: false })
      .order('created_at', { ascending: false })
    fail(error)
    return data as CookEntry[]
  })

export async function addCookEntry(recipeId: string, input: EntryInput): Promise<void> {
  const { error } = await supabase.rpc('add_cook_entry', {
    p_id: crypto.randomUUID(),
    p_recipe_id: recipeId,
    p_cooked_on: input.cooked_on,
    p_rating: input.rating,
    p_note: input.note,
  })
  fail(error)
}

export async function updateCookEntry(id: string, input: EntryInput): Promise<void> {
  const { error } = await supabase.rpc('update_cook_entry', { p_id: id, p_cooked_on: input.cooked_on, p_rating: input.rating, p_note: input.note })
  fail(error)
}

export async function removeCookEntry(id: string): Promise<void> {
  const { error } = await supabase.rpc('remove_cook_entry', { p_id: id })
  fail(error)
}

// ---- Pure helpers (tested) ----

const pad = (n: number) => String(n).padStart(2, '0')

// Today's date on this device, as YYYY-MM-DD (not the UTC date: late at night they differ).
export const localDate = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

const dayNumber = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000)
}

export const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from)

// "today", "yesterday", "3 days ago"… for a date compared with today.
export function daysAgo(date: string, today: string): string {
  const days = daysBetween(date, today)
  if (days < 0) return 'غدًا'
  if (days === 0) return 'اليوم'
  if (days === 1) return 'أمس'
  if (days === 2) return 'قبل يومين'
  if (days < 11) return `قبل ${days} أيام`
  if (days < 30) return `قبل ${days} يومًا`
  const months = Math.floor(days / 30)
  if (months < 12) return months === 1 ? 'قبل شهر' : months === 2 ? 'قبل شهرين' : months < 11 ? `قبل ${months} أشهر` : `قبل ${months} شهرًا`
  const years = Math.floor(days / 365)
  return years === 1 ? 'قبل سنة' : years === 2 ? 'قبل سنتين' : `قبل ${years} سنوات`
}

const formatter = new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' })

export function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return formatter.format(new Date(y, m - 1, d))
}

export interface Summary {
  count: number
  lastOn: string | null
  average: number | null // of the entries that have a rating, one decimal
}

export function summarize(entries: CookEntry[]): Summary {
  const rated = entries.filter((e) => e.rating !== null).map((e) => e.rating as number)
  return {
    count: entries.length,
    lastOn: entries.reduce<string | null>((latest, e) => (latest === null || e.cooked_on > latest ? e.cooked_on : latest), null),
    average: rated.length ? Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10 : null,
  }
}

export function timesLabel(count: number): string {
  if (count === 1) return 'طُبخت مرة واحدة'
  if (count === 2) return 'طُبخت مرتين'
  if (count < 11) return `طُبخت ${count} مرات`
  return `طُبخت ${count} مرة`
}

// ---- Cooking statistics for the library ----

export interface CookStat {
  count: number
  lastOn: string // YYYY-MM-DD
}

// How many times each recipe was cooked and when last, from everyone's history. Kept on the device
// for use without a connection.
export const listCookStats = (): Promise<Map<string, CookStat>> =>
  readThrough('cookstats', async () => {
    const { data, error } = await supabase.from('cook_log').select('recipe_id,cooked_on').is('deleted_at', null)
    fail(error)
    const stats = new Map<string, CookStat>()
    for (const row of data as Array<{ recipe_id: string; cooked_on: string }>) {
      const current = stats.get(row.recipe_id)
      stats.set(row.recipe_id, { count: (current?.count ?? 0) + 1, lastOn: current && current.lastOn > row.cooked_on ? current.lastOn : row.cooked_on })
    }
    return stats
  })
