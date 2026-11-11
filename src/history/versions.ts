// Earlier versions of a recipe. Every save in the app, every read of a changed OneNote page and every
// import keeps a full copy of the recipe (the recipe_versions table), readable by the family. Here a
// copy is turned into labelled lines of text and two versions are compared line by line, so a change
// shows as "removed" and "added" lines. Nothing here changes a recipe.

import { supabase } from '../lib/supabase'
import { readThrough } from '../offline/readThrough'
import { MEAL_TYPE_LABELS, STATUS_LABELS, type RecipeDoc } from '../library/types'

export type Origin = 'app' | 'import' | 'onenote' | 'restore'

export interface RecipeVersion {
  version: number
  origin: Origin
  changed_at: string
  snapshot: RecipeDoc
}

// Oldest first in the database order; returned newest first.
export const listVersions = (recipeId: string): Promise<RecipeVersion[]> =>
  readThrough(`versions:${recipeId}`, async () => {
    const { data, error } = await supabase
      .from('recipe_versions')
      .select('version,origin,changed_at,snapshot')
      .eq('recipe_id', recipeId)
      .order('version', { ascending: false })
    if (error) throw new Error(error.message)
    return data as RecipeVersion[]
  })

export interface RestoreResult {
  version: number
  result: 'updated' | 'unchanged'
}

// Saves an earlier version as a new one. The database reads the copy itself (it is never sent from
// here) and refuses a recipe in the trash, one linked to a OneNote page, or one that has changed
// since `expectedVersion` was read.
export async function restoreVersion(recipeId: string, version: number, expectedVersion: number): Promise<RestoreResult> {
  const { data, error } = await supabase.rpc('restore_recipe_version', { p_recipe_id: recipeId, p_version: version, p_expected_version: expectedVersion })
  if (error) throw new Error(error.message)
  return data as RestoreResult
}

export function originLabel(origin: Origin, version: number): string {
  switch (origin) {
    case 'app':
      return version === 1 ? 'أُنشئت في التطبيق' : 'عُدّلت في التطبيق'
    case 'onenote':
      return version === 1 ? 'أُضيفت من OneNote' : 'تغيّرت صفحتها في OneNote'
    case 'import':
      return version === 1 ? 'استُوردت من الملف' : 'استيراد من الملف'
    case 'restore':
      return 'استرجاع إصدار سابق'
  }
}

export interface Line {
  label: string
  text: string
}

// The recipe as labelled lines, in page order. The original page text is included only when the
// recipe has nothing else (a plain note), because the other parts are made from it.
export function docLines(doc: RecipeDoc): Line[] {
  const lines: Line[] = []
  const add = (label: string, text: string | null | undefined) => {
    const trimmed = text?.trim()
    if (trimmed) lines.push({ label, text: trimmed })
  }
  add('العنوان', doc.title)
  add('القسم', doc.category?.section)
  add('الحالة', STATUS_LABELS[doc.status] ?? doc.status)
  if (doc.servings != null) add('الحصص', String(doc.servings))
  if (doc.prep_time_min != null) add('التحضير', `${doc.prep_time_min} دقيقة`)
  if (doc.cook_time_min != null) add('الطبخ', `${doc.cook_time_min} دقيقة`)
  for (const type of doc.tags?.meal_types ?? []) add('نوع الوجبة', MEAL_TYPE_LABELS[type] ?? type)
  if (doc.tags?.kid_friendly) add('الوسوم', 'مناسبة للأطفال')
  if (doc.tags?.lunchbox) add('الوسوم', 'لانش بوكس')
  for (const tag of doc.tags?.custom ?? []) add('الوسوم', tag)
  for (const source of doc.sources ?? []) add('المصدر', source.label ? `${source.label} — ${source.url}` : source.url)
  for (const group of doc.ingredient_groups ?? []) {
    if (group.name) add('مجموعة مقادير', group.name)
    for (const item of group.items) add('المقادير', item.text)
  }
  for (const step of [...(doc.steps ?? [])].sort((a, b) => a.order - b.order)) add('الطريقة', step.text)
  for (const note of doc.notes ?? []) add('ملاحظاتي', note)
  const hasContent = (doc.ingredient_groups ?? []).some((g) => g.items.length) || (doc.steps ?? []).length > 0 || (doc.notes ?? []).length > 0
  if (!hasContent) for (const line of (doc.raw_text ?? '').split('\n')) add('النص', line)
  return lines
}

export interface Change {
  kind: 'added' | 'removed'
  line: Line
}

export interface Comparison {
  changes: Change[]
  unchanged: number
}

const same = (a: Line, b: Line) => a.label === b.label && a.text === b.text

// Which lines went away and which are new, keeping the lines both share (longest common subsequence).
export function compare(before: Line[], after: Line[]): Comparison {
  const n = before.length
  const m = after.length
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = same(before[i], after[j]) ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const changes: Change[] = []
  let unchanged = 0
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (same(before[i], after[j])) {
      unchanged += 1
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      changes.push({ kind: 'removed', line: before[i++] })
    } else {
      changes.push({ kind: 'added', line: after[j++] })
    }
  }
  while (i < n) changes.push({ kind: 'removed', line: before[i++] })
  while (j < m) changes.push({ kind: 'added', line: after[j++] })
  return { changes, unchanged }
}
