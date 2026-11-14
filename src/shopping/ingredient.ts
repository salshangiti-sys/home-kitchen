// Reading one ingredient line («٢ ملعقة كبيرة زيت زيتون») into a quantity, a unit and the item, and
// finding the item's NAME for matching it across recipes. Plain rules, no AI, for Arabic as it is written
// in these recipes (Arabic-Indic and Western digits, fractions, «نص / ربع», dual forms like «كوبين»,
// abbreviations like «م ك» and «م ص»).
//
// Nothing here changes what the person wrote: the line stays exactly as it is, and this is only used
// to group lines in the shopping list. A quantity found here is a SUGGESTION: the shopping list adds
// quantities together only after the person confirms them (see docs/06-phase2-plan.md).

import { normalizeAr } from '../library/normalize'

export type UnitKind = 'g' | 'kg' | 'ml' | 'l' | 'cup' | 'tbsp' | 'tsp' | 'spoon' | 'pinch' | 'piece' | 'clove' | 'can' | 'pack' | 'bunch'

export interface ParsedLine {
  quantity: number | null
  unit: UnitKind | null
  item: string // what is left of the line, as written
  note: string | null // a parenthesised remark
}

// Words, in the normalized spelling of normalizeAr (no diacritics, أ→ا, ة→ه, ى→ي).
const UNIT_WORDS: Array<[UnitKind, string[]]> = [
  ['kg', ['كيلو', 'كيلوين', 'كجم', 'كغ', 'كغم', 'kg']],
  ['g', ['جرام', 'غرام', 'جم', 'غم', 'غ', 'ج', 'g', 'gm', 'gram']],
  ['l', ['لتر', 'لترات']],
  ['ml', ['مل', 'ملل', 'ml']],
  ['cup', ['كوب', 'اكواب', 'كاسه', 'كاسات', 'كاس', 'كؤوس']],
  ['tbsp', ['م ك', 'مك']],
  ['tsp', ['م ص', 'مص']],
  ['spoon', ['ملعقه', 'ملاعق']],
  ['pinch', ['رشه', 'رشات', 'كمشه', 'كمشات']],
  ['clove', ['فص', 'فصوص']],
  ['can', ['علبه', 'علب']],
  ['pack', ['ظرف', 'ظروف', 'كيس', 'اكياس', 'باكيت', 'باكت', 'عبوه']],
  ['bunch', ['حزمه', 'حزم', 'ربطه', 'ربط']],
  ['piece', ['حبه', 'حبات', 'حبتين', 'قطعه', 'قطع', 'شريحه', 'شرائح']],
]
const UNIT_OF = new Map(UNIT_WORDS.flatMap(([kind, words]) => words.map((w) => [w, kind] as const)))

// A unit written as a dual: «كوبين» is 2 cups.
const DUAL: Record<string, [number, UnitKind]> = {
  كوبين: [2, 'cup'], كوبان: [2, 'cup'], كاستين: [2, 'cup'], ملعقتين: [2, 'spoon'], ملعقتان: [2, 'spoon'], حبتين: [2, 'piece'], حبتان: [2, 'piece'],
  قطعتين: [2, 'piece'], علبتين: [2, 'can'], فصين: [2, 'clove'], ظرفين: [2, 'pack'], كيسين: [2, 'pack'], رشتين: [2, 'pinch'], شريحتين: [2, 'piece'],
}

const WORD_NUMBERS: Record<string, number> = {
  نص: 0.5, نصف: 0.5, ربع: 0.25, ثلث: 1 / 3, واحد: 1, واحده: 1, اثنين: 2, اثنان: 2, ثنتين: 2, ثلاث: 3, ثلاثه: 3, اربع: 4, اربعه: 4,
  خمس: 5, خمسه: 5, ست: 6, سته: 6, سبع: 7, سبعه: 7, ثمان: 8, ثمانيه: 8, تسع: 9, تسعه: 9, عشر: 10, عشره: 10,
}

// Units where a bare word (no number before it) still counts as "one": a can, a spoon, a cup...
// «حبه / قطعه» are not among them («حبة بركة» is nigella seed, not "a piece of baraka").
const BARE_UNITS = new Set<UnitKind>(['cup', 'spoon', 'pinch', 'can', 'pack', 'bunch', 'tbsp', 'tsp'])

