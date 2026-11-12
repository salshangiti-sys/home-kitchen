// What the app shows about the nightly backup (see supabase/functions/nightly-backup).

import { supabase } from '../lib/supabase'
import { callFunction } from '../lib/supabase'
import { explain } from '../offline/readThrough'

export interface BackupRun {
  id: string
  trigger: 'schedule' | 'manual'
  started_at: string
  finished_at: string | null
  ok: boolean | null
  verified: boolean
  file_name: string | null
  folder_name: string | null
  bytes: number | null
  recipes: number | null
  deleted_recipes: number | null
  old_files_removed: number
  error: string | null
  photos_total: number | null
  photos_copied: number | null
  photos_pending: number | null
  photos_error: string | null
}

// The nightly run is at 02:30 UTC; a day and a half without a good one means something is wrong.
export const STALE_AFTER_MS = 36 * 60 * 60 * 1000

export async function loadBackupRuns(limit = 10): Promise<BackupRun[]> {
  const { data, error } = await supabase
    .from('backup_runs')
    .select('id,trigger,started_at,finished_at,ok,verified,file_name,folder_name,bytes,recipes,deleted_recipes,old_files_removed,error,photos_total,photos_copied,photos_pending,photos_error')
    .order('started_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return data as BackupRun[]
}

export async function backUpNow(): Promise<void> {
  try {
    const { results } = await callFunction<{ results: Array<{ ok: boolean; error: string | null }> }>('nightly-backup', {})
    const failed = results.find((r) => !r.ok)
    if (failed) throw new Error(failed.error ?? 'فشل النسخ الاحتياطي')
  } catch (error) {
    throw explain(error)
  }
}

export type BackupState =
  | { kind: 'none' }
  | { kind: 'ok'; run: BackupRun }
  | { kind: 'stale'; run: BackupRun } // the last good one is old
  | { kind: 'failing'; run: BackupRun; lastGood: BackupRun | null } // the newest finished run failed

// runs: newest first. A run still in progress (not finished) is ignored.
export function backupState(runs: BackupRun[], now = Date.now()): BackupState {
  const finished = runs.filter((run) => run.finished_at)
  const newest = finished[0]
  if (!newest) return { kind: 'none' }
  const lastGood = finished.find((run) => run.ok && run.verified) ?? null
  if (!newest.ok || !newest.verified) return { kind: 'failing', run: newest, lastGood }
  if (now - Date.parse(newest.started_at) > STALE_AFTER_MS) return { kind: 'stale', run: newest }
  return { kind: 'ok', run: newest }
}

// The photo line of a run: how many photos are safe in OneDrive, and whether copying hit a problem.
// Nothing to say when the app has no photos (or the run did not look at them).
export function photoLine(run: BackupRun): { text: string; warn: boolean } | null {
  if (run.photos_total == null || (run.photos_total === 0 && !run.photos_error)) return null
  const safe = run.photos_total - (run.photos_pending ?? 0)
  const base = `الصور: ${safe} من ${run.photos_total} محفوظة في OneDrive`
  if (run.photos_error) return { text: `${base}. تعذّر نسخ بعضها: ${run.photos_error}`, warn: true }
  if ((run.photos_pending ?? 0) > 0) return { text: `${base}. الباقي يُنسخ في الليالي القادمة (حتى 40 صورة في الليلة).`, warn: false }
  return { text: `${base} ✓`, warn: false }
}

export const needsAttention = (state: BackupState) => state.kind === 'failing' || state.kind === 'stale'

export function formatBytes(bytes: number | null): string {
  if (bytes == null) return ''
  return bytes < 1024 ? `${bytes} بايت` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} ك.ب` : `${(bytes / 1024 / 1024).toFixed(1)} م.ب`
}
