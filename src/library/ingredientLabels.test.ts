import { describe, expect, it } from 'vitest'
import { isLabelLine, splitByLabels } from './ingredientLabels'

const lines = (...texts: string[]) => texts.map((text) => ({ text }))

describe('label lines', () => {
  it('knows a short line ending with a colon', () => {
    expect(isLabelLine('الحشوة:')).toBe(true)
    expect(isLabelLine('وصوص التغميس:')).toBe(true)
    expect(isLabelLine('الحشوة：')).toBe(true)
  })
  it('does not take ingredient lines for labels', () => {
    expect(isLabelLine('عجينة جلاش')).toBe(false)
    expect(isLabelLine('ملح:')).toBe(true) // short with a colon: treated as a label on purpose
    expect(isLabelLine(':')).toBe(false)
    expect(isLabelLine('استعملت ٢٥٠ جرام جبنة بيضاء المراعي وشوية جبنة الطيب كمشتين جبن موزاريلا:')).toBe(false)
    expect(isLabelLine('2 كوب: حليب')).toBe(false)
  })
})

describe('splitting a group at its labels', () => {
  it('keeps the lines of each part with their label, in the written order', () => {
    const parts = splitByLabels({
      name: null,
      items: lines('عجينة جلاش', 'الحشوة:', 'جبنة بيضاء', 'نعناع', 'وصوص التغميس:', 'كاسة حليب', 'وملح', 'سمسم'),
    })
    expect(parts.map((p) => [p.name, p.items.map((i) => i.text)])).toEqual([
      [null, ['عجينة جلاش']],
      ['الحشوة', ['جبنة بيضاء', 'نعناع']],
      ['وصوص التغميس', ['كاسة حليب', 'وملح', 'سمسم']],
    ])
  })
  it('leaves a group without labels as it is, and drops a label with no lines', () => {
    expect(splitByLabels({ name: 'الصوص', items: lines('ملح', 'زيت') })).toEqual([{ name: 'الصوص', items: lines('ملح', 'زيت') }])
    expect(splitByLabels({ name: null, items: lines('ملح', 'الحشوة:') })).toEqual([{ name: null, items: lines('ملح') }])
  })
})
