import { describe, expect, it } from 'vitest'
import { TINTS, tintFor } from './tints'

describe('tintFor', () => {
  it('gives the same tint to the same name, always one of the set', () => {
    expect(tintFor('دجاج')).toBe(tintFor('دجاج'))
    expect(TINTS).toContain(tintFor('لحم مفروم'))
  })
  it('spreads different names over more than one tint', () => {
    const used = new Set(['دجاج', 'لحم', 'سمك', 'سريع', 'تونا', 'كفتة', 'سناك/خفايف', 'صدور دجاج'].map(tintFor))
    expect(used.size).toBeGreaterThan(2)
  })
})
