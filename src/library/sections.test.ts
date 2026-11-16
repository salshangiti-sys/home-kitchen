import { describe, expect, it } from 'vitest'
import { sectionsOf } from './sections'

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
