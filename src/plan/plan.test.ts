import { describe, expect, it } from 'vitest'
import { addDays, dayOfWeek, isIsoDate, todayIso, weekDays, weekRange, weekStartOf, weekdayName } from './dates'
import type { FoodGroup } from '../nutrition/api'
import { effectiveGroups, overridesFor, planMessage, slotUnion, type Override, type PlannedMeal } from './api'

const meal = (id: string, day: string, slot: string, recipe: string | null, status: PlannedMeal['status'] = 'planned'): PlannedMeal => ({
  id,
  day,
  slot_id: slot,
  recipe_id: recipe,
  title: id,
  free_text: recipe ? null : id,
  servings: null,
  people: [],
  position: 1,
  status,
})

describe('dates', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-11-28', 5)).toBe('2026-12-03')
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('knows the day of the week', () => {
    expect(dayOfWeek('2026-11-14')).toBe(6) // Saturday
    expect(dayOfWeek('2026-11-15')).toBe(0) // Sunday
  })

  it('finds the first day of the week, for any chosen first day', () => {
    expect(weekStartOf('2026-11-14', 6)).toBe('2026-11-14') // Saturday starts a Saturday week
    expect(weekStartOf('2026-11-15', 6)).toBe('2026-11-14')
    expect(weekStartOf('2026-11-20', 6)).toBe('2026-11-14') // Friday ends it
    expect(weekStartOf('2026-11-21', 6)).toBe('2026-11-21')
    expect(weekStartOf('2026-11-18', 0)).toBe('2026-11-15') // Sunday week
    expect(weekStartOf('2026-11-18', 1)).toBe('2026-11-16') // Monday week
  })

  it('lists the seven days of a week', () => {
    expect(weekDays('2026-11-28')).toEqual(['2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'])
  })

  it('writes days and weeks in Arabic with Latin digits', () => {
    expect(weekdayName('2026-11-14')).toBe('السبت')
    expect(weekRange('2026-11-14')).toMatch(/14.*20.*2026/)
    expect(weekRange('2026-11-14')).toMatch(/[؀-ۿ]/)
  })

  it('takes the date on the device, not the UTC date', () => {
    expect(todayIso(new Date(2026, 10, 12, 23, 59))).toBe('2026-11-12')
  })

  it('accepts only real dates', () => {
    expect(isIsoDate('2026-11-14')).toBe(true)
    expect(isIsoDate('2026-13-40')).toBe(false)
    expect(isIsoDate('nonsense')).toBe(false)
    expect(isIsoDate(undefined)).toBe(false)
  })
})

describe('food groups of a slot', () => {
  const groups: Record<string, FoodGroup[]> = { a: ['vegetables', 'dairy'], b: ['protein', 'carbs'] }
  const meals = [meal('m1', '2026-11-14', 's1', 'a'), meal('m2', '2026-11-14', 's1', 'b'), meal('m3', '2026-11-14', 's2', 'a'), meal('m4', '2026-11-14', 's1', null)]

  it('is the union of the recipes planned in that slot, in a fixed order, ignoring free text', () => {
    expect(slotUnion(meals, '2026-11-14', 's1', groups)).toEqual(['vegetables', 'protein', 'carbs', 'dairy'])
    expect(slotUnion(meals, '2026-11-14', 's2', groups)).toEqual(['vegetables', 'dairy'])
    expect(slotUnion(meals, '2026-11-15', 's1', groups)).toEqual([])
  })

  it('leaves out a meal that was skipped', () => {
    const skipped = [meal('m1', '2026-11-14', 's1', 'a', 'skipped'), meal('m2', '2026-11-14', 's1', 'b')]
    expect(slotUnion(skipped, '2026-11-14', 's1', groups)).toEqual(['protein', 'carbs'])
  })

  it('puts manual additions in and takes manual removals out, for that day and slot only', () => {
    const overrides: Override[] = [
      { day: '2026-11-14', slot_id: 's1', food_group: 'fruit', mode: 'add' },
      { day: '2026-11-14', slot_id: 's1', food_group: 'dairy', mode: 'remove' },
      { day: '2026-11-15', slot_id: 's1', food_group: 'protein', mode: 'remove' },
    ]
    const union = slotUnion(meals, '2026-11-14', 's1', groups)
    expect(effectiveGroups(union, overrides, '2026-11-14', 's1')).toEqual(['vegetables', 'protein', 'carbs', 'fruit'])
  })

  it('works out the manual changes that give the groups the person wants', () => {
    expect(overridesFor(['vegetables', 'dairy'], ['vegetables', 'fruit'])).toEqual({ add: ['fruit'], remove: ['dairy'] })
    expect(overridesFor(['vegetables'], ['vegetables'])).toEqual({ add: [], remove: [] })
    expect(overridesFor([], ['protein'])).toEqual({ add: ['protein'], remove: [] })
  })
})

describe('messages', () => {
  it('explains the database refusals in Arabic', () => {
    expect(planMessage(new Error('target_not_empty: the week you copy to already has meals'))).toContain('أسبوع فارغ')
    expect(planMessage(new Error('slot_in_use: x'))).toContain('وجبات مخطَّطة')
    expect(planMessage(new Error('not allowed to change the plan'))).toContain('صلاحية')
    expect(planMessage(new Error('Failed to fetch'))).toContain('الإنترنت')
  })
})
