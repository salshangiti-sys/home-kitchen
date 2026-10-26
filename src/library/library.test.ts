import { describe, expect, it } from 'vitest'
import { docToFields, fieldsToDoc, emptyFields, planningToDoc, platformOf } from './editorFields'
import { buildFileReport, chunk, parseRecipeFile, summarizeRun, ImportFileError } from './importReport'
import { isRecipeDoc, recipeErrors } from './validate'
import { LINK_ONLY, SALAD } from './fixtures'

describe('schema validation', () => {
  it('accepts records shaped like the OneNote export', () => {
    expect(recipeErrors(SALAD)).toEqual([])
    expect(isRecipeDoc(LINK_ONLY)).toBe(true)
  })

  it('names what is wrong', () => {
    const errors = recipeErrors({ ...SALAD, status: 'done', extra: 1, steps: [{ order: 0, text: 'x' }] })
    expect(errors.join('\n')).toMatch(/\/status: .*complete/)
    expect(errors.join('\n')).toMatch(/additional properties \(extra\)/)
    expect(errors.join('\n')).toMatch(/\/steps\/0\/order/)
  })
})

describe('editor fields', () => {
  it('round-trips a recipe without changing anything', () => {
    expect(fieldsToDoc(docToFields(SALAD), SALAD)).toEqual(SALAD)
  })

  it('keeps structured values only on lines whose text did not change', () => {
    const fields = docToFields(SALAD)
    fields.ingredients = fields.ingredients.replace('خيار مقطع', 'خيار مقطع مكعبات') + '\nملح'
    const doc = fieldsToDoc(fields, SALAD)
    expect(doc.ingredient_groups[0].items[0]).toEqual(SALAD.ingredient_groups[0].items[0])
    expect(doc.ingredient_groups[0].items[1]).toEqual({ text: 'خيار مقطع مكعبات' })
    expect(doc.ingredient_groups[1].items.at(-1)).toEqual({ text: 'ملح' })
  })

  it('keeps the original page text of an imported recipe', () => {
    const fields = docToFields(SALAD)
    fields.steps += '\nنقدمها باردة'
    expect(fieldsToDoc(fields, SALAD).raw_text).toBe(SALAD.raw_text)
  })

  it('builds a valid new recipe, with page text from its own fields', () => {
    const fields = {
      ...emptyFields(),
      title: 'شوربة عدس',
      section: 'شوربات',
      sources: 'وصفة أمي | https://example.com/soup',
      ingredients: 'عدس\n## التتبيلة\nكمون',
      steps: 'نغسل العدس\nنطبخه ساعة',
      prepTime: '١٥',
      mealTypes: ['dinner' as const],
      kidFriendly: 'yes' as const,
      customTags: 'شتوي، سريع',
    }
    const doc = fieldsToDoc(fields, null)
    expect(recipeErrors({ ...doc, id: 'new-001' })).toEqual([])
    expect(doc.ingredient_groups).toEqual([
      { name: null, items: [{ text: 'عدس' }] },
      { name: 'التتبيلة', items: [{ text: 'كمون' }] },
    ])
    expect(doc.sources).toEqual([{ url: 'https://example.com/soup', platform: 'web', label: 'وصفة أمي' }])
    expect(doc.prep_time_min).toBe(15)
    expect(doc.tags).toEqual({ meal_types: ['dinner'], kid_friendly: true, lunchbox: null, custom: ['شتوي', 'سريع'] })
    expect(doc.raw_text).toContain('الطريقة\n1. نغسل العدس\n2. نطبخه ساعة')
  })

  it('recognizes video platforms from the link', () => {
    expect(platformOf('https://youtu.be/x')).toBe('youtube')
    expect(platformOf('https://vm.tiktok.com/x')).toBe('tiktok')
    expect(platformOf('not a link')).toBe('other')
  })
})

describe('planning fields of a recipe read from OneNote', () => {
  it('change only the tags, servings and times', () => {
    const fields = { ...docToFields(SALAD), title: 'غيّرته', ingredients: 'سطر جديد', mealTypes: ['dinner' as const], servings: '6', customTags: 'صيفي' }
    const doc = planningToDoc(fields, SALAD)
    expect(doc).toEqual({ ...SALAD, tags: { ...doc.tags }, servings: 6, prep_time_min: doc.prep_time_min, cook_time_min: doc.cook_time_min })
    expect(doc.title).toBe(SALAD.title)
    expect(doc.ingredient_groups).toEqual(SALAD.ingredient_groups)
    expect(doc.tags).toMatchObject({ meal_types: ['dinner'], custom: ['صيفي'] })
  })
})

describe('import file report', () => {
  it('rejects a file that is not a JSON list', () => {
    expect(() => parseRecipeFile('{')).toThrow(ImportFileError)
    expect(() => parseRecipeFile('{"id": 1}')).toThrow(/قائمة/)
  })

  it('counts statuses, sections, flags and OneNote page ids, and lists bad and repeated records', () => {
    const report = buildFileReport([SALAD, LINK_ONLY, { ...SALAD }, { id: 'x-1', title: 'ناقص' }])
    expect(report.total).toBe(4)
    expect(report.valid.map((d) => d.id)).toEqual(['salads-007', 'desserts-002'])
    expect(report.duplicateIds).toEqual(['salads-007'])
    expect(report.invalid).toHaveLength(1)
    expect(report.invalid[0]).toMatchObject({ index: 3, id: 'x-1', title: 'ناقص' })
    expect(report.byStatus).toEqual({ complete: 1, partial: 0, link_only: 1, note_only: 0 })
    expect(report.flagCounts).toEqual([['possible_duplicate', 1], ['quantities_missing', 1]])
    expect(report.flaggedRecords).toBe(2)
    expect(report.withPageId).toBe(1)
  })

  it('summarizes an import run', () => {
    const summary = summarizeRun([
      { id: 'a', result: 'created' },
      { id: 'b', result: 'skipped_edited' },
      { id: 'c', result: 'error', error: 'bad' },
    ])
    expect(summary.counts).toMatchObject({ created: 1, skipped_edited: 1, error: 1 })
    expect(summary.skippedEdited).toEqual(['b'])
    expect(summary.errors).toEqual([{ id: 'c', error: 'bad' }])
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
})
