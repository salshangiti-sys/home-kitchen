import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RestorePage from './RestorePage'
import type { RestoreResult } from './restoreBackup'

const result = (dry: boolean, patch: Partial<RestoreResult> = {}): RestoreResult => ({
  dry_run: dry,
  recipes_created: 2,
  recipes_existing: 1,
  trashed_created: 1,
  versions_added: 7,
  favorites_added: 3,
  flags_restored: 1,
  links_added: 1,
  cook_entries_added: 3,
  food_groups_added: 0,
  people_added: 0,
  planned_meals_added: 0,
  entries_skipped_unknown_person: 0,
  photos_in_file: 0,
  errors: [],
  ...patch,
})

const backup = JSON.stringify({ format: 'home-kitchen-backup', version: 1, created_at: '2026-11-12T02:30:04Z', recipes: [{ id: 'a' }], deleted_recipes: [], favorites: [{}], versions: [{}] })

function show(restore = vi.fn(async (_b: unknown, dry: boolean) => result(dry))) {
  render(<RestorePage api={{ restoreFromBackup: restore as never }} />)
  return restore
}

const choose = (text: string, name = 'hk-backup-2026-11-12-0230.json') => {
  const file = new File([text], name, { type: 'application/json' })
  Object.defineProperty(file, 'text', { value: async () => text })
  fireEvent.change(document.querySelector('input[type=file]') as HTMLInputElement, { target: { files: [file] } })
}

afterEach(cleanup)

describe('restoring from a backup file', () => {
  it('shows what the file holds and offers only the trial run at first', async () => {
    show()
    choose(backup)
    expect(await screen.findByText(/1 وصفة، و0 في سلة المحذوفات/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'شغّلي تجربة' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'استعيدي الآن' })).toBeNull()
  })

  it('refuses a file that is not a backup, with the reason', async () => {
    show()
    choose('[{"id":"x"}]', 'recipes.json')
    expect(await screen.findByText(/صفحة «استيراد»/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'شغّلي تجربة' })).toBeNull()
  })

  it('counts first (nothing saved), then restores only after the person agrees', async () => {
    const restore = show()
    choose(backup)
    fireEvent.click(await screen.findByRole('button', { name: 'شغّلي تجربة' }))
    expect(await screen.findByText('سيُضاف:')).toBeTruthy()
    expect(screen.getByText('2 وصفة جديدة')).toBeTruthy()
    expect(screen.getByText('1 وصفة موجودة أصلًا، لم تُمسّ.')).toBeTruthy()
    expect(restore).toHaveBeenCalledTimes(1)
    expect(restore.mock.calls[0][1]).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'استعيدي الآن' }))
    expect(await screen.findByText('تمت الاستعادة.')).toBeTruthy()
    expect(restore.mock.calls[1][1]).toBe(false)
    expect(screen.getByText('أُضيف:')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'استعيدي الآن' }) as HTMLButtonElement).disabled).toBe(true) // not twice
  })

  it('offers no restore when nothing is missing', async () => {
    show(vi.fn(async (_b: unknown, dry: boolean) => result(dry, { recipes_created: 0, trashed_created: 0, versions_added: 0, favorites_added: 0, flags_restored: 0, links_added: 0, cook_entries_added: 0, food_groups_added: 0, people_added: 0, planned_meals_added: 0, recipes_existing: 5 })))
    choose(backup)
    fireEvent.click(await screen.findByRole('button', { name: 'شغّلي تجربة' }))
    expect(await screen.findByText(/لا شيء ناقص/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'استعيدي الآن' })).toBeNull()
  })

  it('lists recipes that could not be restored, and people who are not in the household', async () => {
    show(vi.fn(async (_b: unknown, dry: boolean) => result(dry, { errors: [{ id: 'salads-009', error: 'bad' }], entries_skipped_unknown_person: 4 })))
    choose(backup)
    fireEvent.click(await screen.findByRole('button', { name: 'شغّلي تجربة' }))
    expect(await screen.findByText('تعذّر استعادة 1 وصفة:')).toBeTruthy()
    expect(screen.getByText('salads-009: bad')).toBeTruthy()
    expect(screen.getByText(/4 من المفضلة أو سجل التجارب تخص أشخاصًا/)).toBeTruthy()
  })

  it('says why when the server refuses', async () => {
    show(vi.fn(async () => Promise.reject(new Error('only the owner can restore from a backup'))))
    choose(backup)
    fireEvent.click(await screen.findByRole('button', { name: 'شغّلي تجربة' }))
    await waitFor(() => expect(screen.getByText('الاستعادة من نسخة احتياطية للمالكة فقط.')).toBeTruthy())
  })
})
