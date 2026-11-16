import { describe, expect, it } from 'vitest'
import { href, parseHash } from './router'

describe('parseHash', () => {
  it.each([
    ['', { name: 'library' }],
    ['#/', { name: 'library' }],
    ['#/r/salads-007', { name: 'recipe', id: 'salads-007' }],
    ['#/r/salads-007/edit', { name: 'edit', id: 'salads-007' }],
    ['#/new', { name: 'new' }],
    ['#/import', { name: 'import' }],
    ['#/now', { name: 'now' }],
    ['#/shopping', { name: 'shopping' }],
    ['#/dictionary', { name: 'dictionary' }],
    ['#/shopping/2026-11-14', { name: 'shopping', week: '2026-11-14' }],
    ['#/shopping/oops', { name: 'shopping' }],
    ['#/plan', { name: 'plan' }],
    ['#/plan/2026-11-14', { name: 'plan', week: '2026-11-14' }],
    ['#/plan/nonsense', { name: 'plan' }],
    ['#/restore', { name: 'restore' }],
    ['#/trash', { name: 'trash' }],
    ['#/overview', { name: 'overview' }],
    ['#/r/salads-007/cook', { name: 'cook', id: 'salads-007' }],
    ['#/r/salads-007/cooked', { name: 'recipe', id: 'salads-007', logging: true }],
    ['#/onenote', { name: 'onenote' }],
    ['#/unknown', { name: 'library' }],
  ])('%s', (hash, route) => {
    expect(parseHash(hash)).toEqual(route)
  })

  it('reads back the links it makes', () => {
    expect(parseHash(href.edit('soups-003'))).toEqual({ name: 'edit', id: 'soups-003' })
  })
})
