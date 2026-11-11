import { describe, expect, it } from 'vitest'
import { buildChanges, bulkMessage, emptyChoices, parseTags, previewText } from './bulkTag'

describe('parseTags', () => {
  it('splits on Arabic and Latin commas, trims, drops empties and repeats', () => {
    expect(parseTags(' سريعة ، عائلية,سريعة ,, Quick ,quick')).toEqual(['سريعة', 'عائلية', 'Quick'])
    expect(parseTags('   ')).toEqual([])
  })
})

describe('buildChanges', () => {
  it('has nothing to send when nothing is chosen', () => {
    expect(buildChanges(emptyChoices())).toEqual({ changes: null, problem: null })
  })

  it('turns the choices into what the database takes, meal types in the app order', () => {
    const { changes } = buildChanges({
      meals: { dinner: 'add', lunch: 'add', snack: 'remove' },
      kid: 'yes',
      lunchbox: 'unset',
      custom: 'سريعة، عائلية',
    })
    expect(changes).toEqual({
      meal_types: { add: ['lunch', 'dinner'], remove: ['snack'] },
      kid_friendly: true,
      lunchbox: null,
      custom: { add: ['سريعة', 'عائلية'] },
    })
  })

  it('leaves out what is not chosen, and tells yes, no and not-set apart', () => {
    expect(buildChanges({ ...emptyChoices(), kid: 'no' }).changes).toEqual({ kid_friendly: false })
    expect(buildChanges({ ...emptyChoices(), lunchbox: 'unset' }).changes).toEqual({ lunchbox: null })
    expect(buildChanges({ ...emptyChoices(), meals: { drink: 'remove' } }).changes).toEqual({ meal_types: { remove: ['drink'] } })
  })

  it('refuses too many or too long private tags before asking the database', () => {
    expect(buildChanges({ ...emptyChoices(), custom: Array.from({ length: 11 }, (_, i) => `وسم${i}`).join('،') }).problem).toContain('10')
    expect(buildChanges({ ...emptyChoices(), custom: 'ا'.repeat(41) }).problem).toContain('40')
  })
})

describe('texts', () => {
  it('describes the preview', () => {
    expect(previewText({ changed: 0, unchanged: 3, skipped: 0, dry_run: true }, 3)).toContain('لا شيء سيتغير')
    expect(previewText({ changed: 2, unchanged: 1, skipped: 0, dry_run: true }, 3)).toBe('ستتغير 2 من 3 وصفات. 1 عليها هذه الوسوم أصلًا فلن تتغير.')
    expect(previewText({ changed: 1, unchanged: 0, skipped: 2, dry_run: true }, 3)).toContain('2 لم تُوجد')
    expect(previewText({ changed: 1, unchanged: 0, skipped: 0, dry_run: true }, 1)).toBe('ستتغير 1 من 1 وصفة.')
  })

  it('explains database refusals in Arabic', () => {
    expect(bulkMessage(new Error('too_many: at most 300 recipes at a time'))).toContain('300')
    expect(bulkMessage(new Error('not allowed to edit this recipe'))).toContain('صلاحية')
    expect(bulkMessage(new Error('Failed to fetch'))).toContain('الإنترنت')
  })
})
