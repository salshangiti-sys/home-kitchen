import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CookEntry } from './api'
import CookHistory from './CookHistory'

const TODAY = '2026-11-12'

const entry = (id: string, cooked_on: string, user_id: string, rating: number | null, note: string | null): CookEntry => ({
  id,
  recipe_id: 'salads-007',
  user_id,
  cooked_on,
  rating,
  note,
  created_at: '2026-11-12T00:00:00Z',
})

function fakeApi(initial: CookEntry[]) {
  let entries = [...initial]
  return {
    listCookLog: vi.fn(async () => [...entries].sort((a, b) => b.cooked_on.localeCompare(a.cooked_on))),
    addCookEntry: vi.fn(async (_recipe: string, input: { cooked_on: string; rating: number | null; note: string }) => {
      entries = [...entries, entry(`new${entries.length}`, input.cooked_on, 'me', input.rating, input.note.trim() || null)]
    }),
    updateCookEntry: vi.fn(async (id: string, input: { cooked_on: string; rating: number | null; note: string }) => {
      entries = entries.map((e) => (e.id === id ? { ...e, ...input, note: input.note.trim() || null } : e))
    }),
    removeCookEntry: vi.fn(async (id: string) => void (entries = entries.filter((e) => e.id !== id))),
  }
}

const show = (api: ReturnType<typeof fakeApi>, options: { canLog?: boolean; startLogging?: boolean } = {}) =>
  render(<CookHistory recipeId="salads-007" userId="me" canLog={options.canLog ?? true} startLogging={options.startLogging} today={() => TODAY} api={api as never} />)

afterEach(cleanup)

describe('reading the history', () => {
  it('says so when the recipe was never cooked', async () => {
    show(fakeApi([]))
    expect(await screen.findByText('لم تُسجَّل تجربة لهذه الوصفة بعد.')).toBeTruthy()
  })

  it('shows the count, the last time, the average, and every entry with its note and who recorded it', async () => {
    show(fakeApi([entry('a', '2026-11-05', 'me', 5, 'زدت الليمون'), entry('b', '2026-10-01', 'sister', 3, null), entry('c', '2026-09-01', 'me', null, null)]))
    expect(await screen.findByText(/طُبخت 3 مرات · آخر مرة قبل 7 أيام · متوسط التقييم 4/)).toBeTruthy()
    expect(screen.getByText('زدت الليمون')).toBeTruthy()
    expect(screen.getAllByText('سجّلتِها أنتِ')).toHaveLength(2)
    expect(screen.getByText('سجّلها أحد أفراد العائلة')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'التقييم 5 من 5' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'التقييم 3 من 5' })).toBeTruthy()
  })

  it('lets only the person who recorded an entry change or delete it', async () => {
    show(fakeApi([entry('a', '2026-11-05', 'me', 5, null), entry('b', '2026-10-01', 'sister', 3, null)]))
    await screen.findByText('سجّلتِها أنتِ')
    expect(screen.getAllByRole('button', { name: 'تعديل' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'حذف' })).toHaveLength(1)
  })

  it('shows a message and still the section when the history cannot be read', async () => {
    const api = fakeApi([])
    api.listCookLog.mockRejectedValueOnce(new Error('Failed to fetch'))
    show(api)
    expect(await screen.findByText(/يحتاج هذا إلى اتصال بالإنترنت/)).toBeTruthy()
    expect(screen.getByText('سجل التجارب')).toBeTruthy()
  })
})

