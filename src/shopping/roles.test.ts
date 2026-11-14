import { describe, expect, it } from 'vitest'
import { orderByRole, roleOf } from './roles'

describe('the order of ingredients on the recipe page', () => {
  it('puts the starch first, then protein, spices, vegetables, dairy, and the rest last', () => {
    const lines = ['٢ ملعقة زيت', 'قشطة', '٢ بصلة', 'ملح', '٢ كوب أرز', 'صدور دجاج', 'بابريكا', 'بطاطس', 'كريمة طبخ', 'فلفل رومي', 'كمون']
    expect(orderByRole(lines, (l) => l)).toEqual(['٢ كوب أرز', 'صدور دجاج', 'ملح', 'بابريكا', 'كمون', '٢ بصلة', 'بطاطس', 'فلفل رومي', 'قشطة', 'كريمة طبخ', '٢ ملعقة زيت'])
  })

  it('keeps the written order inside each kind (it is a stable sort)', () => {
    const lines = ['كمون', 'ملح', 'بابريكا', 'كركم']
    expect(orderByRole(lines, (l) => l)).toEqual(lines)
  })

  it('sorts the kinds the dictionary files by name: pasta, flour and bread are starch, the egg is protein', () => {
    expect(roleOf('٢٠٠ جرام مكرونة')).toBe('carb')
    expect(roleOf('دقيق')).toBe('carb')
    expect(roleOf('خبز توست')).toBe('carb')
    expect(roleOf('٢ بيض')).toBe('protein')
    expect(roleOf('٥٠٠ جرام لحم مفروم')).toBe('protein')
    expect(roleOf('ليمون')).toBe('vegetable')
    expect(roleOf('جبنة موزاريلا')).toBe('dairy')
  })

  it('puts sentences, links and things it does not know last, without losing them', () => {
    const lines = ['https://www.instagram.com/reel/abc', 'ملح', 'شي غريب جدا ما أعرفه', '٣ كوب رز']
    const out = orderByRole(lines, (l) => l)
    expect(out.slice(0, 2)).toEqual(['٣ كوب رز', 'ملح'])
    expect(out).toHaveLength(4)
    expect(new Set(out)).toEqual(new Set(lines))
  })

  it('still recognises rice, pasta and meat in a line the dictionary does not know exactly', () => {
    expect(roleOf('كوب واحد أرز طويل الحبة')).toBe('carb')
    expect(roleOf('٢و١/٢ كوب أرز منقوع مزة بسمتي هندي')).toBe('carb')
    expect(roleOf('دجاج مفتفت')).toBe('protein')
  })

  it('handles a line that lists several ingredients by its first one', () => {
    expect(roleOf('ملح، كمون، بابريكا')).toBe('spice')
  })
})
