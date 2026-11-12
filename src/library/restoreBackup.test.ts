import { describe, expect, it } from 'vitest'
import { addsAnything, parseBackup, reportLines, restoreMessage, type RestoreResult } from './restoreBackup'

const file = (patch: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: 'home-kitchen-backup',
    version: 1,
    created_at: '2026-11-12T02:30:04.000Z',
    recipes: [{ id: 'a' }, { id: 'b' }],
    deleted_recipes: [{ doc: { id: 'c' }, deleted_at: '2026-11-01T00:00:00Z' }],
    favorites: [{}, {}, {}],
    versions: [{}, {}, {}, {}],
    cook_log: [{}],
    planned_meals: [{}, {}, {}],
    photos: [{}, {}],
    ...patch,
  })

const result = (patch: Partial<RestoreResult> = {}): RestoreResult => ({
  dry_run: true,
  recipes_created: 0,
  recipes_existing: 0,
  trashed_created: 0,
  versions_added: 0,
  favorites_added: 0,
  flags_restored: 0,
  links_added: 0,
  cook_entries_added: 0,
  food_groups_added: 0,
  people_added: 0,
  planned_meals_added: 0,
  entries_skipped_unknown_person: 0,
  photos_in_file: 0,
  errors: [],
  ...patch,
})

describe('parseBackup', () => {
  it('reads a backup file and summarises what it holds', () => {
    const { summary } = parseBackup(file())
    expect(summary).toEqual({ createdAt: '2026-11-12T02:30:04.000Z', recipes: 2, deleted: 1, favorites: 3, cookEntries: 1, meals: 3, versions: 4, photos: 2 })
  })

  it('copes with a file from before cooking history or photos existed', () => {
    const { summary } = parseBackup(file({ cook_log: undefined, photos: undefined, favorites: undefined }))
    expect(summary).toMatchObject({ cookEntries: 0, photos: 0, favorites: 0 })
  })

  it.each([
    ['not JSON', 'هذا ليس ملف'],
    ['[]', 'ليس ملف نسخة احتياطية من التطبيق'],
    ['null', 'ليس ملف نسخة احتياطية من التطبيق'],
    [JSON.stringify([{ id: 'recipes.json is a list of recipes' }]), 'ليس ملف نسخة احتياطية من التطبيق'],
    [file({ format: 'something-else' }), 'ليس ملف نسخة احتياطية من التطبيق'],
    [file({ version: 2 }), 'أحدث مما يعرفه التطبيق'],
    [file({ recipes: 'no' }), 'ناقص'],
  ])('refuses %s', (text, message) => {
    expect(() => parseBackup(text)).toThrow(message)
  })

  it('points a recipes.json to the import page', () => {
    expect(() => parseBackup('[{"id":"x"}]')).toThrow('صفحة «استيراد»')
  })
})

describe('the report', () => {
  it('says nothing about what is not added, and whether anything is', () => {
    expect(addsAnything(result())).toBe(false)
    expect(reportLines(result())).toEqual([])
    const r = result({ recipes_created: 12, trashed_created: 1, favorites_added: 5, cook_entries_added: 3, versions_added: 20, flags_restored: 2, links_added: 11, food_groups_added: 9, people_added: 2, planned_meals_added: 14 })
    expect(addsAnything(r)).toBe(true)
    expect(reportLines(r)).toEqual([
      '12 وصفة جديدة',
      '1 وصفة في سلة المحذوفات',
      '5 من المفضلة',
      '3 من سجل التجارب',
      '20 من الإصدارات السابقة',
      '2 من علامات المراجعة',
      '11 من روابط صفحات OneNote',
      '9 من العناصر الغذائية',
      '2 من أفراد الأسرة',
      '14 من وجبات الخطة',
    ])
  })

  it('does not count recipes that were already there as something added', () => {
    expect(addsAnything(result({ recipes_existing: 30 }))).toBe(false)
  })
})

describe('messages', () => {
  it('explains refusals in Arabic', () => {
    expect(restoreMessage(new Error('only the owner can restore from a backup'))).toContain('للمالكة فقط')
    expect(restoreMessage(new Error('not_a_backup: x'))).toContain('ليس ملف نسخة')
    expect(restoreMessage(new Error('Failed to fetch'))).toContain('الإنترنت')
  })
})
