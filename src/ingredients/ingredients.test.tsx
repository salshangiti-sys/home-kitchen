import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ReviewPage, { type ReviewApi } from './ReviewPage'
import { groupReview, ingredientMessage, usableIngredients, type ReviewData, type Suggestion } from './api'

afterEach(cleanup)

const line = (id: string, recipe_id: string, position: number, text: string, extra: Partial<Suggestion> = {}): Suggestion => ({
  id, recipe_id, position, text, quote: null, status: 'suggested', source: 'method', ...extra,
})

const DATA: ReviewData = {
  recipes: [
    { id: 'soups-001', title: 'شربة الكريمة بالدجاج', section: 'شربة' },
    { id: 'trays-023', title: 'ايدام سفانة', section: 'صواني وايدامات' },
    { id: 'desserts-004', title: 'كب كيك الموز', section: 'الحلا' },
  ],
  suggestions: [
    line('1', 'trays-023', 1, 'جزر', { quote: 'جزر وكوسة اقطعها' }),
    line('2', 'trays-023', 2, 'كوسة', { quote: 'جزر وكوسة اقطعها' }),
    line('3', 'trays-023', 3, 'لحم مفروم', { quote: 'لحم مفروم - بصل وثوم' }),
    line('4', 'soups-001', 1, 'دجاج', { status: 'confirmed' }),
    line('5', 'desserts-004', 1, 'موز', { status: 'ignored' }),
    line('6', 'gone-recipe', 1, 'ملح'), // its recipe is in the trash: not listed
  ],
}

describe('grouping the proposals', () => {
  it('puts the recipes with lines still waiting first, the fully reviewed ones apart, and skips trashed recipes', () => {
    const { waiting, done } = groupReview(DATA)
    expect(waiting.map((g) => g.recipe.id)).toEqual(['trays-023'])
    expect(done.map((g) => g.recipe.id).sort()).toEqual(['desserts-004', 'soups-001'])
    expect(waiting[0].waiting).toBe(3)
    expect(waiting[0].lines.map((l) => l.text)).toEqual(['جزر', 'كوسة', 'لحم مفروم'])
    expect(waiting[0].quotes).toEqual(['جزر وكوسة اقطعها', 'لحم مفروم - بصل وثوم']) // each passage once
  })

  it('counts a recipe as reviewed when nothing is waiting any more', () => {
    const only = { ...DATA, suggestions: [line('1', 'trays-023', 1, 'جزر', { status: 'confirmed' }), line('2', 'trays-023', 2, 'كوسة', { status: 'ignored' })] }
    expect(groupReview(only).waiting).toEqual([])
    expect(groupReview(only).done).toHaveLength(1)
  })
})

describe('which ingredient lines the app uses', () => {
  const s = [line('a', 'r', 2, 'كوسة', { status: 'confirmed' }), line('b', 'r', 1, 'جزر', { status: 'confirmed' }), line('c', 'r', 3, 'ملح', { status: 'suggested' }), line('d', 'r', 4, 'فلفل', { status: 'ignored' })]

  it('uses the lines read from OneNote when there are any (the app\'s own are not mixed in)', () => {
    expect(usableIngredients(['بصل'], s)).toEqual({ lines: ['بصل'], from: 'onenote' })
  })

  it('otherwise only the confirmed lines, in order: never a waiting or an ignored one', () => {
    expect(usableIngredients([], s)).toEqual({ lines: ['جزر', 'كوسة'], from: 'app' })
  })

  it('says none when nothing is confirmed', () => {
    expect(usableIngredients([], [s[2], s[3]])).toEqual({ lines: [], from: 'none' })
  })
})

describe('messages', () => {
  it('explains the usual refusals in Arabic', () => {
    expect(ingredientMessage(new Error('duplicate key value violates unique constraint'))).toMatch(/مكتوب أصلًا/)
    expect(ingredientMessage(new Error('not allowed'))).toMatch(/صلاحية/)
  })
})

function fake(initial: Suggestion[] = DATA.suggestions) {
  let rows = [...initial]
  const api = {
    loadReview: vi.fn(async (): Promise<ReviewData> => ({ recipes: DATA.recipes, suggestions: rows.map((r) => ({ ...r })) })),
    setSuggestion: vi.fn(async (id: string, status: Suggestion['status'], text: string | null = null) => {
      rows = rows.map((r) => (r.id === id ? { ...r, status, text: text?.trim() || r.text } : r))
    }),
    addIngredient: vi.fn(async (recipeId: string, text: string) => {
      rows = [...rows, line(`n${rows.length}`, recipeId, 99, text, { status: 'confirmed', source: 'manual' })]
      return 'new'
    }),
    confirmAll: vi.fn(async (recipeId: string) => {
      rows = rows.map((r) => (r.recipe_id === recipeId && r.status === 'suggested' ? { ...r, status: 'confirmed' } : r))
      return 3
    }),
  }
  return api
}

