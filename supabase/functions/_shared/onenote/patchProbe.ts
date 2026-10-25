// Phase 0 experiment: how can one recipe section be rewritten on a OneNote page without touching
// anything else? Each round writes a throwaway page in the test notebook and keeps OneNote's answer
// to every request plus the page after it.
//
// Round 1 (2026-10-24):
// - Replacing a section div by its compound generated id (div:{g}{first}:{g}{last}) is accepted.
//   Headings and paragraphs are replaced cleanly, but with heading + list, the first list survives.
// - Replacing a div by #data-id is refused (20141), and replace with empty content is refused (20121).
// - Replacing the heading by its id with a whole section, inserting, and appending are accepted but
//   leave the old lines in place.
// Round 2 (2026-10-24): turning the lists into paragraphs and then replacing the section div by its
// range deleted every section after it on the page. Replacing ranges is unsafe.
// Round 3 (2026-10-24): line by line. Replacing a line by its id with an empty paragraph removed
// it cleanly. Replaced and inserted lines landed in place but outside the section's data-id.
// Inserting after a line and replacing it in one request, and replacing a list item with a
// paragraph, failed with 500.
// Round 4 (2026-10-24): with new lines carrying the section's data-id and extra lines riding in the
// last line's replacement, adding, removing and changing paragraph lines left the page clean
// three times. Replacing a list by its id deleted every section after it.
// Round 5 (this probe): the writer as the sync uses it (paragraph sections only), editing the same
// sections repeatedly; a section with OneNote lists must be refused and left as it is. The whole
// page is read back after every trial.

import { GraphError, type PageMeta, type PatchCommand } from './graph.ts'
import { UnsupportedContentError, linesOnPage, planLineWrite } from './lineWriter.ts'
import { parsePageHtml } from './parse.ts'
import { SECTION_KEYS, sameValue, valueOf, type PageState, type RecipeSections, type SectionKey } from './sections.ts'
import { REF_DATA_ID, SECTION_DATA_ID, refLine, sectionLines } from './template.ts'

export const PATCH_PROBE_TITLE = 'اختبار التعديل 5 (سطرًا بسطر)'
const PROBE_ID = 'probe-lines'

const START: RecipeSections = {
  src: [{ text: 'مصدر قديم 1', url: null }, { text: 'مصدر قديم 2', url: null }],
  ing: [{ name: null, items: ['2 كوب رز', 'صدر دجاج'] }, { name: 'البهارات', items: ['هيل'] }],
  steps: ['نحمر البصل', 'نضيف الدجاج'],
  notes: ['ملاحظة قديمة 1', 'ملاحظة قديمة 2'],
}

const div = (key: SectionKey, inner: string) => `<div data-id="${SECTION_DATA_ID[key]}">${inner}</div>`

// src, steps and notes in template v2 (paragraphs); ing with real OneNote lists, like a v1 page or
// a section someone reformatted in OneNote.
export function buildPatchProbePage(): string {
  const ing = '<h2>المقادير</h2><ul><li>2 كوب رز</li><li>صدر دجاج</li></ul><h3>البهارات</h3><ul><li>هيل</li></ul>'
  return (
    `<!DOCTYPE html><html lang="ar"><head><title>${PATCH_PROBE_TITLE}</title></head><body>` +
    div('src', sectionLines('src', START).join('')) +
    div('ing', ing) +
    div('steps', sectionLines('steps', START).join('')) +
    div('notes', sectionLines('notes', START).join('')) +
    `<div data-id="${REF_DATA_ID}">${refLine(PROBE_ID, null)}</div>` +
    '</body></html>'
  )
}

interface Trial {
  name: string
  // The new value of the section written in this trial.
  write: Partial<RecipeSections>
}

