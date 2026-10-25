// Phase 0 experiment: can a page written through the API read right-to-left in OneNote?
// Round 1 showed OneNote drops dir="rtl" and direction:rtl, so paragraph direction cannot be set.
// Round 2 (this page) tries Unicode bidi controls inside each line instead: an embedding
// (RLE…PDF) or an isolate (RLI…PDI) makes the line's own text order right-to-left, and text
// bullets/numbers inside it sit on the right because they are part of that right-to-left run.

const LINE = '2 كوب رز مع mixed leaves'
const ITEM = 'صدر دجاج'
const STEPS = ['نحمر البصل', 'نضيف الدجاج']

const RLE = '‫'
const PDF = '‬'
const RLI = '⁧'
const PDI = '⁩'
const RIGHT = 'style="text-align:right"'

const wrap = (open: string, close: string) => (text: string) => `${open}${text}${close}`
const embed = wrap(RLE, PDF)
const isolate = wrap(RLI, PDI)

function realLists(label: string, mark: (text: string) => string): string {
  return (
    `<h2 ${RIGHT}>${mark(label)}</h2>` +
    `<p ${RIGHT}>${mark(LINE)}</p>` +
    `<ul><li ${RIGHT}>${mark(ITEM)}</li></ul>` +
    `<ol>${STEPS.map((step) => `<li ${RIGHT}>${mark(step)}</li>`).join('')}</ol>`
  )
}

function textMarkers(label: string, mark: (text: string) => string): string {
  return (
    `<h2 ${RIGHT}>${mark(label)}</h2>` +
    `<p ${RIGHT}>${mark(LINE)}</p>` +
    `<p ${RIGHT}>${mark(`• ${ITEM}`)}</p>` +
    STEPS.map((step, i) => `<p ${RIGHT}>${mark(`${i + 1}. ${step}`)}</p>`).join('')
  )
}

export interface ProbePage {
  title: string
  html: string
}

export function buildRtlProbePages(): ProbePage[] {
  const title = 'اختبار الاتجاه 3 (حروف تحكم)'
  const variants = [
    `<div data-id="probe-z">${realLists('ز) قوائم OneNote + تضمين RLE', embed)}</div>`,
    `<div data-id="probe-h">${textMarkers('ح) نقاط وأرقام نصية + تضمين RLE', embed)}</div>`,
    `<div data-id="probe-t">${textMarkers('ط) نقاط وأرقام نصية + عزل RLI', isolate)}</div>`,
  ]
  return [
    {
      title,
      html: `<!DOCTYPE html><html lang="ar"><head><title>${title}</title></head><body>${variants.join('')}</body></html>`,
    },
  ]
}
