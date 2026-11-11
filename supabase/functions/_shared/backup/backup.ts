// The nightly backup: build the file, write it to OneDrive, read it back and check it, and keep
// only the newest few. Pure logic with its collaborators passed in, so it is tested without OneDrive.
//
// The file is one JSON document (format "home-kitchen-backup", version 1). Its `recipes` array is
// the same shape as recipes.json, so the app's import page can load it to restore recipes. The rest
// (favorites, review flags, edit history, OneNote links) is kept for restoring by hand or by a
// later "restore" feature.

export const BACKUP_FORMAT = 'home-kitchen-backup'
export const BACKUP_VERSION = 1
export const KEEP_BACKUPS = 30
// A manual "back up now" is refused if the last run started this recently.
export const MANUAL_MIN_GAP_MS = 5 * 60 * 1000

export interface Counts {
  recipes: number
  deleted_recipes: number
  favorites: number
  flags: number
  versions: number
  onenote_pages: number
}

export interface Bundle {
  household: { id: string }
  recipes: unknown[]
  deleted_recipes: Array<{ doc: unknown }>
  favorites: unknown[]
  flags: unknown[]
  versions: unknown[]
  onenote_pages: unknown[]
  [key: string]: unknown
}

export interface BackupFile {
  name: string
  text: string
  sha256: string
  bytes: number
  counts: Counts
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

// hk-backup-2026-11-11-0230.json (UTC). The name sorts by time.
export function backupName(at: Date): string {
  return `hk-backup-${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}-${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}.json`
}

const NAME = /^hk-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/

export const isBackupName = (name: string) => NAME.test(name)

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function countsOf(bundle: Bundle): Counts {
  return {
    recipes: bundle.recipes.length,
    deleted_recipes: bundle.deleted_recipes.length,
    favorites: bundle.favorites.length,
    flags: bundle.flags.length,
    versions: bundle.versions.length,
    onenote_pages: bundle.onenote_pages.length,
  }
}

export async function buildBackupFile(bundle: Bundle, now: Date): Promise<BackupFile> {
  const counts = countsOf(bundle)
  const text = JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, created_at: now.toISOString(), counts, ...bundle })
  const bytes = new TextEncoder().encode(text)
  return { name: backupName(now), text, sha256: await sha256Hex(bytes), bytes: bytes.length, counts }
}

export type RecipeCheck = (doc: unknown) => string[]

// What was read back from OneDrive: the very bytes that were sent, valid JSON of the right format,
// counts that match what the file claims, and every recipe valid against recipe.schema.json.
export async function verifyBackup(downloaded: Uint8Array, sent: BackupFile, check: RecipeCheck): Promise<string[]> {
  const problems: string[] = []
  const sha = await sha256Hex(downloaded)
  if (sha !== sent.sha256) problems.push(`the file read back differs from the file written (${downloaded.length} bytes, expected ${sent.bytes})`)

  let file: (Partial<Bundle> & { format?: string; version?: number; counts?: Counts }) | null = null
  try {
    file = JSON.parse(new TextDecoder().decode(downloaded))
  } catch {
    problems.push('the file read back is not valid JSON')
  }
  if (!file) return problems

  if (file.format !== BACKUP_FORMAT || file.version !== BACKUP_VERSION) problems.push('the file has an unknown format or version')
  const actual = countsOf(file as Bundle)
  for (const key of Object.keys(sent.counts) as Array<keyof Counts>) {
    if (actual[key] !== sent.counts[key]) problems.push(`${key}: ${actual[key]} in the file, ${sent.counts[key]} expected`)
  }

  const docs = [...(file.recipes ?? []), ...(file.deleted_recipes ?? []).map((entry) => entry.doc)]
  const ids = new Set<string>()
  for (const doc of docs) {
    const id = String((doc as { id?: unknown })?.id ?? '')
    if (ids.has(id)) problems.push(`recipe ${id} appears twice`)
    ids.add(id)
    const errors = check(doc)
    if (errors.length) problems.push(`recipe ${id || '(no id)'}: ${errors.slice(0, 3).join('; ')}`)
    if (problems.length >= 10) break
  }
  return problems
}

export interface DriveFile {
  id: string
  name: string
}

// The backup files to delete: all but the newest `keep`. Only files with the app's own naming are
// ever considered; anything else in the folder is left alone.
export function filesToRemove(files: DriveFile[], keep = KEEP_BACKUPS): DriveFile[] {
  return files
    .filter((file) => isBackupName(file.name))
    .sort((a, b) => b.name.localeCompare(a.name))
    .slice(keep)
}

export interface Drive {
  folderName(): Promise<string>
  put(name: string, text: string): Promise<void>
  get(name: string): Promise<Uint8Array>
  list(): Promise<DriveFile[]>
  remove(id: string): Promise<void>
}

export interface RunRecord {
  ok: boolean
  file_name: string | null
  folder_name: string | null
  bytes: number | null
  sha256: string | null
  recipes: number | null
  deleted_recipes: number | null
  verified: boolean
  old_files_removed: number
  error: string | null
}

export interface BackupDeps {
  bundle(): Promise<Bundle>
  drive: Drive
  check: RecipeCheck
  now(): Date
}

// One backup. Never throws: a failure is returned in the record, with whatever was done before it.
export async function runBackup(deps: BackupDeps): Promise<RunRecord> {
  const record: RunRecord = {
    ok: false,
    file_name: null,
    folder_name: null,
    bytes: null,
    sha256: null,
    recipes: null,
    deleted_recipes: null,
    verified: false,
    old_files_removed: 0,
    error: null,
  }
  try {
    const file = await buildBackupFile(await deps.bundle(), deps.now())
    Object.assign(record, { file_name: file.name, bytes: file.bytes, sha256: file.sha256, recipes: file.counts.recipes, deleted_recipes: file.counts.deleted_recipes })

    // Asking for the app folder first is what makes OneDrive create it (Microsoft: the folder is
    // created by the first call to the special folder), so the upload has somewhere to go.
    record.folder_name = await deps.drive.folderName()
    await deps.drive.put(file.name, file.text)

    const problems = await verifyBackup(await deps.drive.get(file.name), file, deps.check)
    if (problems.length) {
      record.error = `The backup was written but did not pass the check: ${problems.join(' | ')}`
      return record
    }
    record.verified = true
    record.ok = true

    // Older files are removed only after the new one has been read back and checked. They go to
    // the OneDrive recycle bin, not out of existence.
    try {
      for (const old of filesToRemove(await deps.drive.list())) {
        await deps.drive.remove(old.id)
        record.old_files_removed += 1
      }
    } catch (error) {
      record.error = `The backup is good, but removing old files failed: ${(error as Error).message}`
    }
  } catch (error) {
    record.error = describe(error)
  }
  return record
}

// The error's message, plus OneDrive's own explanation when it gave one (its error body names the
// code and reason, and holds nothing secret).
function describe(error: unknown): string {
  const message = (error as Error).message
  const body = (error as { body?: unknown }).body
  if (typeof body !== 'string' || !body) return message
  try {
    const detail = (JSON.parse(body) as { error?: { code?: string; message?: string } }).error
    if (detail?.code) return `${message} (${detail.code}: ${detail.message ?? ''})`.slice(0, 400)
  } catch {
    // not JSON; fall through
  }
  return `${message} (${body.slice(0, 200)})`
}
