import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OverviewPage, { PENDING_EVENT, type OverviewApi, type Pending } from './OverviewPage'
import type { OverviewData } from './overview'

const data: OverviewData = {
  flags: [{ id: 'f9', recipe_id: 'b', flag: 'auto_filled', status: 'open' }],
  recipes: [
    { id: 'a', title: 'إيدام دجاج بالكريمة', section: 'صواني وايدامات', custom_tags: ['دجاج'] },
    { id: 'b', title: 'حلا الاوريو', section: 'الحلا', custom_tags: [] },
  ],
  lines: [{ recipe_id: 'a', position: 1, text: 'كريمة طبخ' }],
  suggestions: [{ recipe_id: 'b', position: 1, text: '٢٤ اوريو' }],
  templates: [{ id: 't1', recipe_id: 'a', kind: 'wash_chop', timing: 'before_cooking', at_time: null, body: 'تقطيع الخضار: بصل، جزر (مبشور)', position: 1 }],
  pages: [{ recipe_id: 'a', web_url: 'https://onenote.example/a' }],
}
const page = { page_id: 'p1', title: 'كبسة الروبيان', section_name: 'أرزاز ومكرونات (سمك)', web_url: 'https://onenote.example/p1' }

type Fake = OverviewApi & { approved: string[]; reviewed: string[]; edits: string[]; failWith?: string }

