import { describe, expect, it } from 'vitest'
import { inSection, sectionsOf, subOf, subsectionsOf, topOf } from './sections'

const r = (section: string) => ({ section })

describe('the sections in her order', () => {
  it('puts the sections in the order she keeps them, with their counts', () => {
    const list = [r('الحلا'), r('فطور'), r('صواني وايدامات'), r('فطور'), r('أرزاز ومكرونات (دجاج)'), r('فتات وسلطات')]
    expect(sectionsOf(list)).toEqual([['فطور', 2], ['فتات وسلطات', 1], ['أرزاز ومكرونات (دجاج)', 1], ['صواني وايدامات', 1], ['الحلا', 1]])
  })

  it('puts a section she adds later after the known ones, the larger first', () => {
    const list = [r('مقبلات'), r('مقبلات'), r('فطور'), r('عصائر')]
    expect(sectionsOf(list)).toEqual([['فطور', 1], ['مقبلات', 2], ['عصائر', 1]])
  })

  it('ignores recipes with no section, and matches a name spelled a little differently', () => {
    expect(sectionsOf([r(''), r('اطباق جانبية و معجنات')])).toEqual([['اطباق جانبية و معجنات', 1]])
  })
})

describe('a section group in OneNote (a big section with sections under it)', () => {
  it('names the big section and the sub-section', () => {
    expect(topOf('مفرزنات › كفتة وكرات لحم')).toBe('مفرزنات')
    expect(subOf('مفرزنات › كفتة وكرات لحم')).toBe('كفتة وكرات لحم')
    expect(topOf('الحلا')).toBe('الحلا')
    expect(subOf('الحلا')).toBeNull()
  })

  it('counts the sub-sections in their big section, in her order', () => {
    const list = [r('مفرزنات › كفتة'), r('مفرزنات › معجنات'), r('مفرزنات › كفتة'), r('الحلا'), r('فطور')]
    expect(sectionsOf(list)).toEqual([['فطور', 1], ['الحلا', 1], ['مفرزنات', 3]])
    expect(subsectionsOf(list, 'مفرزنات')).toEqual([['كفتة', 2], ['معجنات', 1]])
    expect(subsectionsOf(list, 'الحلا')).toEqual([])
  })

  it('a recipe is in the big section and in its own sub-section, not in another', () => {
    expect(inSection('مفرزنات › كفتة', 'مفرزنات')).toBe(true)
    expect(inSection('مفرزنات', 'مفرزنات')).toBe(true)
    expect(inSection('الحلا', 'مفرزنات')).toBe(false)
  })
})
