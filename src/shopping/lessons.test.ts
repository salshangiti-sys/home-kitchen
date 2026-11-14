import { afterEach, describe, expect, it } from 'vitest'
import { identify, setLessons } from './catalog'
import { unknownNames } from './lessons'
import { roleOf } from './roles'

afterEach(() => setLessons([]))

describe('what she teaches the dictionary', () => {
  it('a name the dictionary does not know is its own item until it is taught', () => {
    const before = identify('٢ فلفل هالبينو')
    expect(before.known).toBe(false)
    expect(before.key).toBe('فلفل هالبينو')
  })

  it('"the same as" a known name joins that item, with its aisle', () => {
    setLessons([{ name_key: 'فلفل هالبينو', target: 'فلفل حار', aisle: 'produce' }])
    const taught = identify('٢ فلفل هالبينو')
    expect(taught).toMatchObject({ key: 'فلفل حار', label: 'فلفل حار', aisle: 'produce', known: true })
    expect(identify('فلفل حار').key).toBe('فلفل حار') // so they are one item in the list
  })

  it('"an item of its own" keeps its name and takes the chosen aisle', () => {
    expect(identify('٢٠٠ جرام برغل').aisle).toBe('other')
    setLessons([{ name_key: 'برغل', target: null, aisle: 'pantry' }])
    expect(identify('٢٠٠ جرام برغل')).toMatchObject({ key: 'برغل', aisle: 'pantry', known: true })
  })

  it('a lesson beats the dictionary and applies to the order of ingredients too', () => {
    expect(roleOf('برغل')).toBe('other')
    setLessons([{ name_key: 'برغل', target: 'رز', aisle: 'pantry' }])
    expect(roleOf('برغل')).toBe('carb') // taught as "the same as rice"
  })

  it('a lesson whose target is not in the dictionary makes that target the item', () => {
    setLessons([{ name_key: 'برغل', target: 'قمح مجروش', aisle: 'pantry' }])
    expect(identify('برغل')).toMatchObject({ key: 'قمح مجروش', label: 'قمح مجروش', aisle: 'pantry', known: true })
  })
})

describe('unknownNames', () => {
  const lines = {
    r1: ['٢٠٠ جرام برغل', 'ملح', 'ماء'],
    r2: ['برغل', 'شي غريب'],
    r3: ['٣ برغل', 'https://www.instagram.com/reel/abc', 'حطيت الخضار في الفرن حتى ينضج جيدا ثم أخرجته'],
  }

  it('lists the names the dictionary does not know, the most used first, counting recipes not lines', () => {
    const found = unknownNames(lines)
    expect(found[0]).toMatchObject({ key: 'برغل', recipes: 3 })
    expect(found.map((u) => u.key)).toContain('شي غريب')
  })

  it('leaves out known names, water, links and sentences', () => {
    const keys = unknownNames(lines).map((u) => u.key)
    expect(keys).not.toContain('ملح')
    expect(keys).not.toContain('ماء')
    expect(keys.some((k) => k.includes('instagram'))).toBe(false)
    expect(keys.some((k) => k.includes('حطيت'))).toBe(false)
  })

  it('a name disappears from the list once it is taught', () => {
    setLessons([{ name_key: 'برغل', target: null, aisle: 'pantry' }])
    expect(unknownNames(lines).map((u) => u.key)).not.toContain('برغل')
  })
})