function fakeApi(pending: Pending = { pages: [], checkedAt: null }): Fake {
  const state = { pending, approved: [] as string[], reviewed: [] as string[], edits: [] as string[] }
  const fake: Fake = {
    approved: state.approved,
    reviewed: state.reviewed,
    edits: state.edits,
    setTags: async (id, tags) => {
      if (fake.failWith) throw new Error(fake.failWith)
      state.edits.push(`tags ${id} ${tags.join('|')}`)
    },
    saveTask: async (recipeId, id, task) => {
      state.edits.push(`task ${recipeId} ${id ?? 'new'} ${task.kind} ${task.timing} ${task.body}`)
      return id ?? 'tNew'
    },
    removeTask: async (id) => {
      state.edits.push(`remove ${id}`)
    },
    refreshFromOneNote: async (id) => {
      state.edits.push(`refresh ${id}`)
      return { status: 'ok' as const, error: null }
    },
    approveRecipes: async (ids) => {
      state.reviewed.push(...ids)
    },
    loadOverview: async () => data,
    loadPending: async () => state.pending,
    approve: async (id) => {
      state.approved.push(id)
      state.pending = { ...state.pending, pages: state.pending.pages.filter((p) => p.page_id !== id) }
      return { recipeId: 'new-1', filled: { tags: ['دجاج'], groups: ['protein'], prep: [] } }
    },
    checkNow: async () => ({ pages: 135, unlinked: 1, missing: [], refreshed: 4, changed: 0 }),
  }
  return fake
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
    expect(screen.getByDisplayValue('تقطيع الخضار: بصل، جزر (مبشور)')).toBeTruthy()
    expect(screen.getByText(/بلا طريقة تقطيع: بصل\./)).toBeTruthy()
    expect(screen.getByText('٢٤ اوريو')).toBeTruthy() // the ones she confirmed in the app
    expect(screen.getAllByRole('link', { name: 'افتحي الوصفة' })[0].getAttribute('href')).toBe('#/r/a')
    // the page's own ingredient lines are edited in OneNote: a link opens the page
    expect(screen.getAllByRole('link', { name: /عدّلي المقادير في OneNote/ })).toHaveLength(1)
    expect(screen.getByRole('link', { name: /عدّلي المقادير في OneNote/ }).getAttribute('href')).toBe('https://onenote.example/a')
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
    expect(await screen.findByText(/اعتُمدت «كبسة الروبيان» وانتقلت إلى الوصفات. ملأتُ لها وسومًا/)).toBeTruthy()
    expect(fake.approved).toEqual(['p1'])
    expect(screen.getAllByRole('link', { name: 'افتحي الوصفة' }).some((l) => l.getAttribute('href') === '#/r/new-1')).toBe(true)
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

describe('recipes waiting for her approval', () => {
  it('shows what waits, and one button approves a recipe as it is', async () => {
    const fake = fakeApi()
    render(<OverviewPage api={fake} />)
    await screen.findByText('إيدام دجاج بالكريمة')
    const filter = screen.getByRole('group', { name: 'ما ينقص' })
    fireEvent.click(within(filter).getByRole('button', { name: /تنتظر اعتمادكِ \(1\)/ }))
    expect(screen.queryByText('إيدام دجاج بالكريمة')).toBeNull()
    fireEvent.click(screen.getByText('حلا الاوريو'))
    fireEvent.click(screen.getByRole('button', { name: 'اعتمدي' }))
    await waitFor(() => expect(fake.reviewed).toEqual(['f9']))
    expect(await screen.findByText('اعتُمدت «حلا الاوريو».')).toBeTruthy()
  })

  it('approves everything shown only after she confirms', async () => {
    const fake = fakeApi()
    render(<OverviewPage api={fake} />)
    await screen.findByText('إيدام دجاج بالكريمة')
    fireEvent.click(within(screen.getByRole('group', { name: 'ما ينقص' })).getByRole('button', { name: /تنتظر اعتمادكِ/ }))
    fireEvent.click(screen.getByRole('button', { name: 'اعتمدي كل الظاهرة (1)' }))
    expect(fake.reviewed).toEqual([]) // nothing yet: it asks first
    fireEvent.click(screen.getByRole('button', { name: 'نعم، اعتمدي الكل' }))
    await waitFor(() => expect(fake.reviewed).toEqual(['f9']))
  })
})

describe('changing a recipe right in the list', () => {
  const open = async (fake: Fake) => {
    render(<OverviewPage api={fake} />)
    await screen.findByText('إيدام دجاج بالكريمة')
    fireEvent.click(screen.getByText('افتحي الكل'))
  }

  it('adds and removes a tag, and the list shows it at once', async () => {
    const fake = fakeApi()
    await open(fake)
    const input = screen.getAllByLabelText('وسم جديد')[1] // the second row: «حلا الاوريو»
    fireEvent.change(input, { target: { value: 'حلا' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(fake.edits).toEqual(['tags b حلا']))
    fireEvent.click(await screen.findByRole('button', { name: 'احذفي الوسم دجاج' }))
    await waitFor(() => expect(fake.edits).toContain('tags a '))
  })

  it('has no food-groups section', async () => {
    await open(fakeApi())
    expect(screen.queryByRole('group', { name: 'العناصر الغذائية' })).toBeNull()
    expect(screen.queryByText(/بلا عناصر غذائية/)).toBeNull()
  })

  it('a recipe she approved leaves the working list and waits under «اعتمدتُها»', async () => {
    const fake = { ...fakeApi(), loadOverview: async () => ({ ...data, flags: [{ id: 'f9', recipe_id: 'b', flag: 'auto_filled' as const, status: 'reviewed' as const }] }) }
    render(<OverviewPage api={fake} />)
    await screen.findByText('إيدام دجاج بالكريمة')
    expect(screen.queryByText('حلا الاوريو')).toBeNull()
    fireEvent.click(within(screen.getByRole('group', { name: 'ما ينقص' })).getByRole('button', { name: /اعتمدتُها \(1\)/ }))
    expect(screen.getByText('حلا الاوريو')).toBeTruthy()
    expect(screen.queryByText('إيدام دجاج بالكريمة')).toBeNull()
  })

  it('edits, adds and deletes a prep task', async () => {
    const fake = fakeApi()
    await open(fake)
    const text = screen.getByLabelText('نص التجهيز')
    fireEvent.change(text, { target: { value: 'تقطيع الخضار: بصل (مفروم)، جزر (مبشور)' } })
    fireEvent.blur(text)
    await waitFor(() => expect(fake.edits).toEqual(['task a t1 wash_chop before_cooking تقطيع الخضار: بصل (مفروم)، جزر (مبشور)']))
    fireEvent.change(screen.getAllByLabelText('تجهيز جديد')[1], { target: { value: 'انقعي الأرز' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'أضيفي' })[1])
    await waitFor(() => expect(fake.edits.at(-1)).toBe('task b new other before_cooking انقعي الأرز'))
    fireEvent.click(screen.getAllByRole('button', { name: 'احذفي التجهيز' })[0])
    await waitFor(() => expect(fake.edits.at(-1)).toBe('remove t1'))
  })

  it('shows a failed save in the same row, and leaves the list as it was', async () => {
    const fake = fakeApi()
    fake.failWith = 'تعدّلت هذه الوصفة من مكان آخر'
    await open(fake)
    const input = screen.getAllByLabelText('وسم جديد')[1]
    fireEvent.change(input, { target: { value: 'حلا' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText('تعدّلت هذه الوصفة من مكان آخر')).toBeTruthy()
    expect(fake.edits).toEqual([])
  })
})

describe('reading recipes from OneNote without leaving the list', () => {
  it('reads one recipe from its row', async () => {
    const fake = fakeApi()
    render(<OverviewPage api={fake} />)
    await screen.findByText('إيدام دجاج بالكريمة')
    fireEvent.click(screen.getByText('افتحي الكل'))
    fireEvent.click(screen.getAllByRole('button', { name: 'اقرئيها من OneNote الآن' })[0])
    expect(await screen.findByText('قُرئت «إيدام دجاج بالكريمة» من OneNote.')).toBeTruthy()
    expect(fake.edits).toEqual(['refresh a'])
  })

  it('reads all the recipes shown, one after the other, when there are few', async () => {
    const fake = fakeApi()
    render(<OverviewPage api={fake} />)
    await screen.findByText('إيدام دجاج بالكريمة')
    fireEvent.click(screen.getByRole('button', { name: 'اقرئي الظاهرة من OneNote (2)' }))
    expect(await screen.findByText('قُرئت 2 من 2 وصفة من OneNote.')).toBeTruthy()
    expect(fake.edits).toEqual(['refresh a', 'refresh b'])
  })
})
