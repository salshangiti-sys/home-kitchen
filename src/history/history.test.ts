import { describe, expect, it } from 'vitest'
import { daysAgo, daysBetween, formatDate, historyMessage, localDate, summarize, timesLabel, type CookEntry } from './api'

const entry = (cooked_on: string, rating: number | null = null): CookEntry => ({
  id: cooked_on + rating,
  recipe_id: 'salads-007',
  user_id: 'u1',
  cooked_on,
  rating,
  note: null,
  created_at: '2026-11-12T00:00:00Z',
})

describe('dates', () => {
  it('uses the date on the device, not the UTC date', () => {
    expect(localDate(new Date(2026, 10, 12, 23, 59))).toBe('2026-11-12')
    expect(localDate(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05')
  })

  it('counts days across month ends and daylight changes', () => {
    expect(daysBetween('2026-10-31', '2026-11-01')).toBe(1)
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)
    expect(daysBetween('2025-11-12', '2026-11-12')).toBe(365)
  })

  it.each([
    ['2026-11-12', 'اليوم'],
    ['2026-11-11', 'أمس'],
    ['2026-11-10', 'قبل يومين'],
    ['2026-11-07', 'قبل 5 أيام'],
    ['2026-10-25', 'قبل 18 يومًا'],
    ['2026-10-01', 'قبل شهر'],
    ['2026-08-01', 'قبل 3 أشهر'],
    ['2025-11-01', 'قبل سنة'],
    ['2024-11-01', 'قبل سنتين'],
    ['2026-11-13', 'غدًا'],
  ])('says how long ago %s was', (date, text) => {
    expect(daysAgo(date, '2026-11-12')).toBe(text)
  })

  it('writes a date in Arabic with Latin digits', () => {
    const text = formatDate('2026-11-12')
    expect(text).toContain('2026')
    expect(text).toContain('12')
    expect(text).toMatch(/[؀-ۿ]/)
  })
})

describe('summary', () => {
  it('counts, finds the latest date, and averages only the rated entries', () => {
    expect(summarize([entry('2026-10-01', 5), entry('2026-11-05', 4), entry('2026-09-01'), entry('2026-10-20', 4)])).toEqual({
      count: 4,
      lastOn: '2026-11-05',
      average: 4.3,
    })
  })

  it('has nothing to say about an empty history, or one without ratings', () => {
    expect(summarize([])).toEqual({ count: 0, lastOn: null, average: null })
    expect(summarize([entry('2026-10-01')]).average).toBeNull()
  })

  it.each([
    [1, 'طُبخت مرة واحدة'],
    [2, 'طُبخت مرتين'],
    [3, 'طُبخت 3 مرات'],
    [10, 'طُبخت 10 مرات'],
    [11, 'طُبخت 11 مرة'],
  ])('%i times', (count, text) => {
    expect(timesLabel(count)).toBe(text)
  })
})

describe('messages', () => {
  it('explains the database refusals in Arabic and a missing connection', () => {
    expect(historyMessage(new Error('bad_date: the date of cooking is not valid'))).toContain('التاريخ')
    expect(historyMessage(new Error('bad_rating: the rating is from 1 to 5'))).toContain('1 إلى 5')
    expect(historyMessage(new Error('entry not found or not allowed'))).toContain('لا يمكنك')
    expect(historyMessage(new Error('Failed to fetch'))).toContain('الإنترنت')
  })
})
