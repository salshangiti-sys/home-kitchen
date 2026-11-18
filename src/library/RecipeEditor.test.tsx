import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SALAD } from './fixtures'

const api = vi.hoisted(() => ({ saved: [] as unknown[] }))
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  listRecipes: async () => ({
    recipes: [
      { id: 'a', title: 'أ', status: 'complete', section: 'سلطات', custom_tags: ['لحم مفروم', 'قلاش'] },
      { id: 'b', title: 'ب', status: 'complete', section: 'سلطات', custom_tags: ['لحم مفروم'] },
    ],
    favorites: new Set(),
    openFlags: new Set(),
  }),
  loadRecipe: async () => ({ doc: { ...SALAD, tags: { meal_types: [], kid_friendly: null, lunchbox: null, custom: ['لحم مفروم'] } }, version: 3, trashedAt: null, favorite: false, flags: [] }),
  saveRecipe: async (doc: unknown) => void api.saved.push(doc),
}))
vi.mock('./onenote', async (original) => ({
  ...(await original<typeof import('./onenote')>()),
  loadLibrary: async () => null,
  loadRecipePage: async () => ({ page_id: 'p', section_name: 'سلطات', web_url: 'https://onenote.example/p', client_url: null, created_by_app: false, read_status: 'ok', last_read_at: null, last_error: null }),
}))

import RecipeEditor from './RecipeEditor'

afterEach(cleanup)

describe('the tags of a recipe in the editor', () => {
  it('lists the tags that recipes already have, and a tap adds or removes one', async () => {
    render(<RecipeEditor id="salads-007" />)
    const list = await screen.findByRole('group', { name: 'الوسوم الموجودة' })
    const field = screen.getByLabelText(/وسوم خاصة/) as HTMLInputElement
    expect(field.value).toBe('لحم مفروم')
    const qalash = Array.from(list.querySelectorAll('button')).find((b) => b.textContent?.includes('قلاش')) as HTMLButtonElement
    expect(qalash.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(qalash)
    expect(field.value).toBe('لحم مفروم، قلاش')
    expect(qalash.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(qalash)
    expect(field.value).toBe('لحم مفروم')
  })
})
