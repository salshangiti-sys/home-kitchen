import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LINK_ONLY, SALAD } from './fixtures'
import type { LoadedRecipe } from './api'
import type { RecipePage as PageLink } from './onenote'

// The page's own pieces are tested elsewhere; here only what the page itself shows or hides.
vi.mock('../history/CookHistory', () => ({ default: () => <p>سجل التجارب</p> }))
vi.mock('../prep/PrepTemplates', () => ({ default: () => <p>تجهيزات الوصفة</p> }))
vi.mock('../plan/AddToPlan', () => ({ default: () => <p>إضافة إلى الخطة</p> }))
vi.mock('../photos/PhotoGallery', () => ({ default: () => <p>الصور</p> }))

const api = vi.hoisted(() => ({ loadRecipe: vi.fn(), loadRecipePage: vi.fn(), refreshFromPage: vi.fn(), loadSuggestions: vi.fn() }))
vi.mock('../ingredients/api', async (original) => ({ ...(await original<typeof import('../ingredients/api')>()), loadSuggestions: api.loadSuggestions }))
vi.mock('./api', async (original) => ({ ...(await original<typeof import('./api')>()), loadRecipe: api.loadRecipe }))
vi.mock('./onenote', async (original) => ({ ...(await original<typeof import('./onenote')>()), loadRecipePage: api.loadRecipePage, refreshFromPage: api.refreshFromPage }))

import RecipePage from './RecipePage'

const loaded = (doc: LoadedRecipe['doc'], extra: Partial<LoadedRecipe> = {}): LoadedRecipe => ({ doc, version: 3, trashedAt: null, favorite: false, flags: [], ...extra })
const page: PageLink = { page_id: 'p1', section_name: 'سلطات', web_url: 'https://onenote.example/page', client_url: null, created_by_app: false, read_status: 'ok', last_read_at: new Date().toISOString(), last_error: null }

