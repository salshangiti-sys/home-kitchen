import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BulkTagPanel from './BulkTagPanel'
import type { BulkResult, Changes } from './bulkTag'

const result = (patch: Partial<BulkResult> = {}): BulkResult => ({ changed: 2, unchanged: 1, skipped: 0, dry_run: true, ...patch })

function show(ids = ['a', 'b', 'c'], bulkTag = vi.fn(async (_ids: string[], _changes: Changes, dry: boolean) => result({ dry_run: dry }))) {
  const onApplied = vi.fn()
  const onClose = vi.fn()
  render(<BulkTagPanel ids={ids} onApplied={onApplied} onClose={onClose} api={{ bulkTag } as never} />)
  return { bulkTag, onApplied, onClose }
}

const chip = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}:`) })

afterEach(cleanup)

describe('choosing what to change', () => {
  it('cannot preview until something is chosen', () => {
    show()
    expect((screen.getByRole('button', { name: 'معاينة ما سيتغير' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('cycles a meal type through add, remove and back to unchanged', () => {
    show()
    expect(chip('غداء').textContent).toBe('غداء')
    fireEvent.click(chip('غداء'))
    expect(chip('غداء').textContent).toBe('+ غداء')
    expect(chip('غداء').getAttribute('aria-label')).toBe('غداء: ستُضاف')
    fireEvent.click(chip('غداء'))
    expect(chip('غداء').textContent).toBe('− غداء')
    fireEvent.click(chip('غداء'))
    expect(chip('غداء').textContent).toBe('غداء')
    expect((screen.getByRole('button', { name: 'معاينة ما سيتغير' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('preview then apply', () => {
  it('counts first, changes nothing, and applies only after the person agrees', async () => {
    const { bulkTag, onApplied } = show()
    fireEvent.click(chip('غداء'))
    fireEvent.change(screen.getByLabelText('مناسبة للأطفال'), { target: { value: 'yes' } })
    fireEvent.change(screen.getByLabelText(/وسوم خاصة/), { target: { value: 'سريعة' } })
    fireEvent.click(screen.getByRole('button', { name: 'معاينة ما سيتغير' }))

    expect(await screen.findByText('ستتغير 2 من 3 وصفات. 1 عليها هذه الوسوم أصلًا فلن تتغير.')).toBeTruthy()
    const changes = { meal_types: { add: ['lunch'] }, kid_friendly: true, custom: { add: ['سريعة'] } }
    expect(bulkTag).toHaveBeenCalledWith(['a', 'b', 'c'], changes, true)
    expect(onApplied).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'نعم، طبّقي على 2 وصفات' }))
    await waitFor(() => expect(bulkTag).toHaveBeenLastCalledWith(['a', 'b', 'c'], changes, false))
    expect(onApplied).toHaveBeenCalledWith(2)
  })

  it('goes back to choosing, and a new choice makes the preview out of date', async () => {
    const { bulkTag } = show()
    fireEvent.click(chip('عشاء'))
    fireEvent.click(screen.getByRole('button', { name: 'معاينة ما سيتغير' }))
    await screen.findByText(/ستتغير 2/)
    fireEvent.click(chip('فطور'))
    expect(screen.queryByText(/ستتغير 2/)).toBeNull()
    expect(screen.getByRole('button', { name: 'معاينة ما سيتغير' })).toBeTruthy()
    expect(bulkTag).toHaveBeenCalledTimes(1)
  })

  it('offers no apply button when nothing would change', async () => {
    show(['a'], vi.fn(async () => result({ changed: 0, unchanged: 1 })))
    fireEvent.click(chip('غداء'))
    fireEvent.click(screen.getByRole('button', { name: 'معاينة ما سيتغير' }))
    expect(await screen.findByText(/لا شيء سيتغير/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /نعم، طبّقي/ })).toBeNull()
  })

  it('shows why when the database refuses', async () => {
    const { onApplied } = show(['a'], vi.fn(async () => Promise.reject(new Error('not allowed to edit this recipe'))))
    fireEvent.click(chip('غداء'))
    fireEvent.click(screen.getByRole('button', { name: 'معاينة ما سيتغير' }))
    expect(await screen.findByText('لا تملكين صلاحية تعديل وسوم الوصفات.')).toBeTruthy()
    expect(onApplied).not.toHaveBeenCalled()
  })

  it('blocks a selection that is too large and a private tag that is too long', async () => {
    show(Array.from({ length: 301 }, (_, i) => `r${i}`))
    fireEvent.click(chip('غداء'))
    expect(screen.getAllByText(/حتى 300 وصفة/).length).toBeGreaterThan(0)
    expect((screen.getByRole('button', { name: 'معاينة ما سيتغير' }) as HTMLButtonElement).disabled).toBe(true)
    cleanup()

    show()
    fireEvent.change(screen.getByLabelText(/وسوم خاصة/), { target: { value: 'ا'.repeat(41) } })
    expect(screen.getByText(/حتى 40 حرفًا/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'معاينة ما سيتغير' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('closes', () => {
    const { onClose } = show()
    fireEvent.click(screen.getByRole('button', { name: 'إغلاق' }))
    expect(onClose).toHaveBeenCalled()
  })
})