describe('recording a cooking', () => {
  it('adds an entry with today as the date, a rating and a note', async () => {
    const api = fakeApi([])
    show(api)
    fireEvent.click(await screen.findByRole('button', { name: 'سجّلي أنكِ طبختِها' }))
    expect((screen.getByLabelText('تاريخ الطبخ') as HTMLInputElement).value).toBe(TODAY)
    fireEvent.click(screen.getByRole('button', { name: '4 من 5' }))
    fireEvent.change(screen.getByLabelText(/ملاحظة/), { target: { value: 'أقل ملحًا المرة القادمة' } })
    fireEvent.click(screen.getByRole('button', { name: 'احفظي التجربة' }))

    await waitFor(() => expect(api.addCookEntry).toHaveBeenCalledWith('salads-007', { cooked_on: TODAY, rating: 4, note: 'أقل ملحًا المرة القادمة' }))
    expect(await screen.findByText('أقل ملحًا المرة القادمة')).toBeTruthy()
    expect(screen.getByText(/طُبخت مرة واحدة · آخر مرة اليوم · متوسط التقييم 4/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'سجّلي أنكِ طبختِها' })).toBeTruthy() // the form closed
  })

  it('records with no rating and no note, and the same star twice clears the rating', async () => {
    const api = fakeApi([])
    show(api)
    fireEvent.click(await screen.findByRole('button', { name: 'سجّلي أنكِ طبختِها' }))
    fireEvent.click(screen.getByRole('button', { name: '3 من 5' }))
    fireEvent.click(screen.getByRole('button', { name: '3 من 5' }))
    fireEvent.click(screen.getByRole('button', { name: 'احفظي التجربة' }))
    await waitFor(() => expect(api.addCookEntry).toHaveBeenCalledWith('salads-007', { cooked_on: TODAY, rating: null, note: '' }))
  })

  it('opens the form at once when the person comes from cook mode', async () => {
    show(fakeApi([]), { startLogging: true })
    expect(await screen.findByLabelText('تاريخ الطبخ')).toBeTruthy()
  })

  it('offers no way to record for a recipe in the trash', async () => {
    show(fakeApi([]), { canLog: false, startLogging: true })
    await screen.findByText('سجل التجارب')
    expect(screen.queryByRole('button', { name: 'سجّلي أنكِ طبختِها' })).toBeNull()
    expect(screen.queryByLabelText('تاريخ الطبخ')).toBeNull()
  })

  it('keeps the form and shows the reason when saving fails', async () => {
    const api = fakeApi([])
    api.addCookEntry.mockRejectedValueOnce(new Error('bad_date: the date of cooking is not valid'))
    show(api)
    fireEvent.click(await screen.findByRole('button', { name: 'سجّلي أنكِ طبختِها' }))
    fireEvent.click(screen.getByRole('button', { name: 'احفظي التجربة' }))
    expect(await screen.findByText(/التاريخ غير صحيح/)).toBeTruthy()
    expect(screen.getByLabelText('تاريخ الطبخ')).toBeTruthy()
  })
})

describe('changing and deleting your own entries', () => {
  it('edits an entry', async () => {
    const api = fakeApi([entry('a', '2026-11-05', 'me', 3, 'عادية')])
    show(api)
    fireEvent.click(await screen.findByRole('button', { name: 'تعديل' }))
    expect((screen.getByLabelText(/ملاحظة/) as HTMLTextAreaElement).value).toBe('عادية')
    fireEvent.click(screen.getByRole('button', { name: '5 من 5' }))
    fireEvent.change(screen.getByLabelText(/ملاحظة/), { target: { value: 'ممتازة بعد التعديل' } })
    fireEvent.click(screen.getByRole('button', { name: 'احفظي التعديل' }))
    await waitFor(() => expect(api.updateCookEntry).toHaveBeenCalledWith('a', { cooked_on: '2026-11-05', rating: 5, note: 'ممتازة بعد التعديل' }))
    expect(await screen.findByText('ممتازة بعد التعديل')).toBeTruthy()
  })

  it('asks before deleting, and deleting can be cancelled', async () => {
    const api = fakeApi([entry('a', '2026-11-05', 'me', 3, 'عادية')])
    show(api)
    fireEvent.click(await screen.findByRole('button', { name: 'حذف' }))
    expect(screen.getByText(/تُحذف هذه التجربة/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء' }))
    expect(api.removeCookEntry).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'حذف' }))
    fireEvent.click(within(screen.getByText(/تُحذف هذه التجربة/).parentElement!).getByRole('button', { name: 'نعم، احذفيها' }))
    await waitFor(() => expect(api.removeCookEntry).toHaveBeenCalledWith('a'))
    expect(await screen.findByText('لم تُسجَّل تجربة لهذه الوصفة بعد.')).toBeTruthy()
  })
})
