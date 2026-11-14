import { describe, expect, it } from 'vitest'
import { identify, identifyAll } from './catalog'
import { cleanName, looksLikeSentence, parseIngredient } from './ingredient'

const parse = (line: string) => {
  const p = parseIngredient(line)
  return [p.quantity, p.unit, p.item]
}

describe('reading an ingredient line', () => {
  it('reads Western and Arabic-Indic digits, units and the item', () => {
    expect(parse('3 كوب حليب')).toEqual([3, 'cup', 'حليب'])
    expect(parse('٣ كوب حليب')).toEqual([3, 'cup', 'حليب'])
    expect(parse('٧٠ غ طحين')).toEqual([70, 'g', 'طحين'])
    expect(parse('٧٠جم زبده')).toEqual([70, 'g', 'زبده'])
    expect(parse('200 جرام فيتوتشيني')).toEqual([200, 'g', 'فيتوتشيني'])
    expect(parse('٢٥٠ ج جبنة حلومي مقطع مكعبات')).toEqual([250, 'g', 'جبنه حلومي مقطع مكعبات'])
  })

  it('reads the spoons: كبيرة / صغيرة, the abbreviations, the dual', () => {
    expect(parse('٢ ملعقة كبيرة زبادي')).toEqual([2, 'tbsp', 'زبادي'])
    expect(parse('ربع ملعقة صغيرة كمون')).toEqual([0.25, 'tsp', 'كمون'])
    expect(parse('1 م ك هيل')).toEqual([1, 'tbsp', 'هيل'])
    expect(parse('٣ م ك خل ابيض')).toEqual([3, 'tbsp', 'خل ابيض'])
    expect(parse('١/٢ م ص بشر ليمون')).toEqual([0.5, 'tsp', 'بشر ليمون'])
    expect(parse('ملعقتين زبادي')).toEqual([2, 'spoon', 'زبادي'])
    expect(parse('ملعقتان كبيرتان من زيت الزيتون')).toEqual([2, 'tbsp', 'زيت الزيتون'])
    expect(parse('ملعقة كبيرة بابريكا')).toEqual([1, 'tbsp', 'بابريكا'])
  })

  it('reads fractions and "and a half"', () => {
    expect(parse('½ كوب بارميزان مبشور')).toEqual([0.5, 'cup', 'بارميزان مبشور'])
    expect(parse('¼ ملعقة صغيرة فلفل أسود')).toEqual([0.25, 'tsp', 'فلفل اسود'])
    expect(parse('1/2 كوب ماء')).toEqual([0.5, 'cup', 'ماء'])
    expect(parse('١ ١/٣ كوب دقيق')).toEqual([1 + 1 / 3, 'cup', 'دقيق'])
    expect(parse('نص كاسة مويا')).toEqual([0.5, 'cup', 'مويا'])
    expect(parse('كاسة ونص كريمة خفق')).toEqual([1.5, 'cup', 'كريمه خفق'])
    expect(parse('كيلو ونصف باذنجان')).toEqual([1.5, 'kg', 'باذنجان'])
    expect(parse('كوبين كريمة طبخ')).toEqual([2, 'cup', 'كريمه طبخ'])
    expect(parse('ثلاثة ارباع علبة صوص البيتزا')).toEqual([0.75, 'can', 'صوص البيتزا'])
  })

  it('takes a container word as "one", but not «حبة» without a number', () => {
    expect(parse('علبة قشطة')).toEqual([1, 'can', 'قشطه'])
    expect(parse('4 حبات مستكة')).toEqual([4, 'piece', 'مستكه'])
    expect(parse('حبة بركة')).toEqual([null, null, 'حبه بركه']) // nigella seed, not "a piece of baraka"
    expect(parse('١ بصل مفروم')).toEqual([1, null, 'بصل مفروم'])
    expect(parse('٦ فص ثوم مهروس')).toEqual([6, 'clove', 'ثوم مهروس'])
  })

  it('reads the amount that comes after the name («دقيق - كاستين»)', () => {
    expect(parse('دقيق - كاستين')).toEqual([2, 'cup', 'دقيق'])
  })

  it('leaves a plain name alone and keeps the parenthesised remark as a note', () => {
    expect(parse('بصل')).toEqual([null, null, 'بصل'])
    expect(parse('٢٠٠ جرام حليب مكثف (بعد التقليل)')).toEqual([200, 'g', 'حليب مكثف'])
    expect(parseIngredient('٢٠٠ جرام حليب مكثف (بعد التقليل)').note).toBe('بعد التقليل')
  })
})

describe('the name used for matching', () => {
  it('drops the words that only describe («مقطع», «مفروم», «طازج») and the «ال»', () => {
    expect(cleanName('ثوم مهروس')).toBe('ثوم')
    expect(cleanName('بصل مفروم ناعم')).toBe('بصل')
    expect(cleanName('الثوم المهروس')).toBe('ثوم')
    expect(cleanName('ثوم حسب الرغبة')).toBe('ثوم')
    expect(cleanName('1 حبة متوسطة بصل مفروم ناعم')).toContain('بصل')
  })

  it('keeps «لحم مفروم» whole, since minced meat is its own thing in the shop', () => {
    expect(cleanName('لحم مفروم')).toBe('لحم مفروم')
    expect(cleanName('لحمة مفرومة')).toBe('لحم مفروم')
  })
})

