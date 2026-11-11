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
}

// The nightly run is at 02:30 UTC; a day and a half without a good one means something is wrong.
export const STALE_AFTER_MS = 36 * 60 * 60 * 1000

export async function loadBackupRuns(limit = 10): Promise<BackupRun[]> {
  const { data, error } = await supabase
    .from('backup_runs')
    .select('id,trigger,started_at,finished_at,ok,verified,file_name,folder_name,bytes,recipes,deleted_recipes,old_files_removed,error')
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

export const needsAttention = (state: BackupState) => state.kind === 'failing' || state.kind === 'stale'

export function formatBytes(bytes: number | null): string {
  if (bytes == null) return ''
  return bytes < 1024 ? `${bytes} بايت` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} ك.ب` : `${(bytes / 1024 / 1024).toFixed(1)} م.ب`
}
