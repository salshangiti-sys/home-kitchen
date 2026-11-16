import { describe, expect, it } from 'vitest'
import { buildOverview, filterRows, problemCounts, uncutVegetables, type OverviewData } from './overview'

const data: OverviewData = {
  flags: [
    { id: 'f1', recipe_id: 'c', flag: 'added_from_onenote', status: 'open' },
    { id: 'f2', recipe_id: 'b', flag: 'auto_filled', status: 'reviewed' },
  ],
  recipes: [
    { id: 'a', title: 'إيدام دجاج بالكريمة', section: 'صواني وايدامات', custom_tags: ['دجاج'] },
    { id: 'b', title: 'حلا الاوريو', section: 'الحلا', custom_tags: [] },
    { id: 'c', title: 'فيتوتشيني', section: 'أرزاز ومكرونات (دجاج)', custom_tags: ['دجاج'] },
  ],
  lines: [
    { recipe_id: 'a', position: 2, text: 'كريمة طبخ' },
    { recipe_id: 'a', position: 1, text: 'الحشوة:' },
    { recipe_id: 'a', position: 3, text: 'دجاج' },
  ],
  suggestions: [
    { recipe_id: 'b', position: 1, text: '٢٤ اوريو' },
    { recipe_id: 'b', position: 2, text: 'قشطة' },
  ],
  templates: [
    { id: 't1', recipe_id: 'a', kind: 'defrost', timing: 'morning', at_time: null, body: 'أخرجي الدجاج من الفريزر', position: 1 },
    { id: 't2', recipe_id: 'a', kind: 'wash_chop', timing: 'before_cooking', at_time: null, body: 'تقطيع الخضار: بصل (مفروم)، جزر، فلفل رومي', position: 4 },
  ],
  groups: [
    { recipe_id: 'a', food_group: 'protein' },
    { recipe_id: 'a', food_group: 'dairy' },
  ],
}

describe('which vegetables still have no cutting method', () => {
  it('names the ones without a bracket', () => {
    expect(uncutVegetables('تقطيع الخضار: بصل (مفروم)، جزر، فلفل رومي')).toEqual(['جزر', 'فلفل رومي'])
    expect(uncutVegetables('تقطيع الخضار: بطاطس (شرائح، مسلوقة أولًا)، بصل')).toEqual(['بصل'])
    expect(uncutVegetables('تقطيع الخضار: بصل (مفروم ناعم)، جزر (مبشور)')).toEqual([])
  })
  it('ignores tasks that are not chopping', () => {
    expect(uncutVegetables('أخرجي الدجاج من الفريزر')).toEqual([])
  })
})

describe('one row per recipe', () => {
  const rows = buildOverview(data)
  const byId = (id: string) => rows.find((r) => r.id === id)!

  it('shows the page\'s lines without the label lines, or the ones she confirmed in the app', () => {
    expect(byId('a').ingredients).toEqual(['كريمة طبخ', 'دجاج'])
    expect(byId('a').ingredients).not.toContain('الحشوة:')
    expect(byId('a').ingredientsFromApp).toBe(false)
    expect(byId('b').ingredients).toEqual(['٢٤ اوريو', 'قشطة'])
    expect(byId('b').ingredientsFromApp).toBe(true)
  })

  it('shows the prep tasks with their kind and time, and the groups in a fixed order', () => {
    expect(byId('a').prep).toEqual([
      { id: 't1', kind: 'defrost', timing: 'morning', atTime: null, label: 'إذابة · صباحًا', body: 'أخرجي الدجاج من الفريزر' },
      { id: 't2', kind: 'wash_chop', timing: 'before_cooking', atTime: null, label: 'غسل وتقطيع · قبل الطبخ', body: 'تقطيع الخضار: بصل (مفروم)، جزر، فلفل رومي' },
    ])
    expect(byId('a').groups).toEqual(['protein', 'dairy'])
  })

  it('says what each recipe is still missing', () => {
    expect(byId('a').problems).toEqual(['cut_missing'])
    expect(byId('a').uncut).toEqual(['جزر', 'فلفل رومي'])
    expect(byId('b').problems).toEqual(['no_tags', 'no_prep', 'no_groups'])
    expect(byId('c').problems).toEqual(['awaiting', 'no_ingredients', 'no_prep', 'no_groups'])
  })

  it('a recipe waits for approval while its added-from-OneNote or auto-filled flag is open', () => {
    expect(byId('c').awaiting).toEqual(['f1'])
    expect(byId('b').awaiting).toEqual([]) // its flag is already reviewed
    expect(byId('a').awaiting).toEqual([])
  })

  it('counts them', () => {
    expect(Object.fromEntries(problemCounts(rows))).toEqual({ awaiting: 1, no_tags: 1, no_ingredients: 1, no_prep: 2, cut_missing: 1, no_groups: 2 })
  })
})

describe('filtering the list', () => {
  const rows = buildOverview(data)
  const none = { query: '', section: null, problem: null, tag: null }

  it('by section, by what is missing, by tag and by name or tag text', () => {
    expect(filterRows(rows, { ...none, section: 'الحلا' }).map((r) => r.id)).toEqual(['b'])
    expect(filterRows(rows, { ...none, problem: 'no_prep' }).map((r) => r.id)).toEqual(['b', 'c'])
    expect(filterRows(rows, { ...none, tag: 'دجاج' }).map((r) => r.id)).toEqual(['a', 'c'])
    expect(filterRows(rows, { ...none, query: 'اوريو' }).map((r) => r.id)).toEqual(['b'])
    expect(filterRows(rows, { ...none, query: 'دجاج' }).map((r) => r.id)).toEqual(['a', 'c'])
  })

  it('combines the choices', () => {
    expect(filterRows(rows, { ...none, tag: 'دجاج', problem: 'no_ingredients' }).map((r) => r.id)).toEqual(['c'])
  })
})
