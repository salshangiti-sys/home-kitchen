import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./backupStatus', async (original) => ({ ...(await original<typeof import('./backupStatus')>()), loadBackupRuns: async () => [] }))

import BackupCard from './BackupCard'

const MB = 1024 * 1024
afterEach(cleanup)

const api = (over: Partial<Parameters<typeof BackupCard>[0]['api'] & object> = {}) => ({
  downloadFullBackup: vi.fn(async () => ({ name: 'hk-backup-2026-11-14-0905.json', recipes: 12 })),
  loadStorageUsage: vi.fn(async () => ({ database_bytes: 15 * MB, photo_bytes: 450 * MB })),
  ...over,
})

describe('the backup card', () => {
  it('shows how much of the free plan is used', async () => {
    render(<BackupCard api={api()} />)
    expect(await screen.findByText('القاعدة: 15 م.ب من 500 (3%)')).toBeTruthy()
    expect(screen.getByText('الصور: 450 م.ب من 1024 (44%)')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'القاعدة' }).getAttribute('aria-valuenow')).toBe('3')
  })

  it('warns when a limit is close', async () => {
    render(<BackupCard api={api({ loadStorageUsage: async () => ({ database_bytes: 450 * MB, photo_bytes: 0 }) })} />)
    expect(await screen.findByText(/اقتربت من حد الباقة المجانية/)).toBeTruthy()
  })

  it('shows no usage and no error when it cannot be read', async () => {
    render(<BackupCard api={api({ loadStorageUsage: async () => { throw new Error('nope') } })} />)
    await screen.findByText('لم تُحفظ نسخة بعد. أول نسخة تلقائية الليلة، أو اضغطي «انسخي الآن».')
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.queryByText('nope')).toBeNull()
  })

  it('downloads the full backup and says what it holds and what it leaves out', async () => {
    const a = api()
    render(<BackupCard api={a} />)
    fireEvent.click(await screen.findByRole('button', { name: 'نزّلي نسخة كاملة الآن' }))
    expect(await screen.findByText(/نُزّلت النسخة الكاملة \(12 وصفة\).*hk-backup-2026-11-14-0905\.json.*صور الوصفات ليست فيها/)).toBeTruthy()
    expect(a.downloadFullBackup).toHaveBeenCalledTimes(1)
  })

  it('shows the reason when the download is refused', async () => {
    render(<BackupCard api={api({ downloadFullBackup: async () => { throw new Error('تنزيل النسخة الكاملة للمالكة فقط.') } })} />)
    fireEvent.click(await screen.findByRole('button', { name: 'نزّلي نسخة كاملة الآن' }))
    await waitFor(() => expect(screen.getByText('تنزيل النسخة الكاملة للمالكة فقط.')).toBeTruthy())
  })

  it('can leave the download button out', async () => {
    render(<BackupCard canDownload={false} api={api()} />)
    await screen.findByText('القاعدة: 15 م.ب من 500 (3%)')
    expect(screen.queryByRole('button', { name: 'نزّلي نسخة كاملة الآن' })).toBeNull()
  })
})
