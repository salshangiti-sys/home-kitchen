import { describe, expect, it } from 'vitest'
import { backupFileName, backupState, buildBackupFile, formatBytes, needsAttention, photoLine, STALE_AFTER_MS, usageLines, type BackupRun } from './backupStatus'
import { parseBackup } from './restoreBackup'

const NOW = Date.parse('2026-11-12T10:00:00Z')
const run = (hoursAgo: number, over: Partial<BackupRun> = {}): BackupRun => ({
  id: String(hoursAgo),
  trigger: 'schedule',
  started_at: new Date(NOW - hoursAgo * 3600_000).toISOString(),
  finished_at: new Date(NOW - hoursAgo * 3600_000 + 5000).toISOString(),
  ok: true,
  verified: true,
  file_name: 'hk-backup.json',
  folder_name: 'home-kitchen',
  bytes: 2048,
  recipes: 3,
  deleted_recipes: 0,
  old_files_removed: 0,
  error: null,
  photos_total: null,
  photos_copied: null,
  photos_pending: null,
  photos_error: null,
  ...over,
})

describe('backup status', () => {
  it('is none before any run has finished', () => {
    expect(backupState([], NOW).kind).toBe('none')
    expect(backupState([run(0, { finished_at: null, ok: null })], NOW).kind).toBe('none')
  })

  it('is ok after a recent good run, and an unfinished run on top is ignored', () => {
    expect(backupState([run(0, { finished_at: null, ok: null }), run(8)], NOW).kind).toBe('ok')
  })

  it('is stale when the newest run is a good one more than a day and a half old', () => {
    expect(backupState([run(STALE_AFTER_MS / 3600_000 + 1)], NOW).kind).toBe('stale')
  })

  it('is failing when the newest run failed, and remembers the last good one', () => {
    const state = backupState([run(2, { ok: false, verified: false, error: 'boom' }), run(26)], NOW)
    expect(state).toMatchObject({ kind: 'failing', run: { error: 'boom' }, lastGood: { id: '26' } })
    expect(needsAttention(state)).toBe(true)
  })

  it('counts a run that was written but did not verify as failing', () => {
    expect(backupState([run(1, { verified: false })], NOW).kind).toBe('failing')
  })

  it('writes sizes in Arabic units', () => {
    expect(formatBytes(512)).toBe('512 بايت')
    expect(formatBytes(6766)).toBe('6.6 ك.ب')
    expect(formatBytes(null)).toBe('')
  })
})

describe('the photo line', () => {
  it('says nothing when there are no photos or the run did not look at them', () => {
    expect(photoLine(run(1))).toBeNull()
    expect(photoLine(run(1, { photos_total: 0, photos_copied: 0, photos_pending: 0 }))).toBeNull()
  })

  it('counts the photos that are safe in OneDrive', () => {
    expect(photoLine(run(1, { photos_total: 12, photos_copied: 3, photos_pending: 0 }))).toEqual({ text: 'الصور: 12 من 12 محفوظة في OneDrive ✓', warn: false })
  })

  it('says the rest is copied on the coming nights', () => {
    const line = photoLine(run(1, { photos_total: 100, photos_copied: 40, photos_pending: 60 }))
    expect(line?.text).toContain('الصور: 40 من 100 محفوظة')
    expect(line?.text).toContain('الليالي القادمة')
    expect(line?.warn).toBe(false)
  })

  it('warns, without failing the backup, when copying hit a problem', () => {
    const failed = run(1, { photos_total: 5, photos_copied: 1, photos_pending: 4, photos_error: 'OneDrive is full' })
    expect(photoLine(failed)).toMatchObject({ warn: true })
    expect(photoLine(failed)?.text).toContain('OneDrive is full')
    expect(backupState([failed], NOW).kind).toBe('ok')
  })
})

describe('downloading the full backup', () => {
  it('names the file like the nightly ones (UTC)', () => {
    expect(backupFileName(new Date('2026-11-14T09:05:00Z'))).toBe('hk-backup-2026-11-14-0905.json')
  })

  it('builds the same file the nightly job writes: format, version, counts, then every part', () => {
    const file = buildBackupFile(
      { household: { id: 'h' }, recipes: [{}, {}], deleted_recipes: [{}], favorites: [], flags: [{}], versions: [{}, {}, {}], onenote_pages: [], plan_settings: { week_start_dow: 6 } },
      new Date('2026-11-14T09:05:00Z'),
    )
    expect(file).toMatchObject({
      format: 'home-kitchen-backup',
      version: 1,
      created_at: '2026-11-14T09:05:00.000Z',
      counts: { recipes: 2, deleted_recipes: 1, favorites: 0, flags: 1, versions: 3, onenote_pages: 0 },
      plan_settings: { week_start_dow: 6 },
    })
    expect(Object.keys(file).slice(0, 4)).toEqual(['format', 'version', 'created_at', 'counts'])
  })

  it('can be read back by the restore page', () => {
    const text = JSON.stringify(buildBackupFile({ recipes: [{ id: 'a' }], deleted_recipes: [], favorites: [], versions: [] }, new Date()))
    expect(parseBackup(text).summary).toMatchObject({ recipes: 1, deleted: 0 })
  })
})

describe('storage usage', () => {
  const MB = 1024 * 1024
  it('says how much of each limit is used', () => {
    const [db, photos] = usageLines({ database_bytes: 15 * MB, photo_bytes: 300 * MB })
    expect(db).toMatchObject({ text: 'القاعدة: 15 م.ب من 500 (3%)', percent: 3, warn: false })
    expect(photos).toMatchObject({ text: 'الصور: 300 م.ب من 1024 (29%)', percent: 29, warn: false })
  })

  it('warns from 80% and never shows more than 100% in the bar', () => {
    expect(usageLines({ database_bytes: 400 * MB, photo_bytes: 0 })[0].warn).toBe(true)
    expect(usageLines({ database_bytes: 399 * MB, photo_bytes: 0 })[0].warn).toBe(false)
    expect(usageLines({ database_bytes: 600 * MB, photo_bytes: 0 })[0].percent).toBe(100)
  })

  it('shows nothing used as zero and a little as at least 1%', () => {
    expect(usageLines({ database_bytes: 0, photo_bytes: 0 })[1].text).toBe('الصور: 0 م.ب من 1024 (0%)')
    expect(usageLines({ database_bytes: 0, photo_bytes: 2 * MB })[1].text).toBe('الصور: 2.0 م.ب من 1024 (1%)')
  })
})
