import { describe, expect, it } from 'vitest'
import { matchesQuery, normalizeAr } from './normalize'

describe('normalizeAr', () => {
  // Same inputs and outputs as public.normalize_ar returned in the database (2026-10-24).
  it.each([
    ['سَلَطَةٌ أُمّي ١٢٣ Mixed  ـــ', 'سلطه امي 123 mixed'],
    ['إى آية ٱلله', 'اي ايه الله'],
    ['سلطه', 'سلطه'],
    ['مكرونة بالبشاميل', 'مكرونه بالبشاميل'],
    ['‫2. نحمر البصل‬', '2. نحمر البصل'],
  ])('matches the database for %s', (input, expected) => {
    expect(normalizeAr(input)).toBe(expected)
  })
})

describe('matchesQuery', () => {
  const text = normalizeAr('سلطة الخضار مع صوص الليمون')
  it('finds «سلطه» in «سلطة» and ignores word order', () => {
    expect(matchesQuery(text, 'سلطه')).toBe(true)
    expect(matchesQuery(text, 'ليمون سلطة')).toBe(true)
  })
  it('needs every word', () => {
    expect(matchesQuery(text, 'سلطة دجاج')).toBe(false)
  })
  it('matches everything for an empty query', () => {
    expect(matchesQuery(text, '  ')).toBe(true)
  })
})
