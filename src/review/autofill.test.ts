import { describe, expect, it } from 'vitest'
import { autofillFor, groupsFor, prepFor, tagsFor, vegetablesIn } from './autofill'

const input = (title: string, lines: string[], text = '') => ({ title, lines, text })

describe('tags from the title and the lines', () => {
  it('chicken, shredded, minced and big meat', () => {
    expect(tagsFor(input('رز بالفرن (دجاج مفتفت)', ['رز', 'دجاج']))).toEqual(['دجاج', 'دجاج مفتفت'])
    expect(tagsFor(input('مكرونة بشاميل', ['لحم مفروم وبصل', 'مكرونة']))).toEqual(['لحم مفروم'])
    expect(tagsFor(input('رز عربي', ['كيلوين و نص لحم مقطع اوصال كبار']))).toEqual(['لحم كبير'])
  })
  it('chicken breasts are a tag of their own', () => {
    expect(tagsFor(input('سيزر راب', ['٢ صدر دجاج', 'خس']))).toEqual(['دجاج', 'صدور دجاج'])
    expect(tagsFor(input('شاورما', ['١ كجم صدور دجاج شرائح']))).toEqual(['دجاج', 'صدور دجاج'])
    expect(tagsFor(input('إيدام', ['دجاج مقطع', 'صدر الخروف']))).toEqual(['دجاج'])
  })
  it('a snack tag only when the title says so', () => {
    expect(tagsFor(input('سمبوسة جبنة', ['جبنة']))).toEqual(['سناك/خفايف'])
    expect(tagsFor(input('كبسة', ['رز']))).toEqual([])
  })
  it('plain meat when it does not say which kind, kofta apart', () => {
    expect(tagsFor(input('كبسة حمراء', ['بصل', 'لحم', 'رز']))).toEqual(['لحم'])
    expect(tagsFor(input('صينية كفتة بالخضار', ['كفتة', 'بصل']))).toEqual(['كفتة'])
  })
  it('a stock cube does not make a chicken dish', () => {
    expect(tagsFor(input('رز بالشعيرية', ['١ كوب أرز', '٢ كوب موية (مغلية او مرق دجاج)']))).toEqual([])
    expect(tagsFor(input('شربة بطاطس', ['بطاطس', 'مكعب مرقة الدجاج']))).toEqual([])
  })
  it('tuna, shrimp, fish, and quick only when the text says so; «أسمك» is not fish', () => {
    expect(tagsFor(input('مكرونة بالتونا', ['تونا'], 'في اسرع وقت'))).toEqual(['تونا', 'سريع'])
    expect(tagsFor(input('باستا بالروبيان', ['روبيان / قمبري']))).toEqual(['روبيان'])
    expect(tagsFor(input('تشيز كيك', ['جبن'], 'الطبقة طلعت أسمك من جهة'))).toEqual([])
  })
})

describe('food groups', () => {
  it('works them out from the lines, in a fixed order', () => {
    expect(groupsFor(input('إيدام دجاج بالكريمة', ['دجاج', 'بصل', 'كريمة طبخ']))).toEqual(['vegetables', 'protein', 'dairy'])
  })
  it('mozzarella is not fruit, and eggs in a cake are not protein', () => {
    expect(groupsFor(input('بيتزا', ['جبن موزاريلا', 'دقيق']))).toEqual(['carbs', 'dairy'])
    expect(groupsFor(input('ماربل كيك', ['3 بيضات', 'دقيق', 'حليب']))).toEqual(['carbs', 'dairy'])
    expect(groupsFor(input('بيض تركي', ['4 بيضات', 'بصلة']))).toEqual(['vegetables', 'protein'])
  })
  it('tomato paste is not a vegetable, a banana is a fruit', () => {
    expect(groupsFor(input('صلصة', ['معجون طماطم', 'ملح']))).toEqual([])
    expect(groupsFor(input('كب كيك الموز', ['2 موز', 'دقيق']))).toEqual(['carbs', 'fruit'])
  })
})

describe('prep tasks', () => {
  it('takes chicken and meat out of the freezer in the morning', () => {
    const prep = prepFor(input('إيدام', ['دجاج', 'لحم مفروم']))
    expect(prep.map((p) => [p.kind, p.timing, p.body])).toEqual([
      ['defrost', 'morning', 'أخرجي الدجاج من الفريزر'],
      ['defrost', 'morning', 'أخرجي اللحم من الفريزر'],
    ])
  })
  it('lists the vegetables to chop, with the cutting method its own line gives', () => {
    expect(vegetablesIn(['١ بصل مفروم', '٢ جزر مبشور', 'فلفل رومي', 'حبة بصل وجزر'])).toEqual([
      { name: 'بصل', cut: 'مفروم' },
      { name: 'جزر', cut: 'مبشور' },
      { name: 'فلفل رومي', cut: null },
    ])
    expect(vegetablesIn(['1 طماطم مقطع مكعبات صغير'])).toEqual([{ name: 'طماطم', cut: 'مكعبات صغيرة' }])
  })
  it('chops, soaks the rice and marinates when the lines say so', () => {
    const prep = prepFor(input('رز مديني', ['5 كاسات رز مغسل و منقوع', 'كيلوين لحم', 'تتبيلة اللحم:', 'بصل مفروم ناعم']))
    expect(prep.map((p) => p.body)).toEqual(['أخرجي اللحم من الفريزر', 'انقعي الأرز', 'تتبيل اللحم', 'تقطيع الخضار: بصل (مفروم ناعم)'])
  })
  it('takes frozen things out by their own line, and never invents a time', () => {
    const prep = prepFor(input('صينية', ['١ كوب ذرة مجمدة', 'بطاطس']))
    expect(prep.map((p) => p.body)).toEqual(['أخرجي «١ كوب ذرة مجمدة» من الفريزر', 'تقطيع الخضار: بطاطس'])
    expect(prep.every((p) => p.atTime === null)).toBe(true)
  })
  it('nothing for a page with no ingredients yet', () => {
    expect(autofillFor(input('وصفة جديدة', []))).toEqual({ tags: [], groups: [], prep: [] })
  })
})
