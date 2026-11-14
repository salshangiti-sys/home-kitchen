import { describe, expect, it } from 'vitest'
import type { Op } from '../offline/outbox'
import { ADD_KIND, CLEAR_KIND, CONFIRM_KIND, MARK_KIND, PANTRY_KIND, UNCONFIRM_KIND, buildShoppingList, keyOf, overlayConfirmations, overlayMarks, type Confirmation, type Mark, type MealIn, type RecipeLines } from './model'

const meal = (recipe_id: string | null, title: string, status: MealIn['status'] = 'planned'): MealIn => ({ recipe_id, title, status })
const recipes: Record<string, RecipeLines> = {
  soup: { title: 'شوربة عدس', lines: ['٢ بصلة', '٣ فصوص ثوم', 'ماء', 'ملح'] },
  salad: { title: 'سلطة', lines: ['١ بصلة', 'خيار', 'نخلط الخضار في الوعاء جيدا ثم نقدمها'] },
  empty: { title: 'وصفة بلا مقادير', lines: [] },
}
const labels = (list: ReturnType<typeof buildShoppingList>) => list.toBuy.flatMap((g) => g.items.map((i) => i.label))
const none = { marks: [], pantry: [] }

describe('buildShoppingList', () => {
  it('groups the same ingredient of several recipes into one item that keeps each source line as written', () => {
    const list = buildShoppingList({ meals: [meal('soup', 'شوربة عدس'), meal('salad', 'سلطة')], recipes, ...none })
    const onion = list.toBuy.flatMap((g) => g.items).find((i) => i.key === 'بصل')!
    expect(onion.sources.map((s) => ({ line: s.line, recipe: s.recipe }))).toEqual([
      { line: '٢ بصلة', recipe: 'شوربة عدس' },
      { line: '١ بصلة', recipe: 'سلطة' },
    ])
    expect(labels(list).filter((l) => l === 'بصل')).toHaveLength(1)
  })

  it('does not list water, keeps sentences apart, and names the recipes with no ingredient lines and the text-only meals', () => {
    const list = buildShoppingList({ meals: [meal('soup', 'شوربة عدس'), meal('salad', 'سلطة'), meal('empty', 'وصفة بلا مقادير'), meal(null, 'أرز أبيض')], recipes, ...none })
    expect(labels(list)).not.toContain('ماء')
    expect(list.sentences.map((s) => s.recipe)).toEqual(['سلطة'])
    expect(list.noIngredients).toEqual(['وصفة بلا مقادير'])
    expect(list.freeText).toEqual(['أرز أبيض'])
  })

  it('counts only planned meals, and a recipe planned twice only once', () => {
    const list = buildShoppingList({ meals: [meal('soup', 'شوربة', 'cooked'), meal('salad', 'سلطة', 'skipped')], recipes, ...none })
    expect(list.toBuy).toEqual([])
    expect(list.meals).toBe(0)
    const twice = buildShoppingList({ meals: [meal('soup', 'شوربة عدس'), meal('soup', 'شوربة عدس')], recipes, ...none })
    expect(twice.toBuy.flatMap((g) => g.items).find((i) => i.key === 'بصل')!.sources).toHaveLength(1)
  })

  it('orders the aisles for walking through the shop and sorts the items in each', () => {
    const list = buildShoppingList({ meals: [meal('soup', 'شوربة عدس')], recipes, ...none })
    expect(list.toBuy[0].aisle).toBe('produce')
    expect(list.toBuy.map((g) => g.aisle)).toEqual([...list.toBuy.map((g) => g.aisle)].sort((a, b) => ['produce', 'meat', 'dairy', 'bakery', 'pantry', 'spices', 'other'].indexOf(a) - ['produce', 'meat', 'dairy', 'bakery', 'pantry', 'spices', 'other'].indexOf(b)))
  })

  it('moves bought and "I have it" items out of the buying list, and an always-at-home item is "have" unless marked for the week', () => {
    const marks: Mark[] = [{ key: 'بصل', label: null, status: 'bought', is_manual: false }]
    const list = buildShoppingList({ meals: [meal('soup', 'شوربة عدس')], recipes, marks, pantry: [{ key: 'ملح', label: 'ملح' }] })
    expect(labels(list)).not.toContain('بصل')
    expect(labels(list)).not.toContain('ملح')
    expect(list.done.map((i) => [i.key, i.status, i.pantry])).toEqual(expect.arrayContaining([['بصل', 'bought', false], ['ملح', 'have', true]]))
    // the "have" ones come before the bought ones
    expect(list.done[0].status).toBe('have')
    // marked "to buy" this week, the pantry item comes back
    const again = buildShoppingList({ meals: [meal('soup', 'شوربة عدس')], recipes, marks: [{ key: 'ملح', label: null, status: 'needed', is_manual: false }], pantry: [{ key: 'ملح', label: 'ملح' }] })
    expect(labels(again)).toContain('ملح')
  })

  it('shows the items added by hand even with no meals, and ignores a mark for an item no longer in the plan', () => {
    const marks: Mark[] = [
      { key: 'حفاضات', label: 'حفاضات', status: 'needed', is_manual: true },
      { key: 'جزر', label: null, status: 'bought', is_manual: false },
    ]
    const list = buildShoppingList({ meals: [], recipes, marks, pantry: [] })
    expect(labels(list)).toEqual(['حفاضات'])
    expect(list.done).toEqual([])
    expect(list.toBuy[0].items[0].manual).toBe(true)
  })

  it('keeps one item when a hand-written item is also in the recipes', () => {
    const marks: Mark[] = [{ key: keyOf('ثوم'), label: 'ثوم', status: 'needed', is_manual: true }]
    const list = buildShoppingList({ meals: [meal('soup', 'شوربة عدس')], recipes, marks, pantry: [] })
    const garlic = list.toBuy.flatMap((g) => g.items).filter((i) => i.key === 'ثوم')
    expect(garlic).toHaveLength(1)
    expect(garlic[0].manual).toBe(true)
    expect(garlic[0].sources).toHaveLength(1)
  })

  it('keeps the whole list of what is kept at home, in the week or not', () => {
    const list = buildShoppingList({ meals: [], recipes, marks: [], pantry: [{ key: 'زيت', label: 'زيت' }] })
    expect(list.pantryAll.map((p) => p.key)).toEqual(['زيت'])
  })
})

