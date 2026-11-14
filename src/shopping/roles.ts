// The order an ingredient list is shown in on the recipe page: the main starch first (rice), then the
// protein (chicken), then the spices (salt, paprika, cumin), then the vegetables (potato, onion, peppers),
// then the dairy (cream), and everything else last (oil, sauces, sugar, lines that are not ingredients).
// Only the SHOWING order changes: the recipe text, OneNote and the stored lines are never touched, and
// inside each kind the lines keep the order they were written in.
//
// The kind of a line comes from the ingredient dictionary (the same one the shopping list uses), so an
// ingredient the dictionary does not know falls back to the shop aisle it is guessed to be in.

import { normalizeAr } from '../library/normalize'
import { identifyAll } from './catalog'
import type { Aisle } from './dictionary'

export type Role = 'carb' | 'protein' | 'spice' | 'vegetable' | 'dairy' | 'other'

export const ROLE_ORDER: Role[] = ['carb', 'protein', 'spice', 'vegetable', 'dairy', 'other']

// Known items that are a starch although the shop keeps them in the pantry, and the egg, which is a
// protein although it is sold with the dairy.
const CARBS = new Set(['رز', 'مكرونة', 'دقيق', 'شوفان', 'حمص', 'فاصوليا'])
const PROTEINS = new Set(['بيض'])

const BY_AISLE: Record<Aisle, Role> = { meat: 'protein', produce: 'vegetable', dairy: 'dairy', spices: 'spice', bakery: 'carb', pantry: 'other', other: 'other', none: 'other' }

// For a line the dictionary does not know: the words that still tell its kind («أرز منقوع مزة بسمتي»).
const WORD_ROLES: Array<[Role, RegExp]> = [
  ['carb', /(^|\s)(ا?رز|مكرونه|معكرونه|باستا|سباغيتي|دقيق|طحين|شوفان|خبز|توست|عيش)(\s|$)/],
  ['protein', /(^|\s)(دجاج\S*|لحم\S*|سمك|روبيان|قمبري|تونه|تونا|بيض\S*|كفته|ستيك|فيليه)(\s|$)/],
]

export function roleOf(line: string): Role {
  const found = identifyAll(line)[0]
  if (found.sentence || !found.key) return 'other'
  if (found.known && CARBS.has(found.key)) return 'carb'
  if (found.known && PROTEINS.has(found.key)) return 'protein'
  const byAisle = BY_AISLE[found.aisle]
  if (found.known || byAisle !== 'other') return byAisle
  const text = normalizeAr(line)
  return WORD_ROLES.find(([, pattern]) => pattern.test(text))?.[0] ?? 'other'
}

// The items in the order above (a stable sort: equal kinds keep their written order).
export function orderByRole<T>(items: T[], text: (item: T) => string): T[] {
  return items
    .map((item, index) => ({ item, index, rank: ROLE_ORDER.indexOf(roleOf(text(item))) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((x) => x.item)
}
