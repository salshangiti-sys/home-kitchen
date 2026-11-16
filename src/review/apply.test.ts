import { describe, expect, it, vi } from 'vitest'
import { autofillRecipe, type ApplyDeps } from './apply'
import type { LoadedRecipe } from '../library/api'

const recipe = (lines: string[], title = 'إيدام دجاج بالكريمة'): LoadedRecipe => ({
  doc: {
    id: 'new-1',
    title,
    status: 'complete',
    category: { section: 'صواني وايدامات' },
    sources: [],
    ingredient_groups: [{ name: null, items: lines.map((text) => ({ text })) }],
    steps: [{ order: 1, text: 'نطبخ' }],
    notes: [],
    onenote: {},
    raw_text: '',
  },
  version: 1,
  trashedAt: null,
  favorite: false,
  flags: [],
})

function deps(loaded: LoadedRecipe | null): ApplyDeps & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    loadRecipe: async () => loaded,
    bulkTag: vi.fn(async (ids, changes) => {
      calls.push(`tags ${ids.join()} ${JSON.stringify(changes)}`)
      return { changed: 1, unchanged: 0, skipped: 0, dry_run: false }
    }),
    setFoodGroups: vi.fn(async (id, groups) => {
      calls.push(`groups ${id} ${groups.join()}`)
    }),
    saveTemplate: vi.fn(async (_id, recipeId, t) => {
      calls.push(`prep ${recipeId} ${t.kind} ${t.timing} ${t.body}`)
      return 'tpl'
    }),
  }
}

describe('filling in a recipe that was just added', () => {
  it('writes tags, food groups and prep tasks through the app\'s own functions, in that order', async () => {
    const d = deps(recipe(['دجاج', 'بصل مفروم', 'كريمة طبخ']))
    const filled = await autofillRecipe('new-1', d)
    expect(filled?.tags).toEqual(['دجاج'])
    expect(d.calls).toEqual([
      'tags new-1 {"custom":{"add":["دجاج"]}}',
      'groups new-1 vegetables,protein,dairy',
      'prep new-1 defrost morning أخرجي الدجاج من الفريزر',
      'prep new-1 wash_chop before_cooking تقطيع الخضار: بصل (مفروم)',
    ])
  })

  it('writes nothing for a page with no ingredients, and nothing for a recipe it cannot read', async () => {
    const empty = deps(recipe([], 'وصفة جديدة'))
    await autofillRecipe('new-1', empty)
    expect(empty.calls).toEqual([])
    const missing = deps(null)
    expect(await autofillRecipe('new-1', missing)).toBeNull()
    expect(missing.calls).toEqual([])
  })
})
