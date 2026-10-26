// Builds the input HTML for a recipe page (create) and for one section (update).
// Each section is a div with a data-id, so later updates can find and replace just that section.
//
// Right-to-left layout (Phase 0 finding): OneNote's API drops dir="rtl" and direction:rtl, so a
// page written through it gets left-to-right paragraphs. Template v2 therefore wraps every line in
// a Unicode right-to-left embedding (RLE … PDF) and writes bullets and step numbers as text inside
// it, which OneNote then shows right-aligned with the marker on the right. Real OneNote lists are
// not used because their bullets stay on the left. parse.ts strips the controls and markers again.

import { SECTION_HEADINGS, type IngredientGroup, type RecipeSections, type SectionKey, type SourceLine } from './sections.ts'

export const TEMPLATE_VERSION = 2
export const SECTION_DATA_ID: Record<SectionKey, string> = {
  src: 'hk-src',
  ing: 'hk-ing',
  steps: 'hk-steps',
  notes: 'hk-notes',
}
export const REF_DATA_ID = 'hk-ref'
export const RECIPE_ID_LABEL = 'معرّف الوصفة:'
export const BULLET = '•'

const RLE = '\u202B'
const PDF = '\u202C'
const RIGHT = 'text-align:right'

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// One right-to-left line. `inner` is already HTML (escaped text, or a link).
function rtl(tag: string, inner: string, style = RIGHT): string {
  return `<${tag} style="${style}">${RLE}${inner}${PDF}</${tag}>`
}

function sourceLine(line: SourceLine): string {
  if (!line.url) return rtl('p', escapeHtml(line.text))
  const label = line.text.trim() || line.url
  return rtl('p', `<a href="${escapeHtml(line.url)}">${escapeHtml(label)}</a>`)
}

function ingredientGroup(group: IngredientGroup): string[] {
  const name = group.name === null ? [] : [rtl('h3', escapeHtml(group.name))]
  return [...name, ...group.items.map((item) => rtl('p', `${BULLET} ${escapeHtml(item)}`))]
}

function sectionBody(key: SectionKey, sections: RecipeSections): string[] {
  switch (key) {
    case 'src':
      return sections.src.map(sourceLine)
    case 'ing':
      return sections.ing.flatMap(ingredientGroup)
    case 'steps':
      return sections.steps.map((step, i) => rtl('p', `${i + 1}. ${escapeHtml(step)}`))
    case 'notes':
      return sections.notes.map((note) => rtl('p', `${BULLET} ${escapeHtml(note)}`))
  }
}

// The section as OneNote paragraphs, heading first: one HTML string per line.
export function sectionLines(key: SectionKey, sections: RecipeSections): string[] {
  return [rtl('h2', escapeHtml(SECTION_HEADINGS[key])), ...sectionBody(key, sections)]
}

export function buildSectionHtml(key: SectionKey, sections: RecipeSections): string {
  return `<div data-id="${SECTION_DATA_ID[key]}">${sectionLines(key, sections).join('')}</div>`
}

export function refLine(recipeId: string, appUrl: string | null): string {
  const link = appUrl ? ` · <a href="${escapeHtml(appUrl)}">افتح في التطبيق</a>` : ''
  return rtl('p', `${RECIPE_ID_LABEL} ${escapeHtml(recipeId)}${link}`, `${RIGHT};font-size:8pt;color:#8a8a8a`)
}

export function buildRefHtml(recipeId: string, appUrl: string | null): string {
  return `<div data-id="${REF_DATA_ID}">${refLine(recipeId, appUrl)}</div>`
}

export interface PageInput {
  recipeId: string
  title: string
  sections: RecipeSections
  appUrl: string | null
  // Give every empty section an empty line under its heading, ready to type in (a new page made
  // from the app to be filled in OneNote).
  blankLines?: boolean
}

// An empty right-to-left line: the no-break space keeps OneNote from dropping it.
const BLANK_LINE = rtl('p', '\u00a0')

export function buildPageHtml(input: PageInput): string {
  const sections = (['src', 'ing', 'steps', 'notes'] as const)
    .map((key) => {
      const html = buildSectionHtml(key, input.sections)
      return input.blankLines && sectionLines(key, input.sections).length === 1 ? html.replace(/<\/div>$/, `${BLANK_LINE}</div>`) : html
    })
    .join('')
  return (
    '<!DOCTYPE html>' +
    '<html lang="ar">' +
    `<head><title>${escapeHtml(input.title)}</title></head>` +
    `<body>${sections}${buildRefHtml(input.recipeId, input.appUrl)}</body>` +
    '</html>'
  )
}