beforeEach(() => {
  api.loadRecipePage.mockResolvedValue(page)
  api.refreshFromPage.mockResolvedValue(undefined)
  api.loadSuggestions.mockResolvedValue([])
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('a recipe in the app', () => {
  it('keeps the lines under the label line they were written under, not mixed by kind', async () => {
    const groups = [{ name: null, items: ['عجينة جلاش', 'الحشوة:', 'جبنة بيضاء', 'نعناع', 'وصوص التغميس:', 'كاسة حليب', 'وملح', 'سمسم'].map((text) => ({ text })) }]
    api.loadRecipe.mockResolvedValue(loaded({ ...SALAD, ingredient_groups: groups }))
    render(<RecipePage id="salads-007" canEdit={false} userId="u1" />)
    expect(await screen.findByRole('heading', { name: 'الحشوة' })).toBeTruthy()
    const sauce = screen.getByRole('heading', { name: 'وصوص التغميس' }).parentElement as HTMLElement
    expect(Array.from(sauce.querySelectorAll('li')).map((li) => li.textContent)).toEqual(['وملح', 'كاسة حليب', 'سمسم'])
    const dough = screen.getByText('عجينة جلاش').closest('ul') as HTMLElement
    expect(dough.querySelectorAll('li').length).toBe(1)
  })
  it('shows the ingredients, tags and a big button to the OneNote page', async () => {
    api.loadRecipe.mockResolvedValue(loaded({ ...SALAD, tags: { meal_types: ['lunch'], kid_friendly: true, lunchbox: null, custom: ['سريعة'] } }))
    render(<RecipePage id="salads-007" canEdit={false} userId="u1" />)
    expect(await screen.findByRole('heading', { name: 'سلطة خضراء' })).toBeTruthy()
    for (const line of ['خيار مقطع', 'ليمون', 'زيت زيتون', '2 كوب mixed leaves']) expect(screen.getByText(line)).toBeTruthy()
    expect(screen.getByText('الصوص')).toBeTruthy() // the group name
    expect(screen.getByText('سريعة')).toBeTruthy()
    expect(screen.getByText('مناسبة للأطفال')).toBeTruthy()
    const open = await screen.findByRole('link', { name: 'افتحي الوصفة في OneNote ↗' })
    expect(open.getAttribute('href')).toBe('https://onenote.example/page')
    // planning and history stay
    expect(screen.queryByText('العناصر الغذائية')).toBeNull() // hidden from the recipe page; the data stays
    expect(screen.getByText('تجهيزات الوصفة')).toBeTruthy()
    expect(screen.getByText('سجل التجارب')).toBeTruthy()
  })

  it('shows the method, the notes, the full OneNote text and cook mode, read-only', async () => {
    api.loadRecipe.mockResolvedValue(loaded(SALAD))
    render(<RecipePage id="salads-007" canEdit userId="u1" />)
    await screen.findByRole('heading', { name: 'سلطة خضراء' })
    expect(screen.getByRole('heading', { name: 'الطريقة' })).toBeTruthy()
    expect(screen.getByText('نغسل الخضار')).toBeTruthy() // the method
    expect(screen.getByText('أزيد الليمون شوي')).toBeTruthy() // my notes
    expect(screen.getByText('النص الكامل كما في OneNote')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'وضع الطبخ' }).getAttribute('href')).toBe('#/r/salads-007/cook')
    // still hidden: the source link and the version history
    expect(screen.queryByText('فيديو تيك توك')).toBeNull()
    expect(screen.queryByText('الإصدارات السابقة')).toBeNull()
  })

  it('opens the full text by itself when the page has no parsed method or notes', async () => {
    api.loadRecipe.mockResolvedValue(loaded({ ...SALAD, steps: [], notes: [] }))
    const { container } = render(<RecipePage id="salads-007" canEdit={false} userId="u1" />)
    await screen.findByRole('heading', { name: 'سلطة خضراء' })
    expect(screen.queryByRole('heading', { name: 'الطريقة' })).toBeNull()
    expect(container.querySelector('details')?.hasAttribute('open')).toBe(true)
  })

  it('points to the OneNote page for editing', async () => {
    api.loadRecipe.mockResolvedValue(loaded(SALAD))
    render(<RecipePage id="salads-007" canEdit={false} userId="u1" />)
    const pointer = await screen.findByText(/للتعديل/)
    expect(pointer.querySelector('a')?.getAttribute('href')).toBe('https://onenote.example/page')
  })

  it('says so when a recipe has no ingredients yet', async () => {
    api.loadRecipe.mockResolvedValue(loaded({ ...SALAD, ingredient_groups: [] }))
    render(<RecipePage id="salads-007" canEdit={false} userId="u1" />)
    expect(await screen.findByText(/لا مقادير مسجّلة لهذه الوصفة بعد/)).toBeTruthy()
    expect(screen.queryByText('المقادير')).toBeNull()
  })

  it('still shows the link of a link-only recipe, which has nothing else', async () => {
    api.loadRecipe.mockResolvedValue(loaded(LINK_ONLY))
    api.loadRecipePage.mockResolvedValue(null)
    render(<RecipePage id="desserts-002" canEdit={false} userId="u1" />)
    expect(await screen.findByText(/وصفة محفوظة كرابط فقط/)).toBeTruthy()
    expect(screen.getByText('https://youtu.be/abc')).toBeTruthy()
    expect(screen.queryByText(/لا مقادير مسجّلة/)).toBeNull()
  })

  it('shows no OneNote button when the recipe has no page', async () => {
    api.loadRecipe.mockResolvedValue(loaded(SALAD))
    api.loadRecipePage.mockResolvedValue(null)
    render(<RecipePage id="salads-007" canEdit={false} userId="u1" />)
    await screen.findByRole('heading', { name: 'سلطة خضراء' })
    expect(screen.queryByRole('link', { name: /افتحي الوصفة في OneNote/ })).toBeNull()
  })

  it('keeps the review notes (for example "the method is written inside the ingredients")', async () => {
    api.loadRecipe.mockResolvedValue(loaded(SALAD, { flags: [{ id: 'f1', flag: 'method_inside_ingredients', status: 'open' }] as LoadedRecipe['flags'] }))
    render(<RecipePage id="salads-007" canEdit userId="u1" />)
    expect(await screen.findByText('الطريقة مكتوبة داخل المقادير')).toBeTruthy()
  })

  const proposal = (id: string, position: number, text: string, status: 'suggested' | 'confirmed' | 'ignored') => ({ id, recipe_id: 'salads-007', position, text, quote: null, status, source: 'method' as const })

  it('shows the ingredients she confirmed in the app when the page has none, and never a waiting or ignored one', async () => {
    api.loadRecipe.mockResolvedValue(loaded({ ...SALAD, ingredient_groups: [] }))
    api.loadSuggestions.mockResolvedValue([proposal('1', 1, 'جزر', 'confirmed'), proposal('2', 2, 'كوسة', 'suggested'), proposal('3', 3, 'فلفل', 'ignored')])
    render(<RecipePage id="salads-007" canEdit userId="u1" />)
    expect(await screen.findByText('جزر')).toBeTruthy()
    expect(screen.getByText(/أكّدتِها في التطبيق/)).toBeTruthy()
    expect(screen.queryByText('كوسة')).toBeNull()
    expect(screen.queryByText('فلفل')).toBeNull()
    expect(screen.queryByText(/لا مقادير مسجّلة لهذه الوصفة بعد/)).toBeNull()
    // the waiting one is announced, with a way to review it
    expect(screen.getByText(/1 مقدار مقترح من نص الوصفة بانتظار تأكيدك/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'راجعيها' }).getAttribute('href')).toBe('#/ingredients')
  })

  it('announces waiting proposals instead of "no ingredients" when none is confirmed yet', async () => {
    api.loadRecipe.mockResolvedValue(loaded({ ...SALAD, ingredient_groups: [] }))
    api.loadSuggestions.mockResolvedValue([proposal('1', 1, 'جزر', 'suggested'), proposal('2', 2, 'كوسة', 'suggested')])
    render(<RecipePage id="salads-007" canEdit userId="u1" />)
    expect(await screen.findByText(/2 مقدارًا مقترحًا من نص الوصفة بانتظار تأكيدك/)).toBeTruthy()
    expect(screen.queryByText(/لا مقادير مسجّلة لهذه الوصفة بعد/)).toBeNull()
  })

  it('uses the lines from OneNote when it has them, whatever was proposed', async () => {
    api.loadRecipe.mockResolvedValue(loaded(SALAD))
    api.loadSuggestions.mockResolvedValue([proposal('1', 1, 'جزر', 'confirmed'), proposal('2', 2, 'كوسة', 'suggested')])
    render(<RecipePage id="salads-007" canEdit userId="u1" />)
    expect(await screen.findByText('خيار مقطع')).toBeTruthy()
    expect(screen.queryByText('جزر')).toBeNull()
    expect(screen.queryByText(/بانتظار تأكيدك/)).toBeNull()
  })

  it('shows the ingredients grouped by kind: starch, protein, spices, vegetables, dairy, then the rest (each group keeps its own order)', async () => {
    const item = (text: string) => ({ text })
    api.loadRecipe.mockResolvedValue(
      loaded({
        ...SALAD,
        ingredient_groups: [
          { name: null, items: ['٢ ملعقة زيت', 'قشطة', '٢ بصلة', 'ملح', '٢ كوب أرز', 'صدور دجاج', 'كمون', 'بطاطس'].map(item) },
          { name: 'الصوص', items: ['بصل', 'ملح'].map(item) },
        ],
      }),
    )
    render(<RecipePage id="salads-007" canEdit={false} userId="u1" />)
    await screen.findByText('٢ كوب أرز')
    const lists = document.querySelectorAll('ul.list-disc')
    expect([...lists[0].querySelectorAll('li')].map((li) => li.textContent)).toEqual(['٢ كوب أرز', 'صدور دجاج', 'ملح', 'كمون', '٢ بصلة', 'بطاطس', 'قشطة', '٢ ملعقة زيت'])
    expect(screen.getByText('الصوص')).toBeTruthy() // the group keeps its name and its place
    expect([...lists[1].querySelectorAll('li')].map((li) => li.textContent)).toEqual(['ملح', 'بصل'])
  })

  it('offers adding to the plan to owners and editors only, and not for a recipe in the trash', async () => {
    api.loadRecipe.mockResolvedValue(loaded(SALAD))
    const { unmount } = render(<RecipePage id="salads-007" canEdit userId="u1" />)
    expect(await screen.findByText('إضافة إلى الخطة')).toBeTruthy()
    unmount()
    render(<RecipePage id="salads-007" canEdit={false} userId="u1" />)
    await screen.findByRole('heading', { name: 'سلطة خضراء' })
    expect(screen.queryByText('إضافة إلى الخطة')).toBeNull()
  })
})
