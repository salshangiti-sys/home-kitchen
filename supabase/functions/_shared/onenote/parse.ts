// Reads a OneNote page's output HTML back into the recipe page model.
// Sections are found by their data-id first. If an editor dropped the data-id, the section is
// found by its heading (المصدر، المقادير، الطريقة، ملاحظاتي) instead, and the result says which
// method found each section so the sync can report pages that drifted from the template.

import { parseHTML } from 'linkedom'
import {
  SECTION_HEADINGS,
  SECTION_KEYS,
  emptySections,
  normalizeForCompare,
  type IngredientGroup,
  type RecipeSections,
  type SectionKey,
  type SourceLine,
} from './sections.ts'
import { BULLET, RECIPE_ID_LABEL, REF_DATA_ID, SECTION_DATA_ID } from './template.ts'
import { outermost } from './lineWriter.ts'

export type FoundBy = 'data-id' | 'heading' | 'missing'

export interface ParsedPage {
  title: string
  sections: RecipeSections
  foundBy: Record<SectionKey, FoundBy>
  // Generated element ids (from GET content?includeIDs=true), needed to replace a section.
  generatedIds: Partial<Record<SectionKey, string>>
  // OneNote sometimes splits one section div into several divs with the same data-id (seen when a
  // bulleted list is followed by a numbered one). The first part is in generatedIds, the rest here.
  extraIds: Partial<Record<SectionKey, string[]>>
  refId: string | null
  recipeIdMarker: string | null
}

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'text'; text: string; href: string | null; linkText: string | null }

// Minimal structural view of the DOM so this module type-checks without DOM lib differences
// between Deno and Node.
interface El {
  tagName: string
  textContent: string | null
  children: ArrayLike<El>
  parentElement: El | null
  getAttribute(name: string): string | null
  closest(selector: string): El | null
  querySelector(selector: string): El | null
  querySelectorAll(selector: string): ArrayLike<El>
}

const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6'])
const TEXT_TAGS = new Set(['P', 'LI', 'PRE'])

// Bidi controls the template wraps each line in (and marks some clients add). They only steer
// layout, so they are removed from the text that goes back into the app.
const BIDI_CONTROLS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g
const clean = (text: string | null) => (text ?? '').replace(BIDI_CONTROLS, '').trim()

// Text bullets and step numbers written by template v2; hand-typed OneNote list items have none.
const BULLET_PREFIX = new RegExp(`^${BULLET}\\s*`)
const STEP_NUMBER_PREFIX = /^[0-9\u0660-\u0669]+[.)]\s+/

function blocksOf(root: El): Block[] {
  const blocks: Block[] = []
  const visit = (el: El) => {
    const tag = el.tagName.toUpperCase()
    if (HEADING_TAGS.has(tag)) {
      blocks.push({ kind: 'heading', text: clean(el.textContent) })
      return
    }
    if (TEXT_TAGS.has(tag)) {
      const anchor = el.querySelector('a')
      blocks.push({
        kind: 'text',
        text: clean(el.textContent),
        href: anchor?.getAttribute('href') ?? null,
        linkText: anchor ? clean(anchor.textContent) : null,
      })
      return
    }
    for (const child of Array.from(el.children)) visit(child)
  }
  for (const child of Array.from(root.children)) visit(child)
  return blocks
}

const LABEL_TO_KEY = new Map<string, SectionKey>(
  SECTION_KEYS.map((key) => [normalizeForCompare(SECTION_HEADINGS[key]), key]),
)

function labelKey(block: Block): SectionKey | null {
  return LABEL_TO_KEY.get(normalizeForCompare(block.text)) ?? null
}

function nonEmpty(block: Block): boolean {
  return normalizeForCompare(block.text) !== ''
}

function toSources(blocks: Block[]): SourceLine[] {
  return blocks
    .filter((b): b is Extract<Block, { kind: 'text' }> => b.kind === 'text' && nonEmpty(b))
    .map((b) => ({ text: b.href ? b.linkText || b.text : b.text, url: b.href }))
}

