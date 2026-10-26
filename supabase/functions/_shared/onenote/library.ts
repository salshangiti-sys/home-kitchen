// The recipe notebook (وصفاتي) is read, never edited: recipe text is written in OneNote, and the app
// takes it from the page. The app adds its own fields (tags, meal types, favorites, planning),
// which never go to OneNote. New pages can be created from the app, once, with the template.
//
// This module turns a page into a recipe document (recipe.schema.json shape). It never fills in
// structured values (quantity, unit, item): a line whose text is unchanged keeps the values it had,
// any other line has none.

import { parseHTML } from 'linkedom'
import { parsePageHtml } from './parse.ts'
import { platformOf, type IngredientGroup, type IngredientItem, type RecipeDoc, type RecipeStatus } from './recipeDoc.ts'
import { SECTION_KEYS, type RecipeSections, type SectionKey } from './sections.ts'
import { RECIPE_ID_LABEL, REF_DATA_ID } from './template.ts'

interface El {
  tagName: string
  textContent: string | null
  children: ArrayLike<El>
  getAttribute(name: string): string | null
}

const BIDI_CONTROLS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g
const clean = (text: string | null) => (text ?? '').replace(BIDI_CONTROLS, '').replace(/\u00A0/g, ' ').trim()
const LINE_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'PRE', 'TD'])

// The page's visible text, one line per paragraph, heading or list item, in page order. Real
// OneNote list items get "• " or "1. " so the text reads like the page. Direction marks are dropped,
// and so is the app's small reference line (recipe id and link), which is not the author's text.
export function pageText(html: string): string {
  const { document } = parseHTML(html)
  const lines: string[] = []
  const visit = (el: El, list?: { ordered: boolean; n: number }) => {
    const tag = el.tagName.toUpperCase()
    if (el.getAttribute('data-id') === REF_DATA_ID) return
    if (tag === 'UL' || tag === 'OL') {
      const state = { ordered: tag === 'OL', n: 0 }
      for (const child of Array.from(el.children)) visit(child, state)
      return
    }
    if (tag === 'LI') {
      list!.n += 1
      const text = clean(el.textContent)
      if (text) lines.push(`${list!.ordered ? `${list!.n}.` : '•'} ${text}`)
      return
    }
    if (LINE_TAGS.has(tag)) {
      const text = clean(el.textContent)
      if (text && !text.startsWith(RECIPE_ID_LABEL)) lines.push(text)
      return
    }
    for (const child of Array.from(el.children)) visit(child, list)
  }
  for (const child of Array.from((document.body as unknown as El).children)) visit(child)
  return lines.join('\n')
}

// Ingredient groups from the page, keeping the structured values of lines whose text is unchanged.
function keepStructure(groups: RecipeSections['ing'], before: IngredientGroup[]): IngredientGroup[] {
  const unused = before.flatMap((group) => group.items)
  const keep = (text: string): IngredientItem => {
    const index = unused.findIndex((item) => item.text === text)
    return index < 0 ? { text } : unused.splice(index, 1)[0]
  }
  return groups.map((group) => ({ name: group.name, items: group.items.map(keep) }))
}

function sourcesFrom(lines: RecipeSections['src'], before: RecipeDoc['sources']): RecipeDoc['sources'] {
  return lines
    .map((line) => ({ url: line.url ?? (/^https?:\/\//i.test(line.text) ? line.text : null), text: line.text }))
    .filter((line): line is { url: string; text: string } => !!line.url)
    .map(({ url, text }) => {
      const previous = before.find((s) => s.url === url)
      const label = text && text !== url ? text : null
      return { url, platform: previous?.platform ?? platformOf(url), ...(label ? { label } : {}) }
    })
}

export interface PageRead {
  doc: RecipeDoc
  // Template sections the page had (by marker or by heading); only these replace the app's copy.
  found: SectionKey[]
}

// The recipe as the page now says. Sections the page does not have keep the app's copy (a page
// without the template headings still updates its title and full text, nothing else).
export function readPage(current: RecipeDoc, page: { title: string; html: string }): PageRead {
  const parsed = parsePageHtml(page.html)
  const found = SECTION_KEYS.filter((key) => parsed.foundBy[key] !== 'missing')
  const doc: RecipeDoc = structuredClone(current)
  doc.title = page.title.trim() || parsed.title || current.title
  if (found.includes('src')) doc.sources = sourcesFrom(parsed.sections.src, current.sources)
  if (found.includes('ing')) doc.ingredient_groups = keepStructure(parsed.sections.ing, current.ingredient_groups)
  if (found.includes('steps')) doc.steps = parsed.sections.steps.map((text, i) => ({ order: i + 1, text }))
  if (found.includes('notes')) doc.notes = parsed.sections.notes
  // A page saved as a link or a note that now has ingredients or steps (e.g. a blank page from
  // the app, filled in OneNote) becomes a full recipe. A kind the owner chose is never lowered.
  if (found.length && (doc.status === 'link_only' || doc.status === 'note_only') && statusOf(doc) === 'complete') doc.status = 'complete'
  doc.raw_text = pageText(page.html)
  return { doc, found }
}

// What kind of page it is, for a page found in OneNote that the app does not know yet.
export function statusOf(doc: Pick<RecipeDoc, 'ingredient_groups' | 'steps' | 'sources'>): RecipeStatus {
  if (doc.ingredient_groups.some((g) => g.items.length) || doc.steps.length) return 'complete'
  if (doc.sources.length) return 'link_only'
  return 'note_only'
}

// A recipe for a page found in OneNote that the app does not know yet. The new id comes from the
// server; the flag puts it on the review list.
export function recipeFromPage(page: { id: string; title: string; html: string; created?: string | null }, place: { notebook: string; section: string }): RecipeDoc {
  const empty: RecipeDoc = {
    id: '',
    title: page.title,
    language: 'ar',
    status: 'note_only',
    category: { notebook: place.notebook, section: place.section },
    sources: [],
    ingredient_groups: [],
    steps: [],
    notes: [],
    tags: { meal_types: [], kid_friendly: null, lunchbox: null, custom: [] },
    media: [],
    onenote: { notebook: place.notebook, section: place.section, page_id: page.id, created: page.created ?? null },
    flags: ['added_from_onenote'],
    raw_text: '',
  }
  const { doc } = readPage(empty, page)
  return { ...doc, status: statusOf(doc) }
}

// The app's sections for a page it creates: the same text, in the page model.
export function sectionsOf(doc: RecipeDoc): RecipeSections {
  return {
    src: doc.sources.map((s) => ({ text: s.label ?? '', url: s.url })),
    ing: doc.ingredient_groups.map((g) => ({ name: g.name, items: g.items.map((i) => i.text) })),
    steps: [...doc.steps].sort((a, b) => a.order - b.order).map((s) => s.text),
    notes: doc.notes,
  }
}
