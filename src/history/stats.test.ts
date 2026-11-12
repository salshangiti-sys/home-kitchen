import { describe, expect, it } from 'vitest'
import type { CookStat } from './api'
import { cookLine, sortRecipes } from './stats'

const recipes = [
  { id: 'a', title: 'أرز' },
  { id: 'b', title: 'برغل' },
  { id: 'c', title: 'تبولة' },
  { id: 'd', title: 'دجاج' },
]
const stats = new Map<string, CookStat>([
  ['a', { count: 5, lastOn: '2026-11-10' }],
  ['b', { count: 1, lastOn: '2026-01-02' }],
  ['c', { count: 5, lastOn: '2026-06-01' }],
])

describe('sortRecipes', () => {
  it('keeps the order given for the name', () => {
    expect(sortRecipes(recipes, stats, 'name').map((r) => r.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('puts the most cooked first, ties by name, never cooked last', () => {
    expect(sortRecipes(recipes, stats, 'most').map((r) => r.id)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('puts never cooked first, then the one cooked longest ago', () => {
    expect(sortRecipes(recipes, stats, 'longest').map((r) => r.id)).toEqual(['d', 'b', 'c', 'a'])
  })

  it('does not change the list it was given', () => {
    const copy = [...recipes]
    sortRecipes(recipes, stats, 'most')
    expect(recipes).toEqual(copy)
  })

  it('treats everything as never cooked when there are no statistics', () => {
    expect(sortRecipes(recipes, new Map(), 'longest').map((r) => r.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('cookLine', () => {
  it('says how many times and how long ago, or nothing for a recipe never cooked', () => {
    expect(cookLine({ count: 3, lastOn: '2026-11-07' }, '2026-11-12')).toBe('طُبخت 3 مرات · آخر مرة قبل 5 أيام')
    expect(cookLine({ count: 1, lastOn: '2026-11-12' }, '2026-11-12')).toBe('طُبخت مرة واحدة · آخر مرة اليوم')
    expect(cookLine(undefined, '2026-11-12')).toBeNull()
  })
})
