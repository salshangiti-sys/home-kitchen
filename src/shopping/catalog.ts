// Finding which shopping item an ingredient line is: the dictionary's name when the line's name is a
// known one, otherwise the line's own cleaned name. The shopping list groups lines by this.

import { normalizeAr } from '../library/normalize'
import { AISLE_ORDER, DICTIONARY, type Aisle } from './dictionary'
import { cleanName, looksLikeSentence, parseIngredient, type ParsedLine } from './ingredient'

export interface Identified {
  key: string // what lines are grouped by (the dictionary name, or the cleaned name)
  label: string // what the list shows
  aisle: Aisle
  known: boolean // the dictionary knew it
  parsed: ParsedLine
  sentence: boolean // reads like a method sentence, not an ingredient
}

const stripGlue = (name: string) => name.replace(/\s+/g, ' ').trim()

// What she taught the dictionary (see lessons.ts): a cleaned name is either "the same as" a name the
// dictionary knows, or an item of its own in a chosen aisle. They win over the dictionary.
export interface Lesson {
  name_key: string
  target: string | null
  aisle: Exclude<Aisle, 'none'>
}
let LESSONS = new Map<string, Lesson>()
export const setLessons = (lessons: Lesson[]) => void (LESSONS = new Map(lessons.map((l) => [l.name_key, l])))

// alias (cleaned the way line names are) -> entry
const ALIASES = new Map<string, { name: string; aisle: Aisle }>()
for (const [name, aisle, aliases] of DICTIONARY) {
  for (const alias of [name, ...aliases]) {
    const key = stripGlue(cleanName(alias))
    if (key && !ALIASES.has(key)) ALIASES.set(key, { name, aisle })
  }
}

// Words that begin many different things in the shop: a name that merely starts with one is not that thing.
const GENERIC_HEADS = new Set(['فلفل', 'جبن', 'جبنه', 'لحم', 'دجاج', 'زيت', 'خبز', 'بهارات', 'حليب', 'كريمه', 'صلصه', 'صوص', 'ملح'])

// «بصله» and «بصل», «كوسه» and «كوس»: the singular feminine ending is not part of the name.
const variants = (name: string) => (name.endsWith('ه') && name.length > 3 ? [name, name.slice(0, -1)] : [name])

function lookup(name: string): { name: string; aisle: Aisle } | null {
  for (const v of variants(name)) {
    const hit = ALIASES.get(v)
    if (hit) return hit
  }
  // the name starts with a known name («ثوم فص ثوم», «فلفل اسود رشه»): the longest known start wins.
  // Not for the words that begin many different things («فلفل هالبينو» is not «فلفل أسود»).
  const words = name.split(' ')
  for (let n = words.length - 1; n >= 1; n--) {
    const start = words.slice(0, n).join(' ')
    if (n === 1 && GENERIC_HEADS.has(start)) continue
    for (const v of variants(start)) {
      const hit = ALIASES.get(v)
      if (hit) return hit
    }
  }
  return null
}

const GUESS: Array<[RegExp, Aisle]> = [
  [/جبن|حليب|كريمه|زبد|قشطه|لبن/, 'dairy'],
  [/لحم|دجاج|صدور|سمك|روبيان|تونه|كفته/, 'meat'],
  [/فلفل|بصل|ثوم|خيار|طماطم|جزر|خس|ورق/, 'produce'],
  [/بهار|ملح|مسحوق|بودره/, 'spices'],
  [/خبز|عجين|عيش/, 'bakery'],
]

// Not an ingredient at all: a link, a hashtag, a lone dot or a divider.
const NOT_INGREDIENT = /https?:|tiktok\.com|instagram\.com|^\s*#|^[^\p{L}]*$/u

export function identify(line: string): Identified {
  const parsed = parseIngredient(line)
  const name = stripGlue(cleanName(parsed.item))
  const sentence = NOT_INGREDIENT.test(line) || looksLikeSentence(line)
  const lesson = name ? LESSONS.get(name) : undefined
  if (lesson) {
    const target = lesson.target ? stripGlue(cleanName(lesson.target)) : ''
    const same = target ? ALIASES.get(target) : undefined
    if (same) return { key: same.name, label: same.name, aisle: same.aisle, known: true, parsed, sentence }
    // an item of its own (or "the same as" a name that is not in the dictionary: then that name is the item)
    return { key: target || name, label: lesson.target ?? (stripGlue(parsed.item.replace(/\([^()]*\)/g, ' ')) || line.trim()), aisle: lesson.aisle, known: true, parsed, sentence }
  }
  const hit = name ? lookup(name) : null
  if (hit) return { key: hit.name, label: hit.name, aisle: hit.aisle, known: true, parsed, sentence }
  const aisle = GUESS.find(([pattern]) => pattern.test(name))?.[1] ?? 'other'
  // the name as the person wrote it (without the quantity), not the stripped spelling
  const shown = stripGlue(parsed.item.replace(/\([^()]*\)/g, ' ')) || line.trim()
  return { key: name || normalizeAr(line), label: shown, aisle, known: false, parsed, sentence }
}

export const aisleRank = (aisle: Aisle) => (aisle === 'none' ? 99 : AISLE_ORDER.indexOf(aisle))

// ---- lines that list several ingredients ----

const SEPARATORS = /[،,+]/
const wordCount = (text: string) => stripGlue(cleanName(parseIngredient(text).item)).split(' ').filter(Boolean).length

// «ملح، كزبرة ناشفة، فلفل اسود»  ·  «بهارات (ملح، كمون، بهار مشكل)»  ·  «خضار: جزر، كوسة، بطاطس»  ·
// «١/٢ ملعقة صغيرة لكل من كركم، هيل»: the pieces of a line that lists ingredients, and the quantity
// that goes with every piece («لكل من»). Null when the line is not such a list.
function listPieces(line: string): { pieces: string[]; shared: ParsedLine | null } | null {
  const text = line.trim()
  if (NOT_INGREDIENT.test(text)) return null
  const each = text.match(/^(.*?)\s*(?:لكل من|كل من)\s+(.+)$/)
  if (each && SEPARATORS.test(each[2])) return { pieces: each[2].split(SEPARATORS), shared: parseIngredient(each[1]) }
  const bracket = text.match(/^([^()]{0,25})\(([^()]*[،,][^()]*)\)\s*$/)
  if (bracket && wordCount(bracket[1]) <= 2) return { pieces: bracket[2].split(SEPARATORS), shared: null }
  const labelled = text.match(/^([^:()]{1,25}):\s*(.+)$/)
  if (labelled && SEPARATORS.test(labelled[2]) && wordCount(labelled[1]) <= 3) return { pieces: labelled[2].split(SEPARATORS), shared: null }
  if (SEPARATORS.test(text.replace(/\([^()]*\)/g, ' '))) return { pieces: text.replace(/\([^()]*\)/g, ' ').split(SEPARATORS), shared: null }
  return null
}

// One identified item per ingredient on the line (several for a list, otherwise one).
export function identifyAll(line: string): Identified[] {
  const list = listPieces(line)
  if (list) {
    const pieces = list.pieces.map((p) => p.trim()).filter(Boolean)
    const items = pieces.map((piece) => identify(piece))
    // every piece must be short and an ingredient, or the line is a sentence with commas in it
    if (pieces.length >= 2 && items.every((i) => !i.sentence && i.key && wordCount(i.parsed.item) <= 5)) {
      return items.map((i) => (list.shared && i.parsed.quantity === null ? { ...i, parsed: { ...i.parsed, quantity: list.shared.quantity, unit: list.shared.unit } } : i))
    }
  }
  return [identify(line)]
}