describe('which shopping item a line is', () => {
  const key = (line: string) => identify(line).key

  it('puts the different spellings of one thing together', () => {
    expect(new Set(['فلفل اسود', 'فلفل أسود', '¼ ملعقة صغيرة فلفل أسود', 'فلفل'].map(key))).toEqual(new Set(['فلفل أسود']))
    expect(new Set(['جبن موزاريلا', 'جبنة موزريلا', 'موزاريلا', 'جبنة موتزريلا', 'جبنة مازرولا'].map(key))).toEqual(new Set(['جبن موزاريلا']))
    expect(new Set(['ثوم', '٦ فص ثوم مهروس', '٤ فصوص ثوم مهروس', 'ثوم حسب الرغبة'].map(key))).toEqual(new Set(['ثوم']))
    expect(new Set(['كريمة طبخ', '٢ كوب كريمة طبخ', 'كريمة الطبخ'].map(key))).toEqual(new Set(['كريمة طبخ']))
    expect(new Set(['بصل', 'بصلة', '١ بصل مفروم', 'بصلة كبيرة مكعبات'].map(key))).toEqual(new Set(['بصل']))
    expect(new Set(['رز', 'أرز', '١ كوب أرز مصري', '5 اكواب رز مغسل و منقوع'].map(key))).toEqual(new Set(['رز']))
  })

  it('tells apart what the shop keeps apart', () => {
    expect(key('لحم مفروم')).toBe('لحم مفروم')
    expect(key('لحم')).toBe('لحم')
    expect(key('بصل أحمر')).not.toBe(key('بصل'))
    expect(key('كزبرة ناشفة')).not.toBe(key('كزبرة'))
    expect(key('زيت زيتون')).not.toBe(key('زيت'))
    expect(key('كريمة خفق')).not.toBe(key('كريمة طبخ'))
  })

  it('gives the aisle, and marks water as not bought', () => {
    expect(identify('فلفل رومي').aisle).toBe('produce')
    expect(identify('صدور دجاج').aisle).toBe('meat')
    expect(identify('قشطة').aisle).toBe('dairy')
    expect(identify('ملح').aisle).toBe('spices')
    expect(identify('3 كوب ماء').aisle).toBe('none')
    expect(identify('مويا').aisle).toBe('none')
  })

  it('keeps an unknown name as its own item, in the writer\'s words', () => {
    const unknown = identify('٢ ملعقة كبيرة سيروب القيقب')
    expect(unknown.known).toBe(false)
    expect(unknown.label).toBe('سيروب القيقب')
    expect(unknown.aisle).toBe('other')
  })

  it('guesses the aisle of an unknown name from a word in it', () => {
    expect(identify('جبنة روكفور').aisle).toBe('dairy')
    expect(identify('فلفل هالبينو').aisle).toBe('produce')
  })
})

describe('lines that are not an ingredient, or list several', () => {
  it('marks method sentences, links, hashtags and lone dots as not ingredients', () => {
    expect(looksLikeSentence('بعدها اضيف كوب زيت واخفق شوية')).toBe(true)
    expect(identify('.').sentence).toBe(true)
    expect(identify('https://www.instagram.com/reel/abc').sentence).toBe(true)
    expect(identify('#وجبات_15_ثانية').sentence).toBe(true)
    expect(identify('٢ كوب حليب').sentence).toBe(false)
  })

  it('splits a line that lists ingredients into one item each', () => {
    expect(identifyAll('بهارات مشكلة ،فلفل اسود،كزبرة،ملح،بابريكا').map((i) => i.key)).toEqual(['بهار مشكل', 'فلفل أسود', 'كزبرة', 'ملح', 'بابريكا'])
    expect(identifyAll('بهارات (ملح، كزبرة ناشفة، فلفل اسود، بهار مشكل، كمون)').map((i) => i.key)).toEqual(['ملح', 'كزبرة ناشفة', 'فلفل أسود', 'بهار مشكل', 'كمون'])
    expect(identifyAll('خضار: جزر، كوسة، بطاطس، بصل').map((i) => i.key)).toEqual(['جزر', 'كوسة', 'بطاطس', 'بصل'])
  })

  it('gives every item of «لكل من» the quantity of the line', () => {
    const items = identifyAll('١/٢ ملعقة صغيرة لكل من فلفل أسود ، ثوم بودرة ، بصل بودرة')
    expect(items.map((i) => i.key)).toEqual(['فلفل أسود', 'ثوم بودرة', 'بصل بودرة'])
    expect(items.map((i) => [i.parsed.quantity, i.parsed.unit])).toEqual([[0.5, 'tsp'], [0.5, 'tsp'], [0.5, 'tsp']])
  })

  it('does not split a sentence that happens to have commas, and gives a plain line as one item', () => {
    const sentence = identifyAll('٤ حبات بيض بحرارة الغرفة وكوب سكر، ثم نخفقهم ونضيف الدقيق ونخلط جيدا، وبعدها نخبز')
    expect(sentence).toHaveLength(1)
    expect(sentence[0].sentence).toBe(true)
    expect(identifyAll('زيت زيتون')).toHaveLength(1)
  })
})