describe('confirmed quantities in the list', () => {
  const lines: Record<string, RecipeLines> = {
    a: { title: 'أرز', lines: ['٥٠٠ جرام لحم', '١ كيلو لحم', 'ملح'] },
    b: { title: 'كبسة', lines: ['٢٠٠ جرام لحم', '٣ فصوص ثوم'] },
  }
  const sure = (recipe_id: string, line: string, item_key: string, quantity: number, unit: Confirmation['unit']): Confirmation => ({ recipe_id, line, item_key, quantity, unit })
  const meat = (list: ReturnType<typeof buildShoppingList>) => list.toBuy.flatMap((g) => g.items).find((i) => i.key === 'لحم')!

  it('reads a quantity from the line but adds nothing until it is confirmed', () => {
    const list = buildShoppingList({ meals: [meal('a', 'أرز'), meal('b', 'كبسة')], recipes: lines, ...none })
    const item = meat(list)
    expect(item.totals).toEqual([])
    expect(item.unconfirmed).toBe(3)
    expect(item.sources.map((s) => s.read)).toEqual([{ quantity: 500, unit: 'g' }, { quantity: 1, unit: 'kg' }, { quantity: 200, unit: 'g' }])
    expect(item.sources.every((s) => s.confirmed === null)).toBe(true)
  })

  it('adds only the confirmed quantities (500 g + 1 kg = 1.5 kg) and counts the lines still unconfirmed', () => {
    const confirmations = [sure('a', '٥٠٠ جرام لحم', 'لحم', 500, 'g'), sure('a', '١ كيلو لحم', 'لحم', 1, 'kg')]
    const item = meat(buildShoppingList({ meals: [meal('a', 'أرز'), meal('b', 'كبسة')], recipes: lines, ...none, confirmations }))
    expect(item.totals).toEqual([{ quantity: 1.5, unit: 'kg' }])
    expect(item.unconfirmed).toBe(1) // «٢٠٠ جرام لحم» of the other recipe is not confirmed: it is not in the total
  })

  it('keeps incompatible confirmed units as separate totals', () => {
    const confirmations = [sure('a', '٥٠٠ جرام لحم', 'لحم', 500, 'g'), sure('b', '٢٠٠ جرام لحم', 'لحم', 2, 'cup')]
    expect(meat(buildShoppingList({ meals: [meal('a', 'أرز'), meal('b', 'كبسة')], recipes: lines, ...none, confirmations })).totals).toEqual([{ quantity: 500, unit: 'g' }, { quantity: 2, unit: 'cup' }])
  })

  it('counts a recipe planned twice twice', () => {
    const confirmations = [sure('b', '٢٠٠ جرام لحم', 'لحم', 200, 'g')]
    const item = meat(buildShoppingList({ meals: [meal('b', 'كبسة'), meal('b', 'كبسة')], recipes: lines, ...none, confirmations }))
    expect(item.totals).toEqual([{ quantity: 400, unit: 'g' }])
    expect(item.sources[0].times).toBe(2)
  })

  it('a confirmation of a line that was rewritten no longer applies', () => {
    const confirmations = [sure('b', '٢٠٠ جرام لحم مفروم', 'لحم', 200, 'g')]
    expect(meat(buildShoppingList({ meals: [meal('b', 'كبسة')], recipes: lines, ...none, confirmations })).totals).toEqual([])
  })
})

