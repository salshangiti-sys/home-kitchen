// The checks run on a recipes.json file before anything is saved, and the summary of a
// (dry or real) import run. Nothing here changes data.

import { recipeErrors } from './validate'
import type { RecipeDoc, RecipeStatus } from './types'

export interface InvalidRecord {
  index: number
  id: string | null
  title: string | null
  errors: string[]
}

export interface FileReport {
  total: number
  valid: RecipeDoc[]
  invalid: InvalidRecord[]
  // Ids that appear more than once in the file; only the first of each is imported.
  duplicateIds: string[]
  byStatus: Record<RecipeStatus, number>
  bySection: Array<[string, number]>
  // How many records carry each kind of flag (the part before ':', e.g. possible_duplicate).
  flagCounts: Array<[string, number]>
  flaggedRecords: number
  withPageId: number
}

export class ImportFileError extends Error {}

export function parseRecipeFile(text: string): unknown[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    throw new ImportFileError(`الملف ليس JSON صالحًا: ${(error as Error).message}`)
  }
  if (!Array.isArray(data)) throw new ImportFileError('الملف يجب أن يحتوي على قائمة وصفات (مصفوفة JSON).')
  return data
}

const field = (record: unknown, key: string): string | null => {
  const value = record && typeof record === 'object' ? (record as Record<string, unknown>)[key] : null
  return typeof value === 'string' ? value : null
}

export function buildFileReport(records: unknown[]): FileReport {
  const valid: RecipeDoc[] = []
  const invalid: InvalidRecord[] = []
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  records.forEach((record, index) => {
    const errors = recipeErrors(record)
    if (errors.length) {
      invalid.push({ index, id: field(record, 'id'), title: field(record, 'title'), errors })
      return
    }
    const doc = record as RecipeDoc
    if (seen.has(doc.id)) {
      duplicates.add(doc.id)
      return
    }
    seen.add(doc.id)
    valid.push(doc)
  })

  const byStatus: Record<RecipeStatus, number> = { complete: 0, partial: 0, link_only: 0, note_only: 0 }
  const sections = new Map<string, number>()
  const flags = new Map<string, number>()
  let flaggedRecords = 0
  let withPageId = 0
  for (const doc of valid) {
    byStatus[doc.status] += 1
    sections.set(doc.category.section, (sections.get(doc.category.section) ?? 0) + 1)
    const kinds = new Set((doc.flags ?? []).map((flag) => flag.split(':')[0]))
    if (kinds.size) flaggedRecords += 1
    for (const kind of kinds) flags.set(kind, (flags.get(kind) ?? 0) + 1)
    if (doc.onenote.page_id) withPageId += 1
  }

  const byCount = (a: [string, number], b: [string, number]) => b[1] - a[1] || a[0].localeCompare(b[0], 'ar')
  return {
    total: records.length,
    valid,
    invalid,
    duplicateIds: [...duplicates],
    byStatus,
    bySection: [...sections].sort(byCount),
    flagCounts: [...flags].sort(byCount),
    flaggedRecords,
    withPageId,
  }
}

export type ImportResult = 'created' | 'updated' | 'unchanged' | 'skipped_edited' | 'error'

export interface ImportOutcome {
  id: string | null
  result: ImportResult
  error?: string
}

export interface RunSummary {
  counts: Record<ImportResult, number>
  skippedEdited: string[]
  errors: Array<{ id: string | null; error: string }>
}

export function summarizeRun(outcomes: ImportOutcome[]): RunSummary {
  const counts: Record<ImportResult, number> = { created: 0, updated: 0, unchanged: 0, skipped_edited: 0, error: 0 }
  const skippedEdited: string[] = []
  const errors: RunSummary['errors'] = []
  for (const outcome of outcomes) {
    counts[outcome.result] += 1
    if (outcome.result === 'skipped_edited' && outcome.id) skippedEdited.push(outcome.id)
    if (outcome.result === 'error') errors.push({ id: outcome.id, error: outcome.error ?? '' })
  }
  return { counts, skippedEdited, errors }
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
