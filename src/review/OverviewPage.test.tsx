import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OverviewPage, { PENDING_EVENT, type OverviewApi, type Pending } from './OverviewPage'
import type { OverviewData } from './overview'

const data: OverviewData = {
  recipes: [
    { id: 'a', title: 'إيدام دجاج بالكريمة', section: 'صواني وايدامات', custom_tags: ['دجاج'] },
    { id: 'b', title: 'حلا الاوريو', section: 'الحلا', custom_tags: [] },
  ],
  lines: [{ recipe_id: 'a', position: 1, text: 'كريمة طبخ' }],
  suggestions: [{ recipe_id: 'b', position: 1, text: '٢٤ اوريو' }],
  templates: [{ recipe_id: 'a', kind: 'wash_chop', timing: 'before_cooking', body: 'تقطيع الخضار: بصل، جزر (مبشور)', position: 1 }],
  groups: [{ recipe_id: 'a', food_group: 'dairy' }],
}
const page = { page_id: 'p1', title: 'كبسة الروبيان', section_name: 'أرزاز ومكرونات (سمك)', web_url: 'https://onenote.example/p1' }

function fakeApi(pending: Pending = { pages: [], checkedAt: null }): OverviewApi & { approved: string[] } {
  const state = { pending, approved: [] as string[] }
  return {
    approved: state.approved,
    loadOverview: async () => data,
    loadPending: async () => state.pending,
    approve: async (id) => {
      state.approved.push(id)
      state.pending = { ...state.pending, pages: state.pending.pages.filter((p) => p.page_id !== id) }
      return { recipeId: 'new-1' }
    },
    checkNow: async () => ({ pages: 135, unlinked: 1, missing: [], refreshed: 4, changed: 0 }),
  }
}
const api = fakeApi()

afterEach(cleanup)

describe('the review page', () => {
  it('lists every recipe with its tags and what is missing', async () => {
    render(<OverviewPage api={api} />)
    expect(await screen.findByText('إيدام دجاج بالكريمة')).toBeTruthy()
    expect(screen.getByText('حلا الاوريو')).toBeTruthy()
    expect(screen.getByText('2 وصفة')).toBeTruthy()
    expect(screen.getAllByText('دجاج').length).toBeGreaterThan(0) // the tag
  })

  it('shows the ingredients, the prep and the vegetables with no cutting method', async () => {
    render(<OverviewPage api={api} />)
    await screen.findByText('إيدام دجاج بالكريمة')
    fireEvent.click(screen.getByText('افتحي الكل'))
    expect(screen.getByText('كريمة طبخ')).toBeTruthy()
    expect(screen.getByText('تقطيع الخضار: بصل، جزر (مبشور)')).toBeTruthy()
    expect(screen.getByText('بلا طريقة تقطيع: بصل')).toBeTruthy()
    expect(screen.getByText('٢٤ اوريو')).toBeTruthy() // the ones she confirmed in the app
    expect(screen.getAllByRole('link', { name: 'افتحي الوصفة للتعديل' })[0].getAttribute('href')).toBe('#/r/a')
  })

  it('narrows the list by what is missing', async () => {
    render(<OverviewPage api={api} />)
    await screen.findByText('إيدام دجاج بالكريمة')
    const missing = screen.getByRole('group', { name: 'ما ينقص' })
    fireEvent.click(within(missing).getByRole('button', { name: /بلا وسوم/ }))
    expect(screen.queryByText('إيدام دجاج بالكريمة')).toBeNull()
    expect(screen.getByText('حلا الاوريو')).toBeTruthy()
    expect(screen.getByText('1 وصفة')).toBeTruthy()
  })

  it('searches by name', async () => {
    render(<OverviewPage api={api} />)
    await screen.findByText('إيدام دجاج بالكريمة')
    fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'الاوريو' } })
    expect(screen.queryByText('إيدام دجاج بالكريمة')).toBeNull()
    expect(screen.getByText('حلا الاوريو')).toBeTruthy()
  })

  it('says so when nothing matches, and shows an error when loading fails', async () => {
    render(<OverviewPage api={api} />)
    await screen.findByText('إيدام دجاج بالكريمة')
    fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'غير موجودة' } })
    expect(screen.getByText('لا وصفات بهذه الاختيارات.')).toBeTruthy()
    cleanup()
    render(<OverviewPage api={{ ...api, loadOverview: async () => { throw new Error('تعذّر التحميل') } }} />)
    expect(await screen.findByText('تعذّر التحميل')).toBeTruthy()
  })
})

describe('new pages from OneNote waiting for approval', () => {
  it('lists them apart from the recipes, with a button to approve and a link to the page', async () => {
    render(<OverviewPage api={fakeApi({ pages: [page], checkedAt: null })} />)
    expect(await screen.findByText('صفحات جديدة من OneNote تنتظر اعتمادكِ (1)')).toBeTruthy()
    expect(screen.getByText('كبسة الروبيان')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'افتحي في OneNote ↗' }).getAttribute('href')).toBe('https://onenote.example/p1')
    expect(screen.queryByText('2 وصفة')).toBeTruthy() // the page is not one of the recipes
  })

  it('approving turns it into a recipe, says so, and takes it off the waiting list', async () => {
    const fake = fakeApi({ pages: [page], checkedAt: null })
    const heard: number[] = []
    window.addEventListener(PENDING_EVENT, (e) => heard.push((e as CustomEvent<number>).detail))
    render(<OverviewPage api={fake} />)
    fireEvent.click(await screen.findByRole('button', { name: 'اعتمدي كوصفة' }))
    expect(await screen.findByText(/اعتُمدت «كبسة الروبيان» وانتقلت إلى الوصفات/)).toBeTruthy()
    expect(fake.approved).toEqual(['p1'])
    expect(screen.getByRole('link', { name: 'افتحي الوصفة' }).getAttribute('href')).toBe('#/r/new-1')
    await waitFor(() => expect(screen.getByText('صفحات جديدة من OneNote تنتظر اعتمادكِ (0)')).toBeTruthy())
    expect(heard.at(-1)).toBe(0) // the menu is told
  })

  it('checks the notebook on request and says what it found', async () => {
    const check = vi.fn(async () => ({ pages: 135, unlinked: 2, missing: [], refreshed: 4, changed: 1 }))
    render(<OverviewPage api={{ ...fakeApi({ pages: [], checkedAt: null }), checkNow: check }} />)
    expect(await screen.findByText('لا صفحات جديدة تنتظر.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'افحصي OneNote الآن' }))
    expect(await screen.findByText('فُحصت 135 صفحة. صفحات جديدة تنتظر: 2. قُرئت 4 وصفة وتغيّرت 1.')).toBeTruthy()
    expect(check).toHaveBeenCalledOnce()
  })

  it('still shows the recipes when the waiting pages cannot be read', async () => {
    render(<OverviewPage api={{ ...fakeApi(), loadPending: async () => { throw new Error('offline') } }} />)
    expect(await screen.findByText('إيدام دجاج بالكريمة')).toBeTruthy()
  })
})
