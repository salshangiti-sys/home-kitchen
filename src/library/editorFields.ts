// The recipe editor works on plain text fields (one line per source, ingredient, step or note);
// these functions turn a recipe into those fields and back.
//
// Lines are kept exactly as typed. Structured values (quantity, unit, item, note) are never
// worked out from the text: a line whose text did not change keeps the values it had, and a new
// or changed line has none.

import { MEAL_TYPES, platformOf, type IngredientGroup, type IngredientItem, type MealType, type RecipeDoc, type RecipeStatus } from './types'

export { platformOf }

export type TriState = 'unknown' | 'yes' | 'no'

export interface EditorFields {
  title: string
  section: string
  sectionEn: string
  status: RecipeStatus
  sources: string // "label | url" or a bare url, one per line
  ingredients: string // one per line; "## name" starts a named group
  steps: string // one per line
  notes: string // one per line
  servings: string
  prepTime: string
  cookTime: string
  mealTypes: MealType[]
  kidFriendly: TriState
  lunchbox: TriState
  customTags: string // comma separated
}

export const GROUP_PREFIX = '## '

const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

const fromTri = (value: TriState) => (value === 'unknown' ? null : value === 'yes')
const toTri = (value: boolean | null | undefined): TriState => (value == null ? 'unknown' : value ? 'yes' : 'no')

export function emptyFields(): EditorFields {
  return {
    title: '',
    section: '',
    sectionEn: '',
    status: 'complete',
    sources: '',
    ingredients: '',
    steps: '',
    notes: '',
    servings: '',
    prepTime: '',
    cookTime: '',
    mealTypes: [],
    kidFriendly: 'unknown',
    lunchbox: 'unknown',
    customTags: '',
  }
}

export function docToFields(doc: RecipeDoc): EditorFields {
  const ingredientLines = doc.ingredient_groups.flatMap((group) => [
    ...(group.name === null ? [] : [`${GROUP_PREFIX}${group.name}`]),
    ...group.items.map((item) => item.text),
  ])
  return {
    title: doc.title,
    section: doc.category.section,
    sectionEn: doc.category.section_en ?? '',
    status: doc.status,
    sources: doc.sources.map((s) => (s.label ? `${s.label} | ${s.url}` : s.url)).join('\n'),
    ingredients: ingredientLines.join('\n'),
    steps: [...doc.steps].sort((a, b) => a.order - b.order).map((s) => s.text).join('\n'),
    notes: doc.notes.join('\n'),
    servings: doc.servings?.toString() ?? '',
    prepTime: doc.prep_time_min?.toString() ?? '',
    cookTime: doc.cook_time_min?.toString() ?? '',
    mealTypes: doc.tags?.meal_types ?? [],
    kidFriendly: toTri(doc.tags?.kid_friendly),
    lunchbox: toTri(doc.tags?.lunchbox),
    customTags: (doc.tags?.custom ?? []).join('، '),
  }
}

function parseSources(text: string, before: RecipeDoc['sources']): RecipeDoc['sources'] {
  return lines(text).map((line) => {
    const bar = line.lastIndexOf('|')
    const url = (bar >= 0 ? line.slice(bar + 1) : line).trim()
    const label = bar >= 0 ? line.slice(0, bar).trim() || null : null
    const previous = before.find((s) => s.url === url)
    return { url, platform: previous?.platform ?? platformOf(url), ...(label ? { label } : {}) }
  })
}

function parseIngredients(text: string, before: IngredientGroup[]): IngredientGroup[] {
  // Structured values of unchanged lines, matched by text; each old line is used once.
  const unused = before.flatMap((group) => group.items)
  const keep = (lineText: string): IngredientItem => {
    const index = unused.findIndex((item) => item.text === lineText)
    if (index < 0) return { text: lineText }
    const [item] = unused.splice(index, 1)
    return item
  }

  const groups: IngredientGroup[] = []
  let current: IngredientGroup = { name: null, items: [] }
  for (const line of lines(text)) {
    if (line.startsWith(GROUP_PREFIX.trim())) {
      if (current.name !== null || current.items.length) groups.push(current)
      current = { name: line.slice(GROUP_PREFIX.trim().length).trim(), items: [] }
    } else {
      current.items.push(keep(line))
    }
  }
  if (current.name !== null || current.items.length) groups.push(current)
  return groups
}

