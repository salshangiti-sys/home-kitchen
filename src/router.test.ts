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
    ['#/lab', { name: 'lab' }],
    ['#/onenote', { name: 'onenote' }],
    ['#/unknown', { name: 'library' }],
  ])('%s', (hash, route) => {
    expect(parseHash(hash)).toEqual(route)
  })

  it('reads back the links it makes', () => {
    expect(parseHash(href.edit('soups-003'))).toEqual({ name: 'edit', id: 'soups-003' })
  })
})