export const PATCH_TRIALS: Trial[] = [
  { name: 'steps: change line 1, add line 3', write: { steps: ['نحمر البصل جيدًا', 'نضيف الدجاج', 'نضيف الرز'] } },
  { name: 'notes: 2 lines to 1', write: { notes: ['ملاحظة قديمة 1'] } },
  { name: 'notes: change the line, add 2 (in its replacement)', write: { notes: ['ملاحظة جديدة أ', 'ملاحظة جديدة ب', 'ملاحظة جديدة ج'] } },
  { name: 'steps again (lines written at different times): 3 to 2', write: { steps: ['نحمر البصل جيدًا', 'نطبخ ساعة'] } },
  { name: 'steps a third time: 2 to 4, line 2 changed', write: { steps: ['نحمر البصل جيدًا', 'نضيف الدجاج', 'نضيف الرز', 'نطبخ ساعة'] } },
  { name: 'notes again: 3 to 2, first removed', write: { notes: ['ملاحظة جديدة ب', 'ملاحظة جديدة ج'] } },
  { name: 'src: 2 lines to 1 changed', write: { src: [{ text: 'مصدر جديد', url: null }] } },
  { name: 'ing (OneNote lists): refused, left as it is', write: { ing: [{ name: null, items: ['عدس'] }] } },
]

export interface TrialResult {
  name: string
  requests: string[][] // "action target" for each command, per request sent
  ok: boolean
  status: number | null
  error: string | null
  // Every section and the recipe-id line, compared with what they should be after this trial.
  clean: boolean
  mismatched: string[]
  readBack: Partial<Record<SectionKey, unknown>>
  htmlAfter: string
}

type ProbeGraph = {
  createPage(sectionId: string, html: string): Promise<PageMeta>
  getPageContent(pageId: string): Promise<string>
  patchPage(pageId: string, commands: PatchCommand[]): Promise<void>
}

export async function runPatchProbe(graph: ProbeGraph, sectionId: string): Promise<{ page: PageMeta; created: string; trials: TrialResult[] }> {
  const page = await graph.createPage(sectionId, buildPatchProbePage())
  const created = await graph.getPageContent(page.id)
  // What the page should hold; starts as the page read back right after creating it.
  const expected: PageState = { title: '', sections: parsePageHtml(created).sections }
  const trials: TrialResult[] = []
  let html = created
  for (const trial of PATCH_TRIALS) {
    const keys = SECTION_KEYS.filter((key) => trial.write[key] !== undefined)
    const target: RecipeSections = { ...expected.sections, ...trial.write }
    const requests: string[][] = []
    const recording = {
      patchPage: (id: string, commands: PatchCommand[]) => {
        requests.push(commands.map((c) => `${c.action} ${c.target}`))
        return graph.patchPage(id, commands)
      },
    }
    let result: Pick<TrialResult, 'ok' | 'status' | 'error'>
    try {
      for (const key of keys) {
        const dataId = SECTION_DATA_ID[key]
        const commands = planLineWrite(dataId, linesOnPage(html, dataId) ?? [], sectionLines(key, target))
        if (commands.length) await recording.patchPage(page.id, commands)
      }
      result = { ok: true, status: 204, error: null }
      expected.sections = target
    } catch (error) {
      if (error instanceof UnsupportedContentError) result = { ok: false, status: null, error: error.message }
      else if (error instanceof GraphError) result = { ok: false, status: error.status, error: error.body.replace(/\s+/g, ' ').slice(0, 300) || error.message }
      else throw error
    }
    html = await graph.getPageContent(page.id)
    const parsed = parsePageHtml(html)
    const read: PageState = { title: '', sections: parsed.sections }
    const mismatched: string[] = SECTION_KEYS.filter((key) => !sameValue(key, read, expected))
    if (parsed.recipeIdMarker !== PROBE_ID) mismatched.push('ref')
    const readBack = Object.fromEntries(SECTION_KEYS.filter((key) => mismatched.includes(key)).map((key) => [key, valueOf(key, read)]))
    trials.push({
      name: trial.name,
      requests,
      ...result,
      clean: !mismatched.length,
      mismatched,
      readBack,
      htmlAfter: html,
    })
  }
  return { page, created, trials }
}