function parseNumber(text: string): number | null {
  const western = text.trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  if (!western) return null
  const value = Number(western)
  return Number.isFinite(value) ? value : null
}

// The page text for a recipe written in the app, in the template order, used as its raw_text.
export function composeRawText(doc: Pick<RecipeDoc, 'title' | 'sources' | 'ingredient_groups' | 'steps' | 'notes'>): string {
  const parts = [doc.title]
  if (doc.sources.length) parts.push('المصدر', ...doc.sources.map((s) => (s.label ? `${s.label}: ${s.url}` : s.url)))
  if (doc.ingredient_groups.length) {
    parts.push('المقادير')
    for (const group of doc.ingredient_groups) {
      if (group.name !== null) parts.push(group.name)
      parts.push(...group.items.map((item) => `• ${item.text}`))
    }
  }
  if (doc.steps.length) parts.push('الطريقة', ...doc.steps.map((s) => `${s.order}. ${s.text}`))
  if (doc.notes.length) parts.push('ملاحظاتي', ...doc.notes.map((n) => `• ${n}`))
  return parts.join('\n')
}

// The section fields come from the form; anything else in the category (notebook, section group)
// stays as it was.
function categoryOf(fields: EditorFields, before: RecipeDoc | null): RecipeDoc['category'] {
  const { section_en: previousEn, ...rest } = before?.category ?? { section: '' }
  const sectionEn = fields.sectionEn.trim()
  return {
    ...rest,
    section: fields.section.trim(),
    ...(sectionEn ? { section_en: sectionEn } : previousEn === null ? { section_en: null } : {}),
  }
}

// Imported recipes carry where they came from in OneNote; recipes written in the app do not.
export const isFromOneNote = (doc: RecipeDoc) => Object.keys(doc.onenote).length > 0

// The edited recipe. `before` is the stored recipe (null for a new one): its id, OneNote origin,
// media placeholders, flags and original page text carry over unchanged.
export function fieldsToDoc(fields: EditorFields, before: RecipeDoc | null): RecipeDoc {
  const sources = parseSources(fields.sources, before?.sources ?? [])
  const ingredient_groups = parseIngredients(fields.ingredients, before?.ingredient_groups ?? [])
  const steps = lines(fields.steps).map((text, i) => ({ order: i + 1, text }))
  const notes = lines(fields.notes)
  const title = fields.title.trim()
  const custom = fields.customTags
    .split(/[,،]/)
    .map((tag) => tag.trim())
    .filter(Boolean)

  return {
    id: before?.id ?? '',
    title,
    language: before?.language ?? 'ar',
    status: fields.status,
    category: categoryOf(fields, before),
    sources,
    ingredient_groups,
    steps,
    notes,
    tags: {
      meal_types: MEAL_TYPES.filter((type) => fields.mealTypes.includes(type)),
      kid_friendly: fromTri(fields.kidFriendly),
      lunchbox: fromTri(fields.lunchbox),
      custom,
    },
    servings: parseNumber(fields.servings),
    prep_time_min: parseNumber(fields.prepTime),
    cook_time_min: parseNumber(fields.cookTime),
    media: before?.media ?? [],
    onenote: before?.onenote ?? {},
    flags: before?.flags ?? [],
    // An imported recipe keeps the page text it came with (the source of truth for what the
    // OneNote page said); a recipe written in the app gets its text from its own fields.
    raw_text: before && isFromOneNote(before) ? before.raw_text : composeRawText({ title, sources, ingredient_groups, steps, notes }),
  }
}

// For a recipe whose text lives in a OneNote page: only the app's own fields (tags, servings,
// times) come from the form; everything read from the page stays exactly as it is.
export function planningToDoc(fields: EditorFields, before: RecipeDoc): RecipeDoc {
  const edited = fieldsToDoc(fields, before)
  return {
    ...before,
    tags: edited.tags,
    servings: edited.servings,
    prep_time_min: edited.prep_time_min,
    cook_time_min: edited.cook_time_min,
  }
}
