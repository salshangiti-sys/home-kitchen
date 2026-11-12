// Restoring from a backup file (hk-backup-….json from OneDrive). The file is read here, checked a
// little, and handed to the database function restore_from_backup, which only ADDS what is missing:
// nothing that is already in the app is changed or deleted. It can first only count what it would
// add (dry run), so the person sees the effect before agreeing.

import { supabase } from '../lib/supabase'
import { explain, looksOffline } from '../offline/readThrough'

export const BACKUP_FORMAT = 'home-kitchen-backup'
export const MAX_FILE_BYTES = 40 * 1024 * 1024

export interface Bundle {
  format: string
  version: number
  created_at?: string
  recipes: unknown[]
  deleted_recipes: unknown[]
  favorites: unknown[]
  versions: unknown[]
  flags?: unknown[]
  onenote_pages?: unknown[]
  cook_log?: unknown[]
  photos?: unknown[]
  members?: unknown[]
  [key: string]: unknown
}

export interface FileSummary {
  createdAt: string | null
  recipes: number
  deleted: number
  favorites: number
  cookEntries: number
  versions: number
  photos: number
}

const count = (value: unknown) => (Array.isArray(value) ? value.length : 0)

// Reads the text of a backup file. Throws a message in Arabic for anything that is not one.
export function parseBackup(text: string): { bundle: Bundle; summary: FileSummary } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('هذا ليس ملف نسخة احتياطية: الملف ليس JSON سليمًا.')
  }
  const file = data as Partial<Bundle> | null
  if (!file || typeof file !== 'object' || Array.isArray(file) || file.format !== BACKUP_FORMAT) {
    throw new Error('هذا ليس ملف نسخة احتياطية من التطبيق (hk-backup-….json). لاستيراد وصفات من OneNote استخدمي صفحة «استيراد».')
  }
  if (file.version !== 1) throw new Error('نسخة هذا الملف أحدث مما يعرفه التطبيق. حدّثي التطبيق أولًا.')
  if (!Array.isArray(file.recipes) || !Array.isArray(file.deleted_recipes)) throw new Error('الملف ناقص: لا فيه قائمة وصفات.')
  const bundle = file as Bundle
  return {
    bundle,
    summary: {
      createdAt: typeof bundle.created_at === 'string' ? bundle.created_at : null,
      recipes: count(bundle.recipes),
      deleted: count(bundle.deleted_recipes),
      favorites: count(bundle.favorites),
      cookEntries: count(bundle.cook_log),
      versions: count(bundle.versions),
      photos: count(bundle.photos),
    },
  }
}

export interface RestoreResult {
  dry_run: boolean
  recipes_created: number
  recipes_existing: number
  trashed_created: number
  versions_added: number
  favorites_added: number
  flags_restored: number
  links_added: number
  cook_entries_added: number
  entries_skipped_unknown_person: number
  photos_in_file: number
  errors: Array<{ id: string; error: string }>
}

export async function restoreFromBackup(bundle: Bundle, dryRun: boolean): Promise<RestoreResult> {
  const { data, error } = await supabase.rpc('restore_from_backup', { p_bundle: bundle, p_dry_run: dryRun })
  if (error) throw new Error(error.message)
  return data as RestoreResult
}

const MESSAGES: Array<[RegExp, string]> = [
  [/only the owner/i, 'الاستعادة من نسخة احتياطية للمالكة فقط.'],
  [/not_a_backup/, 'هذا ليس ملف نسخة احتياطية من التطبيق.'],
  [/payload|too large|413/i, 'الملف أكبر مما يقبله الخادم دفعة واحدة.'],
]

export function restoreMessage(error: unknown): string {
  if (looksOffline(error)) return explain(error).message
  const text = error instanceof Error ? error.message : String(error)
  return MESSAGES.find(([pattern]) => pattern.test(text))?.[1] ?? text
}

// Whether a run would add anything at all.
export const addsAnything = (r: RestoreResult) =>
  r.recipes_created + r.trashed_created + r.versions_added + r.favorites_added + r.flags_restored + r.links_added + r.cook_entries_added > 0

// The lines of a report: what is added (or was added), nothing about zero counts.
export function reportLines(r: RestoreResult): string[] {
  const lines: string[] = []
  const add = (n: number, text: string) => n > 0 && lines.push(`${n} ${text}`)
  add(r.recipes_created, 'وصفة جديدة')
  add(r.trashed_created, 'وصفة في سلة المحذوفات')
  add(r.favorites_added, 'من المفضلة')
  add(r.cook_entries_added, 'من سجل التجارب')
  add(r.versions_added, 'من الإصدارات السابقة')
  add(r.flags_restored, 'من علامات المراجعة')
  add(r.links_added, 'من روابط صفحات OneNote')
  return lines
}
