import { describe, expect, it } from 'vitest'
import type { FreezerItem } from './api'
import { frozenAgo, inFreezer, isOld, quantityText, summary } from './model'

const item = (name: string, quantity = 1, unit = 'قطعة', frozen_on = '2026-11-01'): FreezerItem => ({ id: name, name, quantity, unit, frozen_on, recipe_id: null, note: null })

describe('the quantity as text', () => {
  it('drops a useless decimal part', () => {
    expect(quantityText(12, 'كرة')).toBe('12 كرة')
    expect(quantityText(2.5, 'كيس')).toBe('2.5 كيس')
    expect(quantityText(0.333333, 'علبة')).toBe('0.33 علبة')
  })
})

describe('how long ago it was frozen', () => {
  const today = '2026-11-16'
  it('says it in days, weeks and months', () => {
    expect(frozenAgo('2026-11-16', today)).toBe('اليوم')
    expect(frozenAgo('2026-11-15', today)).toBe('أمس')
    expect(frozenAgo('2026-11-12', today)).toBe('قبل 4 أيام')
    expect(frozenAgo('2026-11-09', today)).toBe('قبل أسبوع')
    expect(frozenAgo('2026-11-02', today)).toBe('قبل أسبوعين')
    expect(frozenAgo('2026-10-19', today)).toBe('قبل 4 أسابيع')
    expect(frozenAgo('2026-09-10', today)).toBe('قبل شهرين')
    expect(frozenAgo('2026-05-01', today)).toBe('قبل 6 أشهر')
  })
  it('marks what has been there more than three months', () => {
    expect(isOld('2026-08-01', today)).toBe(true)
    expect(isOld('2026-10-01', today)).toBe(false)
  })
})

describe('finding what is in the freezer for a name', () => {
  const items = [item('كرات لحم'), item('لحم مفروم مطبوخ'), item('صوص طماطم'), item('معجنات')]
  it('matches when every word of the shorter name is in the other', () => {
    expect(inFreezer(items, 'لحم مفروم').map((i) => i.name)).toEqual(['لحم مفروم مطبوخ'])
    expect(inFreezer(items, 'لحم').map((i) => i.name)).toEqual(['كرات لحم', 'لحم مفروم مطبوخ'])
    expect(inFreezer(items, 'صوص الطماطم').map((i) => i.name)).toEqual([])
  })
  it('matches nothing for a name that is not there, or an empty one', () => {
    expect(inFreezer(items, 'دجاج')).toEqual([])
    expect(inFreezer(items, '  ')).toEqual([])
  })
  it('lists items with their quantities', () => {
    expect(summary([item('كرات لحم', 12, 'كرة'), item('صوص طماطم', 3, 'علبة')])).toBe('كرات لحم ×12 كرة، صوص طماطم ×3 علبة')
  })
})
