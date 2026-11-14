import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLessons } from './catalog'
import DictionaryPage, { type DictionaryApi } from './DictionaryPage'
import type { Lesson } from './lessons'

afterEach(() => {
  cleanup()
  setLessons([])
})
beforeEach(() => setLessons([]))

function api(options: { lessons?: Lesson[]; fail?: string } = {}) {
  const state = { lessons: options.lessons ?? [] }
  const a = {
    loadIngredientLines: vi.fn(async (): Promise<Record<string, string[]>> => ({ r1: ['٢٠٠ جرام برغل', 'ملح'], r2: ['برغل'], r3: ['٢ فلفل هالبينو'] })),
    loadLessons: vi.fn(async () => state.lessons),
    teach: vi.fn(async (key: string, target: string | null, aisle: Lesson['aisle']) => {
      if (options.fail) throw new Error(options.fail)
      state.lessons = [...state.lessons.filter((l) => l.name_key !== key), { name_key: key, target, aisle }]
      setLessons(state.lessons) // what the app does on reload
    }),
    forget: vi.fn(async (key: string) => {
      state.lessons = state.lessons.filter((l) => l.name_key !== key)
      setLessons(state.lessons)
    }),
  } satisfies DictionaryApi
  return { a, state }
}

describe('teaching the dictionary', () => {
  it('lists the names it does not know, the most used first, with where they appear', async () => {
    render(<DictionaryPage canEdit api={api().a} />)
    const section = await screen.findByRole('region', { name: 'أسماء غير معروفة' })
    const items = within(section).getAllByRole('listitem')
    expect(items[0].textContent).toContain('برغل')
    expect(items[0].textContent).toContain('2 وصفات')
    expect(items.map((li) => li.querySelector('.font-medium')?.textContent)).toEqual(['برغل', 'فلفل هالبينو']) // «ملح» is known: not listed
    expect(screen.getByText('أسماء لا يعرفها التطبيق (2)')).toBeTruthy()
  })

  it('teaches "the same as" a known name, then the name leaves the list and appears under what was taught', async () => {
    const { a } = api()
    render(<DictionaryPage canEdit api={a} />)
    const select = await screen.findByLabelText('تعليم فلفل هالبينو')
    fireEvent.change(select, { target: { value: 'same:فلفل حار' } })
    const row = select.closest('li') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'احفظي' }))
    await waitFor(() => expect(a.teach).toHaveBeenCalledWith('فلفل هالبينو', 'فلفل حار', 'produce'))
    const taught = await screen.findByRole('region', { name: 'ما علّمتِه' })
    expect(taught.textContent).toContain('فلفل هالبينو')
    expect(taught.textContent).toContain('نفس «فلفل حار»')
    expect(screen.queryByLabelText('تعليم فلفل هالبينو')).toBeNull()
  })

  it('teaches an item of its own in an aisle', async () => {
    const { a } = api()
    render(<DictionaryPage canEdit api={a} />)
    const select = await screen.findByLabelText('تعليم برغل')
    fireEvent.change(select, { target: { value: 'aisle:pantry' } })
    fireEvent.click(within(select.closest('li') as HTMLElement).getByRole('button', { name: 'احفظي' }))
    await waitFor(() => expect(a.teach).toHaveBeenCalledWith('برغل', null, 'pantry'))
    expect((await screen.findByRole('region', { name: 'ما علّمتِه' })).textContent).toContain('صنف مستقل (مخزن وصلصات)')
  })

  it('takes a lesson back, and the name returns to the unknown ones', async () => {
    const { a } = api({ lessons: [{ name_key: 'برغل', target: null, aisle: 'pantry' }] })
    setLessons([{ name_key: 'برغل', target: null, aisle: 'pantry' }])
    render(<DictionaryPage canEdit api={a} />)
    const taught = await screen.findByRole('region', { name: 'ما علّمتِه' })
    fireEvent.click(within(taught).getByRole('button', { name: 'أزيليه' }))
    await waitFor(() => expect(a.forget).toHaveBeenCalledWith('برغل'))
    expect(await screen.findByLabelText('تعليم برغل')).toBeTruthy()
  })

  it('shows the reason when teaching is refused', async () => {
    render(<DictionaryPage canEdit api={api({ fail: 'not allowed' }).a} />)
    const select = await screen.findByLabelText('تعليم برغل')
    fireEvent.change(select, { target: { value: 'aisle:other' } })
    fireEvent.click(within(select.closest('li') as HTMLElement).getByRole('button', { name: 'احفظي' }))
    expect(await screen.findByText('لا تملكين صلاحية تعليم القاموس.')).toBeTruthy()
  })

  it('a reader sees what is unknown and taught but cannot teach', async () => {
    render(<DictionaryPage canEdit={false} api={api({ lessons: [{ name_key: 'برغل', target: null, aisle: 'pantry' }] }).a} />)
    await screen.findByRole('region', { name: 'ما علّمتِه' })
    expect(screen.queryByRole('button', { name: 'احفظي' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'أزيليه' })).toBeNull()
    expect(screen.getByText(/التعليم للمحررات فقط/)).toBeTruthy()
  })

  it('says so when every name is known', async () => {
    const { a } = api()
    a.loadIngredientLines.mockResolvedValue({ r1: ['ملح', '٢ بصلة'] })
    render(<DictionaryPage canEdit api={a} />)
    expect(await screen.findByText('كل الأسماء في المقادير معروفة للتطبيق.')).toBeTruthy()
  })
})
