// Rewrites one part of a OneNote page (a recipe section, or the recipe-id line) in place, using
// only single-element changes.
//
// Phase 0 findings (PATCH probe, 2026-10-24):
// - A section div's generated id is a range (div:{g}{first}:{g}{last}). Replacing that range, or a
//   list (UL/OL) by its id, is unsafe: part of the old content can survive, and once the range
//   spans elements written at different times it deleted every section after it (rounds 2 and 4).
// - A paragraph replaced or inserted by its own id lands in the right place but is no longer part
//   of the section's data-id, unless the new content carries that data-id itself (round 3).
// - Replacing a paragraph with an empty one removes it (round 3).
// - Inserting after a line and replacing that same line in one request, and replacing a single
//   list item with a paragraph, failed with 500 (round 3).
// - Done as below, adding, removing and changing lines left the rest of the page as it was (round 4).
// So a section is rewritten line by line: each changed heading or paragraph is replaced by its own
// id with content wrapped in the section's data-id; extra lines go into the last line's
// replacement, or are inserted after it when it is unchanged; lines no longer needed are replaced
// with an empty paragraph. A section holding anything but headings and paragraphs (OneNote lists,
// tables, images, ink) is read but never written.

import { parseHTML } from 'linkedom'
import type { PatchCommand } from './graph.ts'
import { normalizeForCompare } from './sections.ts'

export interface PageLine {
  id: string
  tag: string // H1-H6 or P
  text: string
}

export class UnsupportedContentError extends Error {
  constructor(
    readonly dataId: string,
    readonly found: string,
  ) {
    super(`"${dataId}" holds ${found}, which the app does not rewrite; edit it in OneNote`)
    this.name = 'UnsupportedContentError'
  }
}

interface El {
  tagName: string
  textContent: string | null
  children: ArrayLike<El>
  parentElement: El | null
  getAttribute(name: string): string | null
  closest(selector: string): El | null
}

const LINE_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P'])
export const BLANK_LINE = '<p></p>'

const textOf = (el: El) => normalizeForCompare(el.textContent ?? '')

// The lines of every div carrying dataId, in page order; null when the page has no such div.
export function linesOnPage(html: string, dataId: string): PageLine[] | null {
  const { document } = parseHTML(html)
  const parts = outermost(Array.from(document.querySelectorAll(`[data-id="${dataId}"]`)) as unknown as El[], dataId)
  if (!parts.length) return null
  const lines: PageLine[] = []
  const visit = (el: El) => {
    const tag = el.tagName.toUpperCase()
    if (tag === 'DIV') return Array.from(el.children).forEach(visit)
    if (tag === 'UL' || tag === 'OL') throw new UnsupportedContentError(dataId, 'a OneNote list')
    if (!LINE_TAGS.has(tag)) throw new UnsupportedContentError(dataId, `a ${tag}`)
    const id = el.getAttribute('id')
    if (!id) throw new UnsupportedContentError(dataId, `a ${tag} without an id`)
    lines.push({ id, tag, text: textOf(el) })
  }
  for (const part of parts) Array.from(part.children).forEach(visit)
  return lines
}

// Divs carrying dataId that are not inside another div carrying it.
export function outermost<T extends { parentElement: T | null; closest(selector: string): T | null }>(parts: T[], dataId: string): T[] {
  return parts.filter((part) => !part.parentElement?.closest(`[data-id="${dataId}"]`))
}

const wrap = (dataId: string, html: string) => `<div data-id="${dataId}">${html}</div>`

function wantedLine(html: string): { tag: string; text: string } {
  const { document } = parseHTML(`<html><body>${html}</body></html>`)
  const el = (document.body as unknown as El).children[0]
  return { tag: el.tagName.toUpperCase(), text: textOf(el) }
}

const isHeading = (tag: string) => tag.startsWith('H')

function sameLine(line: PageLine, wanted: { tag: string; text: string }): boolean {
  const kindMatches = isHeading(line.tag) || isHeading(wanted.tag) ? line.tag === wanted.tag : true
  return kindMatches && line.text === wanted.text
}

// Commands that turn the lines of the div carrying dataId into `wanted` (one HTML string per line).
// Lines with the same text are left alone, keeping any formatting added in OneNote, unless `force`
// is set (a template upgrade, where the formatting itself must change).
export function planLineWrite(dataId: string, lines: PageLine[], wanted: string[], force = false): PatchCommand[] {
  // An emptied div has no line to anchor to; appending to it by data-id is supported.
  if (!lines.length) return wanted.length ? [{ target: `#${dataId}`, action: 'append', content: wanted.join('') }] : []
  const commands: PatchCommand[] = []
  const shared = Math.min(lines.length, wanted.length)
  const changed = (i: number) => force || !sameLine(lines[i], wantedLine(wanted[i]))
  const extra = wanted.slice(lines.length).join('')
  const last = lines.length - 1
  // Extra lines follow the last line: inside its replacement when it changes too (an insert after a
  // line replaced in the same request failed), otherwise inserted after it.
  if (extra && !changed(last)) commands.push({ target: lines[last].id, action: 'insert', position: 'after', content: wrap(dataId, extra) })
  for (let i = 0; i < shared; i++) {
    if (!changed(i)) continue
    const content = i === last ? wanted[i] + extra : wanted[i]
    commands.push({ target: lines[i].id, action: 'replace', content: wrap(dataId, content) })
  }
  for (const line of lines.slice(wanted.length)) commands.push({ target: line.id, action: 'replace', content: BLANK_LINE })
  return commands
}
