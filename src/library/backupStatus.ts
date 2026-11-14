// What the app shows about the nightly backup (see supabase/functions/nightly-backup).

import { supabase } from '../lib/supabase'
import { callFunction } from '../lib/supabase'
import { downloadJson } from './api'
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

// ---- Download everything ("نزّلي نسخة كاملة") ----

const pad2 = (n: number) => String(n).padStart(2, '0')

// Same naming as the nightly files in OneDrive: hk-backup-2026-11-14-0930.json (UTC).
export const backupFileName = (at: Date) =>
  `hk-backup-${at.getUTCFullYear()}-${pad2(at.getUTCMonth() + 1)}-${pad2(at.getUTCDate())}-${pad2(at.getUTCHours())}${pad2(at.getUTCMinutes())}.json`

const length = (value: unknown) => (Array.isArray(value) ? value.length : 0)

// The file the nightly job writes (format, version, counts, then every part), made from the data the
// database gives the owner. The restore page reads it exactly like a file from OneDrive.
export function buildBackupFile(bundle: Record<string, unknown>, now: Date): Record<string, unknown> {
  return {
    format: 'home-kitchen-backup',
    version: 1,
    created_at: now.toISOString(),
    counts: {
      recipes: length(bundle.recipes),
      deleted_recipes: length(bundle.deleted_recipes),
      favorites: length(bundle.favorites),
      flags: length(bundle.flags),
      versions: length(bundle.versions),
      onenote_pages: length(bundle.onenote_pages),
    },
    ...bundle,
  }
}

// Owner only (the database refuses anyone else). The photo files are not in it, only their records;
// the files are copied to OneDrive by the nightly backup.
export async function downloadFullBackup(now = new Date()): Promise<{ name: string; recipes: number }> {
  try {
    const { data, error } = await supabase.rpc('export_backup')
    if (error) throw new Error(error.code === '42501' ? 'تنزيل النسخة الكاملة للمالكة فقط.' : error.message)
    const file = buildBackupFile(data as Record<string, unknown>, now)
    const name = backupFileName(now)
    downloadJson(name, file)
    return { name, recipes: length((data as Record<string, unknown>).recipes) }
  } catch (error) {
    throw explain(error)
  }
}

// ---- How much of the free plan is used ----

// The free plan's room (Supabase): 500 MB of database, 1 GB of files.
export const FREE_DATABASE_BYTES = 500 * 1024 * 1024
export const FREE_PHOTO_BYTES = 1024 * 1024 * 1024
export const USAGE_WARN_AT = 0.8

export interface Usage {
  database_bytes: number
  photo_bytes: number
}

export async function loadStorageUsage(): Promise<Usage> {
  const { data, error } = await supabase.rpc('storage_usage')
  if (error) throw new Error(error.message)
  const usage = data as Usage
  return { database_bytes: Number(usage.database_bytes), photo_bytes: Number(usage.photo_bytes) }
}

export interface UsageLine {
  label: string
  text: string
  percent: number
  warn: boolean
}

const MB = 1024 * 1024
const inMb = (bytes: number) => (bytes < MB ? '0' : (bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0))

// "القاعدة: 15 م.ب من 500 (3%)" for the database and the photo files.
export function usageLines(usage: Usage): UsageLine[] {
  const line = (label: string, used: number, limit: number): UsageLine => {
    const ratio = used / limit
    return { label, text: `${label}: ${inMb(used)} م.ب من ${Math.round(limit / MB)} (${Math.max(used > 0 ? 1 : 0, Math.round(ratio * 100))}%)`, percent: Math.min(100, Math.round(ratio * 100)), warn: ratio >= USAGE_WARN_AT }
  }
  return [line('القاعدة', usage.database_bytes, FREE_DATABASE_BYTES), line('الصور', usage.photo_bytes, FREE_PHOTO_BYTES)]
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
