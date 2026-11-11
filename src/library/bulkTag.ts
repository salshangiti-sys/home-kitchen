// Tagging many recipes at once. Only the tags change (meal type, "for kids", "lunch box", and added
// private tags); the recipes' text is never touched. The database does the work in one transaction
// (bulk_tag_recipes), and can first only count what it would change, so the person sees the effect
// before agreeing to it.

import { supabase } from '../lib/supabase'
import { explain, looksOffline } from '../offline/readThrough'
import { MEAL_TYPES, type MealType } from './types'

export type MealAction = 'add' | 'remove'
// For "for kids" and "lunch box": leave as is, set to yes, set to no, or clear (not set).
export type Choice = 'keep' | 'yes' | 'no' | 'unset'

export interface BulkChoices {
  meals: Partial<Record<MealType, MealAction>>
  kid: Choice
  lunchbox: Choice
  custom: string // new private tags, separated by commas
}

export const emptyChoices = (): BulkChoices => ({ meals: {}, kid: 'keep', lunchbox: 'keep', custom: '' })

export interface Changes {
  meal_types?: { add?: MealType[]; remove?: MealType[] }
  kid_friendly?: boolean | null
  lunchbox?: boolean | null
  custom?: { add: string[] }
}

export const MAX_TAG_LENGTH = 40
export const MAX_NEW_TAGS = 10
export const MAX_RECIPES = 300

const toValue = (choice: Choice): boolean | null => (choice === 'yes' ? true : choice === 'no' ? false : null)

export function parseTags(text: string): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const part of text.split(/[,،]/)) {
    const tag = part.trim()
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase())
      tags.push(tag)
    }
  }
  return tags
}

// What the person chose, in the shape the database takes. `changes` is null when nothing is chosen;
// `problem` explains a choice that the database would refuse.
export function buildChanges(choices: BulkChoices): { changes: Changes | null; problem: string | null } {
  const changes: Changes = {}
  const add = MEAL_TYPES.filter((type) => choices.meals[type] === 'add')
  const remove = MEAL_TYPES.filter((type) => choices.meals[type] === 'remove')
  if (add.length || remove.length) {
    changes.meal_types = {}
    if (add.length) changes.meal_types.add = add
    if (remove.length) changes.meal_types.remove = remove
  }
  if (choices.kid !== 'keep') changes.kid_friendly = toValue(choices.kid)
  if (choices.lunchbox !== 'keep') changes.lunchbox = toValue(choices.lunchbox)

  const tags = parseTags(choices.custom)
  if (tags.length) changes.custom = { add: tags }

  if (tags.length > MAX_NEW_TAGS) return { changes: null, problem: `أضيفي حتى ${MAX_NEW_TAGS} وسوم خاصة في المرة الواحدة.` }
  if (tags.some((tag) => tag.length > MAX_TAG_LENGTH)) return { changes: null, problem: `الوسم الخاص حتى ${MAX_TAG_LENGTH} حرفًا.` }
  return { changes: Object.keys(changes).length ? changes : null, problem: null }
}

export interface BulkResult {
  changed: number
  unchanged: number
  skipped: number
  dry_run: boolean
}

export async function bulkTag(ids: string[], changes: Changes, dryRun: boolean): Promise<BulkResult> {
  const { data, error } = await supabase.rpc('bulk_tag_recipes', { p_ids: ids, p_changes: changes, p_dry_run: dryRun })
  if (error) throw new Error(error.message)
  return data as BulkResult
}

const MESSAGES: Array<[RegExp, string]> = [
  [/too_many/, `يمكن توسيم حتى ${MAX_RECIPES} وصفة في المرة الواحدة. قلّلي المحدّد.`],
  [/bad_tag/, `الوسم الخاص من 1 إلى ${MAX_TAG_LENGTH} حرفًا، وحتى ${MAX_NEW_TAGS} وسوم في المرة.`],
  [/no_changes|no_recipes/, 'اختاري وصفة واحدة على الأقل وتغييرًا واحدًا على الأقل.'],
  [/bad_changes|bad_meal_type/, 'اختيار غير صالح. أعيدي المحاولة.'],
  [/not allowed|42501/i, 'لا تملكين صلاحية تعديل وسوم الوصفات.'],
]

export function bulkMessage(error: unknown): string {
  if (looksOffline(error)) return explain(error).message
  const text = error instanceof Error ? error.message : String(error)
  return MESSAGES.find(([pattern]) => pattern.test(text))?.[1] ?? text
}

// A sentence for the preview: how many recipes would change.
export function previewText(result: BulkResult, selected: number): string {
  const { changed, unchanged, skipped } = result
  if (changed === 0) return 'لا شيء سيتغير: كل الوصفات المحدّدة عليها هذه الوسوم أصلًا.'
  const parts = [`ستتغير ${changed} من ${selected} ${selected === 1 ? 'وصفة' : 'وصفات'}.`]
  if (unchanged > 0) parts.push(`${unchanged} عليها هذه الوسوم أصلًا فلن تتغير.`)
  if (skipped > 0) parts.push(`${skipped} لم تُوجد أو في سلة المحذوفات فستُتخطّى.`)
  return parts.join(' ')
}