const FRACTIONS: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 }

// Puts a space between a number and the letters stuck to it («٧٠جم», «500غ», «250g»).
function spaced(text: string): string {
  return text
    .replace(/([½¼¾⅓⅔])/g, ' $1 ')
    .replace(/(\d)([^\d\s./٫,])/g, '$1 $2')
    .replace(/([^\d\s./٫,])(\d)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

function numberOf(token: string): number | null {
  if (token in FRACTIONS) return FRACTIONS[token]
  const frac = token.match(/^(\d+)\/(\d+)$/)
  if (frac && Number(frac[2]) > 0) return Number(frac[1]) / Number(frac[2])
  if (/^\d+([.,٫]\d+)?$/.test(token)) return Number(token.replace(/[,٫]/, '.'))
  if (token in WORD_NUMBERS) return WORD_NUMBERS[token]
  return null
}

// The words «ونص / وربع» attach "and a half" to what comes before.
function andFraction(token: string): number | null {
  if (token.startsWith('و') && token.length > 1) {
    const rest = token.slice(1)
    if (rest in WORD_NUMBERS && WORD_NUMBERS[rest] < 1) return WORD_NUMBERS[rest]
    const frac = numberOf(rest)
    if (frac !== null && frac < 1) return frac
  }
  return null
}

export function parseIngredient(line: string): ParsedLine {
  const raw = line.trim()
  // a parenthesised remark is the note, and does not take part in reading the quantity
  const noteMatch = raw.match(/\(([^()]*)\)/)
  const note = noteMatch ? noteMatch[1].trim() || null : null
  const text = spaced(normalizeAr(raw.replace(/\([^()]*\)/g, ' ')))
  const tokens = text.split(' ').filter(Boolean)

  let i = 0
  let quantity: number | null = null
  let unit: UnitKind | null = null

  // 1. the number: «٢», «1 1/3», «نص», «ثلاثة ارباع», «ربع»
  const readQuantity = () => {
    let total: number | null = null
    while (i < tokens.length) {
      const token = tokens[i]
      const next = tokens[i + 1]
      if ((token === 'ثلاثه' || token === 'ثلاث') && (next === 'ارباع' || next === 'اربع')) {
        total = (total ?? 0) + 0.75
        i += 2
        continue
      }
      const extra: number | null = total !== null ? andFraction(token) : null
      if (extra !== null) {
        total = (total ?? 0) + extra
        i += 1
        continue
      }
      const n = numberOf(token)
      if (n === null) break
      // two numbers in a row add up only as «1 1/3» (a whole, then a fraction)
      if (total !== null && !(Number.isInteger(total) && n < 1)) break
      total = (total ?? 0) + n
      i += 1
    }
    return total
  }
  quantity = readQuantity()

  // 2. the unit (a dual such as «كوبين» carries its own number)
  const token = tokens[i]
  if (token && token in DUAL && quantity === null) {
    quantity = DUAL[token][0]
    unit = DUAL[token][1]
    i += 1
  } else if (token) {
    const two = `${token} ${tokens[i + 1] ?? ''}`.trim()
    const kind = UNIT_OF.get(two) ?? UNIT_OF.get(token)
    const halfAfter = tokens[i + 1] ? andFraction(tokens[i + 1]) : null // «كيلو ونصف»: one and a half
    if (kind && (quantity !== null || BARE_UNITS.has(kind) || halfAfter !== null)) {
      unit = kind
      i += UNIT_OF.has(two) ? 2 : 1
    }
  }
  if (unit) {
    // «ملعقة كبيرة / صغيرة / طعام / شاي» says which spoon
    if (unit === 'spoon') {
      const size = tokens[i]
      if (size === 'كبيره' || size === 'كبيرتين' || size === 'كبيرتان' || size === 'كبار' || size === 'طعام' || size === 'اكل') {
        unit = 'tbsp'
        i += 1
      } else if (size === 'صغيره' || size === 'صغيرتين' || size === 'صغيرتان' || size === 'شاي') {
        unit = 'tsp'
        i += 1
      }
    }
    // «كوب ونص»: the "and a half" after the unit
    const more = tokens[i] ? andFraction(tokens[i]) : null
    if (more !== null) {
      quantity = (quantity ?? 1) + more
      i += 1
    }
    if (quantity === null) quantity = 1
  }

  // «ملعقة كبيرة من الزيت»: drop the «من»
  if (tokens[i] === 'من' && unit) i += 1
  const item = tokens.slice(i).join(' ')
  if (quantity === null && unit === null) {
    // «دقيق - كاستين» / «زيت: ٣ ملاعق»: the amount comes after the name
    const split = text.match(/^(.+?)\s*[-–:]\s*(.+)$/)
    if (split) {
      const after = parseIngredient(split[2])
      if (after.item === '' && (after.quantity !== null || after.unit !== null)) return { quantity: after.quantity, unit: after.unit, item: split[1].trim(), note }
    }
  }
  return { quantity: unit || quantity !== null ? quantity : null, unit, item, note }
}

// A line that reads like a sentence of the method (a long line) rather than an ingredient. The
// shopping list keeps it apart instead of making an ingredient of it.
export function looksLikeSentence(line: string): boolean {
  const { item } = parseIngredient(line)
  const words = cleanName(item).split(' ').filter(Boolean)
  return words.length > 6 || /(حطيت|ضفت|اضيف|نضيف|نخلط|اخلط|نحمس|نطبخ|نسلق|ندخل|وتدخل|خليته|اخليه|نترك|نقلب)/.test(normalizeAr(line))
}

// ---- The item's name, for matching ----

// Describing words that are not part of the ingredient's name («مقطع», «مفروم», «طازج»...).
const DESCRIPTORS = new Set([
  'مقطع', 'مقطعه', 'مقطعين', 'مقطعات', 'مكعبات', 'شرائح', 'شرايح', 'مفروم', 'مفرومه', 'مبشور', 'مبشوره', 'مهروس', 'مهروسه', 'مسلوق', 'مسلوقه',
  'مطحون', 'مطحونه', 'مجفف', 'مجففه', 'ناعم', 'ناعمه', 'خشن', 'طازج', 'طازجه', 'فريش', 'مجمد', 'مجمده', 'مقشر', 'مقشره', 'منقوع', 'مذاب',
  'متوسطه', 'الحجم', 'حجم', 'كبير', 'كبيره', 'صغير', 'صغيره', 'وسط', 'حسب', 'الرغبه', 'الحاجه', 'اختياري', 'اختياريه', 'زياده', 'شويه', 'شوية',
  'قليل', 'قليلا', 'كثير', 'تقريبا', 'بارد', 'دافي', 'دافيه', 'دافئ', 'مغلي', 'مغليه', 'نيء', 'منزوع', 'منزوعه', 'العظم', 'النوي',
  'رغبه', 'حاجه', 'عظم', 'نوي', 'مليانه', 'ممتلئه', 'ممتلئ', 'سائل', 'سايل', 'مربعات', 'مربع', 'حلقات', 'قطع', 'مقلي', 'مشوي', 'مشويه', 'مفتته', 'مكسر', 'مكسره', 'مطبوخ', 'مطبوخه', 'مغسل', 'مغسول', 'مصفي', 'للزينه', 'زينه', 'مبهر', 'مخفوق', 'فرم',
])
// Words that join or end a line, never part of a name.
const FILLER = new Set(['و', 'او', 'من', 'مع', 'ل', 'في', 'على', 'عن', 'بس', 'ثم'])

export function cleanName(item: string): string {
  // minced meat is its own thing in the shop: «مفروم» stays with «لحم»
  const protectedText = normalizeAr(item.replace(/\([^()]*\)/g, ' ')).replace(/(لحمه?|اللحم)\s+مفروم(ه|ين)?/g, 'لحم~مفروم')
  const words = protectedText
    .replace(/[،,.:؛;/\\\-_"'“”«»!؟?*•+=]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.startsWith('ال') ? w.slice(2) : w))
    .filter((w) => !DESCRIPTORS.has(w) && !FILLER.has(w) && !/^\d+$/.test(w))
  return words.join(' ').replace(/لحم~مفروم/g, 'لحم مفروم')
}
