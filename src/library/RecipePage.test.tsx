import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LINK_ONLY, SALAD } from './fixtures'
import type { LoadedRecipe } from './api'
import type { RecipePage as PageLink } from './onenote'

// The page's own pieces are tested elsewhere; here only what the page itself shows or hides.
vi.mock('../history/CookHistory', () => ({ default: () => <p>سجل التجارب</p> }))
vi.mock('../nutrition/FoodGroups', () => ({ default: () => <p>العناصر الغذائية</p> }))
vi.mock('../prep/PrepTemplates', () => ({ default: () => <p>تجهيزات الوصفة</p> }))
vi.mock('../photos/PhotoGallery', () => ({ default: () => <p>الصور</p> }))

const api = vi.hoisted(() => ({ loadRecipe: vi.fn(), loadRecipePage: vi.fn(), refreshFromPage: vi.fn() }))
vi.mock('./api', async (original) => ({ ...(await original<typeof import('./api')>()), loadRecipe: api.loadRecipe }))
vi.mock('./onenote', async (original) => ({ ...(await original<typeof import('./onenote')>()), loadRecipePage: api.loadRecipePage, refreshFromPage: api.refreshFromPage }))

import RecipePage from './RecipePage'

const loaded = (doc: LoadedRecipe['doc'], extra: Partial<LoadedRecipe> = {}): LoadedRecipe => ({ doc, version: 3, trashedAt: null, favorite: false, flags: [], ...extra })
const page: PageLink = { page_id: 'p1', section_name: 'سلطات', web_url: 'https://onenote.example/page', client_url: null, created_by_app: false, read_status: 'ok', last_read_at: new Date().toISOString(), last_error: null }

beforeEach(() => {
  api.loadRecipePage.mockResolvedValue(page)
  api.refreshFromPage.mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('a recipe in the app', () => {
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
    expect(screen.getByText('العناصر الغذائية')).toBeTruthy()
    expect(screen.getByText('تجهيزات الوصفة')).toBeTruthy()
    expect(screen.getByText('سجل التجارب')).toBeTruthy()
  })

  it('does not show the method, the notes, the original text, the source, the version history or cook mode', async () => {
    api.loadRecipe.mockResolvedValue(loaded(SALAD))
    render(<RecipePage id="salads-007" canEdit userId="u1" />)
    await screen.findByRole('heading', { name: 'سلطة خضراء' })
    expect(screen.queryByText('نغسل الخضار')).toBeNull() // the method
    expect(screen.queryByText('أزيد الليمون شوي')).toBeNull() // my notes
    expect(screen.queryByText(/النص الأصلي/)).toBeNull()
    expect(screen.queryByText(/mixed leaves\n/)).toBeNull()
    expect(screen.queryByText('فيديو تيك توك')).toBeNull() // the source link
    expect(screen.queryByText('الإصدارات السابقة')).toBeNull()
    expect(screen.queryByRole('link', { name: 'وضع الطبخ' })).toBeNull()
    expect(screen.queryByText(/صور أو فيديو لم يُنقل|صورة أو فيديو لم يُنقل/)).toBeNull()
  })

  it('points to OneNote for the method and notes', async () => {
    api.loadRecipe.mockResolvedValue(loaded(SALAD))
    render(<RecipePage id="salads-007" canEdit={false} userId="u1" />)
    const pointer = await screen.findByText(/الطريقة والملاحظات في OneNote/)
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
})