const withoutBullet = (text: string) => text.replace(BULLET_PREFIX, '')
const withoutStepNumber = (text: string) => text.replace(STEP_NUMBER_PREFIX, '')

function toIngredients(blocks: Block[]): IngredientGroup[] {
  const groups: IngredientGroup[] = []
  let current: IngredientGroup = { name: null, items: [] }
  for (const block of blocks) {
    if (!nonEmpty(block)) continue
    if (block.kind === 'heading') {
      if (current.name !== null || current.items.length) groups.push(current)
      current = { name: block.text, items: [] }
    } else {
      current.items.push(withoutBullet(block.text))
    }
  }
  if (current.name !== null || current.items.length) groups.push(current)
  return groups
}

function toLines(blocks: Block[]): string[] {
  return blocks.filter((b) => b.kind === 'text' && nonEmpty(b)).map((b) => b.text)
}

function fill(sections: RecipeSections, key: SectionKey, blocks: Block[]): void {
  // Drop the section's own label (a heading, or a bold paragraph on hand-made pages);
  // anything else is content.
  const body = blocks.filter((b, i) => !(i === 0 && labelKey(b) === key))
  switch (key) {
    case 'src':
      sections.src = toSources(body)
      break
    case 'ing':
      sections.ing = toIngredients(body)
      break
    case 'steps':
      sections.steps = toLines(body).map(withoutStepNumber)
      break
    case 'notes':
      sections.notes = toLines(body).map(withoutBullet)
      break
  }
}

export function parsePageHtml(html: string): ParsedPage {
  const { document } = parseHTML(html) as unknown as { document: El & { body: El; title: string } }
  const sections = emptySections()
  const foundBy = { src: 'missing', ing: 'missing', steps: 'missing', notes: 'missing' } as Record<SectionKey, FoundBy>
  const generatedIds: ParsedPage['generatedIds'] = {}
  const extraIds: ParsedPage['extraIds'] = {}

  for (const key of SECTION_KEYS) {
    // Lines written back by the sync carry the section's data-id themselves, so a part can sit
    // inside another part; only the outermost ones are read.
    const parts = outermost(Array.from(document.querySelectorAll(`[data-id="${SECTION_DATA_ID[key]}"]`)), SECTION_DATA_ID[key])
    if (!parts.length) continue
    fill(sections, key, parts.flatMap(blocksOf))
    foundBy[key] = 'data-id'
    const ids = parts.map((part) => part.getAttribute('id')).filter((id): id is string => !!id)
    if (ids.length) generatedIds[key] = ids[0]
    if (ids.length > 1) extraIds[key] = ids.slice(1)
  }

  // Heading fallback for sections whose div is gone: split the whole page at label headings.
  const missing = SECTION_KEYS.filter((key) => foundBy[key] === 'missing')
  if (missing.length) {
    const all = blocksOf(document.body)
    let currentKey: SectionKey | null = null
    const collected = new Map<SectionKey, Block[]>()
    for (const block of all) {
      const key = labelKey(block)
      if (key) {
        currentKey = key
        if (!collected.has(key)) collected.set(key, [block])
        continue
      }
      if (currentKey && block.kind === 'text' && block.text.startsWith(RECIPE_ID_LABEL)) {
        currentKey = null
        continue
      }
      if (currentKey) collected.get(currentKey)!.push(block)
    }
    for (const key of missing) {
      const blocks = collected.get(key)
      if (!blocks) continue
      fill(sections, key, blocks)
      foundBy[key] = 'heading'
    }
  }

  const marker = clean(document.body.textContent).match(/معرّف الوصفة:\s*([a-z0-9][a-z0-9-]*)/i)

  return {
    title: clean(document.querySelector('title')?.textContent ?? ''),
    sections,
    foundBy,
    generatedIds,
    extraIds,
    refId: document.querySelector(`[data-id="${REF_DATA_ID}"]`)?.getAttribute('id') ?? null,
    recipeIdMarker: marker ? marker[1] : null,
  }
}
