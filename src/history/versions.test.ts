import { describe, expect, it } from 'vitest'
import type { RecipeDoc } from '../library/types'
import { compare, docLines, originLabel } from './versions'

const doc = (patch: Partial<RecipeDoc> = {}): RecipeDoc => ({
  id: 'salads-007',
  title: 'سلطة خضراء',
  status: 'complete',
  category: { section: 'سلطات' },
  sources: [],
  ingredient_groups: [{ name: null, items: [{ text: 'خس' }, { text: 'زيت زيتون' }] }],
  steps: [
    { order: 2, text: 'قلّبي' },
    { order: 1, text: 'قطّعي الخس' },
  ],
  notes: ['تؤكل باردة'],
  onenote: {},
  raw_text: 'النص الأصلي كله',
  ...patch,
})

describe('docLines', () => {
  it('lists the recipe in page order with steps sorted, and leaves out the original text', () => {
    const lines = docLines(doc({ servings: 4, tags: { meal_types: ['lunch'], kid_friendly: true, custom: ['سريعة'] } }))
    expect(lines.map((l) => `${l.label}:${l.text}`)).toEqual([
      'العنوان:سلطة خضراء',
      'القسم:سلطات',
      'الحالة:كاملة',
      'الحصص:4',
      'نوع الوجبة:غداء',
      'الوسوم:مناسبة للأطفال',
      'الوسوم:سريعة',
      'المقادير:خس',
      'المقادير:زيت زيتون',
      'الطريقة:قطّعي الخس',
      'الطريقة:قلّبي',
      'ملاحظاتي:تؤكل باردة',
    ])
  })

  it('shows the original text, line by line, for a plain note', () => {
    const lines = docLines(doc({ status: 'note_only', ingredient_groups: [], steps: [], notes: [], raw_text: 'سطر أول\n\nسطر ثان' }))
    expect(lines.filter((l) => l.label === 'النص').map((l) => l.text)).toEqual(['سطر أول', 'سطر ثان'])
  })

  it('copes with an old copy that lacks some parts', () => {
    const old = { id: 'x', title: 'قديمة', status: 'partial', raw_text: 'a' } as unknown as RecipeDoc
    expect(docLines(old).map((l) => l.label)).toContain('العنوان')
  })
})

describe('compare', () => {
  it('reports nothing for identical versions', () => {
    const lines = docLines(doc())
    expect(compare(lines, lines)).toEqual({ changes: [], unchanged: lines.length })
  })

  it('finds an added ingredient, a changed step and a removed note', () => {
    const before = docLines(doc())
    const after = docLines(
      doc({
        ingredient_groups: [{ name: null, items: [{ text: 'خس' }, { text: 'ليمون' }, { text: 'زيت زيتون' }] }],
        steps: [
          { order: 1, text: 'قطّعي الخس' },
          { order: 2, text: 'قلّبي جيدًا' },
        ],
        notes: [],
      }),
    )
    const result = compare(before, after)
    expect(result.changes.map((c) => `${c.kind}:${c.line.label}:${c.line.text}`).sort()).toEqual(
      [
        'added:المقادير:ليمون',
        'added:الطريقة:قلّبي جيدًا',
        'removed:الطريقة:قلّبي',
        'removed:ملاحظاتي:تؤكل باردة',
      ].sort(),
    )
    expect(result.unchanged).toBe(before.length - 2)
  })

  it('tells the same text under another label apart', () => {
    const result = compare([{ label: 'المقادير', text: 'ملح' }], [{ label: 'ملاحظاتي', text: 'ملح' }])
    expect(result.changes).toHaveLength(2)
  })

  it('handles an empty side', () => {
    expect(compare([], docLines(doc())).changes.every((c) => c.kind === 'added')).toBe(true)
    expect(compare(docLines(doc()), []).changes.every((c) => c.kind === 'removed')).toBe(true)
  })
})

describe('originLabel', () => {
  it('says where a change came from', () => {
    expect(originLabel('app', 1)).toBe('أُنشئت في التطبيق')
    expect(originLabel('app', 3)).toBe('عُدّلت في التطبيق')
    expect(originLabel('onenote', 1)).toBe('أُضيفت من OneNote')
    expect(originLabel('onenote', 2)).toBe('تغيّرت صفحتها في OneNote')
    expect(originLabel('restore', 4)).toBe('استرجاع إصدار سابق')
  })
})
