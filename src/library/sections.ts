// The recipe sections (the notebook's sections) in the order she keeps them, for pickers that show
// the sections first. A section she adds later, that is not in the list, comes after these.

import { normalizeAr } from './normalize'

export const SECTION_ORDER = [
  'فطور',
  'فتات وسلطات',
  'أطباق جانبية و معجنات',
  'أرزاز ومكرونات (دجاج)',
  'أرزاز ومكرونات (لحم)',
  'أرزاز ومكرونات (سمك)',
  'صواني وايدامات',
  'ساندويتشات واخرى',
  'الحلا',
  'العزائم',
  'شربة',
  'Diet',
]

const rank = new Map(SECTION_ORDER.map((name, index) => [normalizeAr(name), index]))

// [section, how many recipes] in her order; sections not in the list follow, the larger first.
export function sectionsOf(recipes: Array<{ section: string }>): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const r of recipes) if (r.section) counts.set(r.section, (counts.get(r.section) ?? 0) + 1)
  const place = (name: string) => rank.get(normalizeAr(name)) ?? SECTION_ORDER.length
  return [...counts].sort((a, b) => place(a[0]) - place(b[0]) || b[1] - a[1] || a[0].localeCompare(b[0], 'ar'))
}
