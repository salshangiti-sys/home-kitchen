import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecipeSummary } from './api'

const recipe = (id: string, title: string, section: string, extra: Partial<RecipeSummary> = {}): RecipeSummary => ({
  id,
  title,
  status: 'complete',
  section,
  search_norm: title,
  meal_types: [],
  kid_friendly: null,
  lunchbox: null,
  updated_at: '2026-11-12T00:00:00Z',
  ...extra,
})

let recipes: RecipeSummary[] = []
const listRecipes = vi.fn(async () => ({ recipes, favorites: new Set<string>(), openFlags: new Set<string>() }))
const bulkTag = vi.fn()

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  listRecipes: () => listRecipes(),
  countTrash: async () => 0,
  exportRecipes: async () => [],
}))
vi.mock('../photos/api', () => ({ coverThumbs: async () => new Map() }))
vi.mock('./bulkTag', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./bulkTag')>()),
  bulkTag: (...args: unknown[]) => bulkTag(...args),
}))

const { default: LibraryPage } = await import('./LibraryPage')

beforeEach(() => {
  recipes = [
    recipe('salads-001', 'سلطة خضراء', 'سلطات', { meal_types: ['lunch'], kid_friendly: true }),
    recipe('salads-002', 'سلطة فواكه', 'سلطات'),
    recipe('soups-001', 'شوربة عدس', 'شوربات', { lunchbox: true }),
  ]
  bulkTag.mockReset()
  bulkTag.mockImplementation(async (ids: string[], _changes: unknown, dry: boolean) => ({ changed: ids.length, unchanged: 0, skipped: 0, dry_run: dry }))
  listRecipes.mockClear()
})
afterEach(cleanup)

describe('tagging many recipes', () => {
  it('is for owners and editors only', async () => {
    render(<LibraryPage canEdit={false} />)
    await screen.findByText('سلطة خضراء')
    expect(screen.queryByRole('button', { name: 'توسيم عدة وصفات' })).toBeNull()
  })

  it('turns the rows into checkboxes that show the tags they have now', async () => {
    render(<LibraryPage canEdit />)
    fireEvent.click(await screen.findByRole('button', { name: 'توسيم عدة وصفات' }))
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
    expect(screen.getByText(/سلطات · غداء، للأطفال/)).toBeTruthy()
    expect(screen.getByText(/شوربات · لانش بوكس/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: /سلطة خضراء/ })).toBeNull()
    expect(screen.queryByLabelText('توسيم المحدّد')).toBeNull() // nothing chosen yet
  })

  it('selects all that are shown, and only those', async () => {
    render(<LibraryPage canEdit />)
    fireEvent.click(await screen.findByRole('button', { name: 'توسيم عدة وصفات' }))
    fireEvent.click(screen.getByRole('button', { name: /^شوربات/ }))
    fireEvent.click(screen.getByRole('button', { name: 'تحديد كل المعروضة (1)' }))
    expect(screen.getByText(/المحدّدة: 1/)).toBeTruthy()
    expect(screen.getByRole('region', { name: 'توسيم المحدّد' }).textContent).toContain('توسيم 1 وصفة')

    // Showing everything again does not bring back anything that was not selected.
    fireEvent.click(screen.getByRole('button', { name: /^شوربات/ }))
    expect(screen.getByText(/المحدّدة: 1/)).toBeTruthy()
    expect((screen.getByRole('checkbox', { name: /شوربة عدس/ }) as HTMLInputElement).checked).toBe(true)
  })

  it('does not tag a recipe that was selected and then filtered out of sight', async () => {
    render(<LibraryPage canEdit />)
    fireEvent.click(await screen.findByRole('button', { name: 'توسيم عدة وصفات' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /سلطة خضراء/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /شوربة عدس/ }))
    fireEvent.click(screen.getByRole('button', { name: /^شوربات/ }))
    expect(screen.getByText(/المحدّدة: 1/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^غداء:/ }))
    fireEvent.click(screen.getByRole('button', { name: 'معاينة ما سيتغير' }))
    await waitFor(() => expect(bulkTag).toHaveBeenCalledWith(['soups-001'], { meal_types: { add: ['lunch'] } }, true))
  })

  it('applies after the preview, tells how many changed, and reads the list again', async () => {
    render(<LibraryPage canEdit />)
    fireEvent.click(await screen.findByRole('button', { name: 'توسيم عدة وصفات' }))
    fireEvent.click(screen.getByRole('button', { name: 'تحديد كل المعروضة (3)' }))
    fireEvent.change(screen.getByLabelText('لانش بوكس'), { target: { value: 'yes' } })
    fireEvent.click(screen.getByRole('button', { name: 'معاينة ما سيتغير' }))
    fireEvent.click(await screen.findByRole('button', { name: 'نعم، طبّقي على 3 وصفات' }))

    expect(await screen.findByText(/عُدّلت وسوم 3 وصفات/)).toBeTruthy()
    expect(bulkTag).toHaveBeenLastCalledWith(['salads-001', 'salads-002', 'soups-001'], { lunchbox: true }, false)
    expect(listRecipes).toHaveBeenCalledTimes(2) // opened, then read again after the change
    expect(screen.getByText(/المحدّدة: 0/)).toBeTruthy()
  })

  it('leaves selection mode with "تم"', async () => {
    render(<LibraryPage canEdit />)
    fireEvent.click(await screen.findByRole('button', { name: 'توسيم عدة وصفات' }))
    fireEvent.click(screen.getByRole('button', { name: 'تم' }))
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'توسيم عدة وصفات' })).toBeTruthy()
  })
})
