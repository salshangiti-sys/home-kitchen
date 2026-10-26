import { describe, expect, it } from 'vitest'
import { pageText, readPage, recipeFromPage, sectionsOf, statusOf } from './library.ts'
import { parsePageHtml } from './parse.ts'
import { buildPageHtml } from './template.ts'
import type { RecipeDoc } from './recipeDoc.ts'

const CURRENT: RecipeDoc = {
  id: 'rice-012',
  title: 'كبسة دجاج',
  status: 'complete',
  category: { notebook: 'وصفاتي', section: 'أرز' },
  sources: [{ url: 'https://www.instagram.com/reel/abc/', platform: 'instagram', label: 'ريل' }],
  ingredient_groups: [{ name: null, items: [{ text: '2 كوب رز', quantity: 2, unit: 'كوب', item: 'رز' }, { text: 'دجاج' }] }],
  steps: [{ order: 1, text: 'نحمر البصل' }],
  notes: [],
  tags: { meal_types: ['lunch'], kid_friendly: true, lunchbox: null, custom: ['سريع'] },
  onenote: { notebook: 'وصفاتي', section: 'أرز', page_id: 'p-1', created: null },
  flags: ['quantities_missing'],
  raw_text: 'old text',
}

// A page someone made by hand in OneNote: headings as bold paragraphs, real lists, no markers.
const HAND_MADE = `<html><head><title>كبسة دجاج</title></head><body><div data-id="_default">
  <p><b>المصدر</b></p><p><a href="https://www.instagram.com/reel/abc/">ريل</a></p>
  <p><b>المقادير</b></p><ul><li>2 كوب رز</li><li>صدر دجاج</li></ul>
  <p><b>الطريقة</b></p><ol><li>نحمر البصل</li><li>نضيف الرز</li></ol>
</div></body></html>`

describe('reading a recipe page', () => {
  it('takes the text from the page and keeps the app fields and unchanged structure', () => {
    const { doc, found } = readPage(CURRENT, { title: 'كبسة دجاج', html: HAND_MADE })
    expect(found).toEqual(['src', 'ing', 'steps'])
    expect(doc.ingredient_groups[0].items).toEqual([{ text: '2 كوب رز', quantity: 2, unit: 'كوب', item: 'رز' }, { text: 'صدر دجاج' }])
    expect(doc.steps).toEqual([{ order: 1, text: 'نحمر البصل' }, { order: 2, text: 'نضيف الرز' }])
    expect(doc.sources).toEqual(CURRENT.sources)
    expect(doc.tags).toEqual(CURRENT.tags)
    expect(doc.flags).toEqual(CURRENT.flags)
    expect(doc.id).toBe('rice-012')
  })

  it('leaves sections the page does not have as they were, and still updates title and text', () => {
    const html = '<html><head><title>كبسة</title></head><body><p>رابط فقط</p></body></html>'
    const { doc, found } = readPage(CURRENT, { title: 'كبسة', html })
    expect(found).toEqual([])
    expect(doc.title).toBe('كبسة')
    expect(doc.ingredient_groups).toEqual(CURRENT.ingredient_groups)
    expect(doc.raw_text).toBe('رابط فقط')
  })

  it('writes the page text as lines, numbering real lists', () => {
    expect(pageText(HAND_MADE)).toBe('المصدر\nريل\nالمقادير\n• 2 كوب رز\n• صدر دجاج\nالطريقة\n1. نحمر البصل\n2. نضيف الرز')
  })

  it('reads back a page the app created, without direction marks or the reference line', () => {
    const html = buildPageHtml({ recipeId: 'rice-012', title: CURRENT.title, sections: sectionsOf(CURRENT), appUrl: 'https://app.example/#/recipe/rice-012' })
    const { doc } = readPage(CURRENT, { title: CURRENT.title, html })
    expect(doc.ingredient_groups).toEqual(CURRENT.ingredient_groups)
    expect(doc.steps).toEqual(CURRENT.steps)
    expect(doc.sources).toEqual(CURRENT.sources)
    expect(doc.raw_text).not.toMatch(/[‪-‮]/)
    expect(doc.raw_text).not.toContain('rice-012')
  })
})

describe('pages the app does not know yet', () => {
  it('becomes a recipe flagged for review, with its kind from its content', () => {
    const doc = recipeFromPage({ id: 'p-9', title: 'كبسة دجاج', html: HAND_MADE }, { notebook: 'وصفاتي', section: 'أرز' })
    expect(doc).toMatchObject({ id: '', status: 'complete', category: { section: 'أرز' }, onenote: { page_id: 'p-9' }, flags: ['added_from_onenote'] })
    expect(statusOf({ ingredient_groups: [], steps: [], sources: [{ url: 'https://x' }] })).toBe('link_only')
    expect(statusOf({ ingredient_groups: [], steps: [], sources: [] })).toBe('note_only')
  })
})

describe('blank page from the app', () => {
  it('becomes a full recipe once ingredients or steps are typed into it', () => {
    const linkOnly: RecipeDoc = { ...CURRENT, status: 'link_only', ingredient_groups: [], steps: [] }
    expect(readPage(linkOnly, { title: 'كبسة', html: HAND_MADE }).doc.status).toBe('complete')
    const noSections = '<html><head><title>كبسة</title></head><body><p>نص</p></body></html>'
    expect(readPage(linkOnly, { title: 'كبسة', html: noSections }).doc.status).toBe('link_only')
    expect(readPage({ ...CURRENT, status: 'partial' }, { title: 'كبسة', html: HAND_MADE }).doc.status).toBe('partial')
  })

  it('has every heading with an empty line to type in, and reads back as empty', () => {
    const html = buildPageHtml({ recipeId: 'recipe-001', title: 'كبسة تونا', sections: { src: [], ing: [], steps: [], notes: [] }, appUrl: null, blankLines: true })
    for (const heading of ['المصدر', 'المقادير', 'الطريقة', 'ملاحظاتي']) expect(html).toContain(heading)
    expect(html.match(/ /g)).toHaveLength(4)
    expect(parsePageHtml(html).sections).toEqual({ src: [], ing: [], steps: [], notes: [] })
  })
})