const show = (api: ReturnType<typeof fake>, canEdit = true) => render(<ReviewPage canEdit={canEdit} api={api as unknown as ReviewApi} />)

describe('the review screen', () => {
  it('shows what is waiting, with the passage each line came from, and says nothing is used before it is confirmed', async () => {
    show(fake())
    expect(await screen.findByText('ايدام سفانة')).toBeTruthy()
    expect(screen.getByText('شربة الكريمة بالدجاج').closest('details')).not.toBeNull() // reviewed ones are folded away
    expect(screen.getByText('ايدام سفانة').closest('details')).toBeNull()
    expect(screen.getByText(/1 وصفة بانتظار المراجعة · 3 مقدارًا/)).toBeTruthy()
    expect(screen.getByText(/لا يدخل شيء منها قائمة المقاضي ولا التجهيز قبل أن تؤكديه/)).toBeTruthy()
    expect(screen.getByText('جزر وكوسة اقطعها')).toBeTruthy()
    expect(screen.getByText('لحم مفروم')).toBeTruthy()
  })

  it('confirms, ignores, and brings back a line', async () => {
    const api = fake()
    show(api)
    await screen.findByText('ايدام سفانة')
    const row = (text: string) => screen.getByText(text).closest('li')!
    fireEvent.click(within(row('جزر')).getByRole('button', { name: '✓ أكّدي' }))
    await waitFor(() => expect(api.setSuggestion).toHaveBeenCalledWith('1', 'confirmed'))
    await waitFor(() => expect(within(row('جزر')).getByText('مؤكَّد')).toBeTruthy())
    fireEvent.click(within(row('كوسة')).getByRole('button', { name: 'تجاهلي' }))
    await waitFor(() => expect(api.setSuggestion).toHaveBeenCalledWith('2', 'ignored'))
    fireEvent.click(await within(row('كوسة')).findByRole('button', { name: 'أعيديه' }))
    await waitFor(() => expect(api.setSuggestion).toHaveBeenLastCalledWith('2', 'suggested'))
  })

  it('confirms a corrected line', async () => {
    const api = fake()
    show(api)
    await screen.findByText('ايدام سفانة')
    fireEvent.click(within(screen.getByText('لحم مفروم').closest('li')!).getByRole('button', { name: 'تعديل' }))
    fireEvent.change(screen.getByLabelText('نص المقدار'), { target: { value: 'لحم مفروم 500 جرام' } })
    fireEvent.click(screen.getByRole('button', { name: 'أكّدي بعد التصحيح' }))
    await waitFor(() => expect(api.setSuggestion).toHaveBeenCalledWith('3', 'confirmed', 'لحم مفروم 500 جرام'))
    expect(await screen.findByText('لحم مفروم 500 جرام')).toBeTruthy()
  })

  it('confirms everything waiting for one recipe, and adds a line she thinks of', async () => {
    const api = fake()
    show(api)
    await screen.findByText('ايدام سفانة')
    fireEvent.click(screen.getByRole('button', { name: 'أكّدي الكل (3)' }))
    await waitFor(() => expect(api.confirmAll).toHaveBeenCalledWith('trays-023'))
    await screen.findByText('راجعتِ كل المقترحات.')

    fireEvent.click(screen.getByText('تمت مراجعتها (3)'))
    const input = screen.getByLabelText(/إضافة مقدار إلى ايدام سفانة/)
    fireEvent.change(input, { target: { value: 'قشطة' } })
    fireEvent.click(within(input.closest('form')!).getByRole('button', { name: 'أضيفي' }))
    await waitFor(() => expect(api.addIngredient).toHaveBeenCalledWith('trays-023', 'قشطة'))
  })

  it('shows a reader the proposals without any button to change them', async () => {
    show(fake(), false)
    await screen.findByText('ايدام سفانة')
    expect(screen.getByText('جزر')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '✓ أكّدي' })).toBeNull()
    expect(screen.queryByRole('button', { name: /أكّدي الكل/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'أضيفي' })).toBeNull()
  })

  it('shows the reason when a change is refused', async () => {
    const api = fake()
    api.setSuggestion.mockRejectedValueOnce(new Error('not allowed'))
    show(api)
    await screen.findByText('ايدام سفانة')
    fireEvent.click(within(screen.getByText('جزر').closest('li')!).getByRole('button', { name: '✓ أكّدي' }))
    expect(await screen.findByText(/لا تملكين صلاحية تعديل المقادير/)).toBeTruthy()
  })
})
