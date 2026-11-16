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
  'مفرزنات',
  'شربة',
]

const rank = new Map(SECTION_ORDER.map((name, index) => [normalizeAr(name), index]))

// A section inside a section group in OneNote is named «المجموعة › القسم» (e.g. «مفرزنات › كفتة»).
// The big section is what comes before the arrow, and the sub-section what comes after.
export const SECTION_SEPARATOR = ' › '
export const topOf = (section: string): string => section.split(SECTION_SEPARATOR)[0]
export const subOf = (section: string): string | null => (section.includes(SECTION_SEPARATOR) ? section.slice(section.indexOf(SECTION_SEPARATOR) + SECTION_SEPARATOR.length) : null)
// Is the recipe in the section chosen (the big one, or one of its sub-sections)?
export const inSection = (recipeSection: string, chosen: string): boolean => recipeSection === chosen || topOf(recipeSection) === chosen

// The sub-sections of a big section with their recipe counts, in alphabetical order.
export function subsectionsOf(recipes: Array<{ section: string }>, top: string): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const r of recipes) {
    const sub = topOf(r.section) === top ? subOf(r.section) : null
    if (sub) counts.set(sub, (counts.get(sub) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => a[0].localeCompare(b[0], 'ar'))
}

// [big section, how many recipes] in her order, the sub-sections counted in their big section; sections not in the list follow, the larger first.
export function sectionsOf(recipes: Array<{ section: string }>): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const r of recipes) if (r.section) counts.set(topOf(r.section), (counts.get(topOf(r.section)) ?? 0) + 1)
  const place = (name: string) => rank.get(normalizeAr(name)) ?? SECTION_ORDER.length
  return [...counts].sort((a, b) => place(a[0]) - place(b[0]) || b[1] - a[1] || a[0].localeCompare(b[0], 'ar'))
}