const op = (kind: string, key: string, args: Record<string, unknown>): Op => ({ id: key + kind, key, kind, args, at: '2026-11-14T10:00:00Z' })

describe('overlayMarks (changes waiting to be sent)', () => {
  const week = '2026-11-14'
  it('puts waiting ticks, additions, removals and pantry changes on top of what was read, and reports which items wait', () => {
    const marks: Mark[] = [
      { key: 'ثوم', label: null, status: 'needed', is_manual: false },
      { key: 'قديم', label: 'قديم', status: 'needed', is_manual: true },
    ]
    const out = overlayMarks(
      marks,
      [{ key: 'سكر', label: 'سكر' }],
      [
        op(MARK_KIND, 'm1', { week, key: 'ثوم', status: 'bought' }),
        op(ADD_KIND, 'm2', { week, key: 'حفاضات', label: 'حفاضات' }),
        op(CLEAR_KIND, 'm3', { week, key: 'قديم' }),
        op(PANTRY_KIND, 'p1', { key: 'زيت', label: 'زيت', on: true }),
        op(PANTRY_KIND, 'p2', { key: 'سكر', label: 'سكر', on: false }),
      ],
      week,
    )
    expect(out.marks.find((m) => m.key === 'ثوم')?.status).toBe('bought')
    expect(out.marks.find((m) => m.key === 'حفاضات')).toMatchObject({ is_manual: true, label: 'حفاضات', status: 'needed' })
    expect(out.marks.find((m) => m.key === 'قديم')).toBeUndefined()
    expect(out.pantry.map((p) => p.key)).toEqual(['زيت'])
    expect([...out.waiting].sort()).toEqual(['ثوم', 'حفاضات', 'زيت', 'سكر', 'قديم'].sort())
  })

  it('ignores a waiting change of another week', () => {
    const out = overlayMarks([], [], [op(MARK_KIND, 'm1', { week: '2026-11-21', key: 'ثوم', status: 'bought' })], week)
    expect(out.marks).toEqual([])
    expect(out.waiting.size).toBe(0)
  })
})

describe('overlayConfirmations (changes waiting to be sent)', () => {
  it('puts waiting confirmations and removals on top of what was read', () => {
    const read: Confirmation[] = [{ recipe_id: 'a', line: 'x', item_key: 'لحم', quantity: 1, unit: 'kg' }]
    const out = overlayConfirmations(read, [
      op(CONFIRM_KIND, 'c1', { recipe: 'a', line: 'y', key: 'ثوم', quantity: 3, unit: 'clove' }),
      op(UNCONFIRM_KIND, 'c2', { recipe: 'a', line: 'x', key: 'لحم' }),
    ])
    expect(out.confirmations).toEqual([{ recipe_id: 'a', line: 'y', item_key: 'ثوم', quantity: 3, unit: 'clove' }])
    expect(out.waiting.size).toBe(2)
  })
})
