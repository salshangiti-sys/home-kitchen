import { describe, expect, it } from 'vitest'
import { parsePageHtml } from './parse.ts'
import { buildPageHtml, buildSectionHtml } from './template.ts'
import type { RecipeSections } from './sections.ts'

const SECTIONS: RecipeSections = {
  src: [
    { text: 'فيديو تيك توك', url: 'https://www.tiktok.com/@cook/video/123' },
    { text: 'من كتاب أمي', url: null },
  ],
  ing: [
    { name: null, items: ['2 كوب mixed leaves', 'خيار مقطع'] },
    { name: 'الصوص', items: ['ليمون', 'زيت زيتون'] },
  ],
  steps: ['نغسل الخضار', 'نخلط الصوص ونصبه'],
  notes: ['أزيد الليمون شوي'],
}

describe('page template round trip', () => {
  it('reads back exactly what it wrote', () => {
    const html = buildPageHtml({ recipeId: 'salads-007', title: 'سلطة <خضراء> & ليمون', sections: SECTIONS, appUrl: null })
    const parsed = parsePageHtml(html)
    expect(parsed.title).toBe('سلطة <خضراء> & ليمون')
    expect(parsed.sections).toEqual(SECTIONS)
    expect(parsed.foundBy).toEqual({ src: 'data-id', ing: 'data-id', steps: 'data-id', notes: 'data-id' })
    expect(parsed.recipeIdMarker).toBe('salads-007')
  })

  it('keeps empty sections as empty lists', () => {
    const empty: RecipeSections = { src: [], ing: [], steps: [], notes: [] }
    const parsed = parsePageHtml(buildPageHtml({ recipeId: 'x-1', title: 'فارغة', sections: empty, appUrl: null }))
    expect(parsed.sections).toEqual(empty)
  })

  it('writes every line as a right-to-left embedding with text bullets and step numbers', () => {
    const html = buildSectionHtml('steps', SECTIONS)
    expect(html.startsWith('<div data-id="hk-steps"><h2 style="text-align:right">\u202bالطريقة\u202c</h2>')).toBe(true)
    expect(html).toContain('<p style="text-align:right">\u202b1. نغسل الخضار\u202c</p>')
    expect(html).not.toMatch(/<(ul|ol|li)\b/)
    expect(buildSectionHtml('ing', SECTIONS)).toContain('\u202b• 2 كوب mixed leaves\u202c')
  })
})

describe('template v2 as OneNote returns it', () => {
  // Shaped like the probe output: OneNote keeps the bidi controls and splits one section into two
  // divs with the same data-id; a hand-typed step has no number or controls.
  const html = `<html><head><title>شوربة</title></head><body><div data-id="_default">
    <div data-id="hk-steps" id="div:{s}{1}"><h2>\u202bالطريقة\u202c</h2><p>\u202b1. نغسل العدس\u202c</p></div>
    <br />
    <div data-id="hk-steps" id="div:{s}{2}"><p>\u202b2. نطبخه ساعة\u202c</p><p>نضيف الملح</p></div>
    <div data-id="hk-notes" id="div:{n}{1}"><h2>\u202bملاحظاتي\u202c</h2><p>\u202b• تتجمد زين\u202c</p></div>
    <div data-id="hk-ref" id="div:{r}{1}"><p>\u202bمعرّف الوصفة: soups-003\u202c</p></div>
  </div></body></html>`
  const parsed = parsePageHtml(html)

  it('strips the controls, bullets and step numbers, keeping the words as written', () => {
    expect(parsed.sections.steps).toEqual(['نغسل العدس', 'نطبخه ساعة', 'نضيف الملح'])
    expect(parsed.sections.notes).toEqual(['تتجمد زين'])
    expect(parsed.recipeIdMarker).toBe('soups-003')
  })

  it('reads every part of a split section and remembers the extra parts', () => {
    expect(parsed.generatedIds.steps).toBe('div:{s}{1}')
    expect(parsed.extraIds.steps).toEqual(['div:{s}{2}'])
    expect(parsed.refId).toBe('div:{r}{1}')
  })

  it('does not strip a leading quantity from an ingredient or a step', () => {
    const page = parsePageHtml(
      `<html><body><div data-id="hk-ing"><h2>المقادير</h2><p>2 كوب رز</p></div><div data-id="hk-steps"><h2>الطريقة</h2><p>2 ملعقة زيت ثم نحرك</p></div></body></html>`,
    )
    expect(page.sections.ing).toEqual([{ name: null, items: ['2 كوب رز'] }])
    expect(page.sections.steps).toEqual(['2 ملعقة زيت ثم نحرك'])
  })
})

// Shaped like OneNote's documented output HTML: everything wrapped in the default absolute div,
// generated ids on elements, styles moved onto spans, non-breaking spaces from the clients.
const ONENOTE_OUTPUT = `<html lang="ar">
<head><title>سلطة خضراء</title><meta name="created" content="2026-10-24T10:00:00.0000000" /></head>
<body data-absolute-enabled="true" style="font-family:Calibri;font-size:11pt">
<div id="div:{aa}{1}" data-id="_default" style="position:absolute;left:48px;top:120px;width:624px">
  <div id="div:{aa}{10}" data-id="hk-src">
    <h2 id="h2:{aa}{11}" style="text-align:right">المصدر</h2>
    <p id="p:{aa}{12}" style="text-align:right"><a href="https://www.tiktok.com/@cook/video/123">فيديو&nbsp;تيك توك</a></p>
  </div>
  <div id="div:{aa}{20}" data-id="hk-ing">
    <h2 id="h2:{aa}{21}">المقادير</h2>
    <ul><li id="li:{aa}{22}"><span style="font-family:Calibri">2 كوب mixed leaves</span></li>
    <li id="li:{aa}{23}"><span>خيار مقطع</span></li></ul>
    <h3 id="h3:{aa}{24}">الصوص</h3>
    <ul><li id="li:{aa}{25}">ليمون</li></ul>
  </div>
  <div id="div:{aa}{30}" data-id="hk-steps">
    <h2>الطريقة</h2>
    <ol><li>نغسل الخضار</li><li>نخلط الصوص ونصبه</li></ol>
    <p>&nbsp;</p>
  </div>
  <div id="div:{aa}{40}" data-id="hk-notes"><h2>ملاحظاتي</h2></div>
  <div id="div:{aa}{50}" data-id="hk-ref"><p><span style="font-size:8pt">معرّف الوصفة: salads-007</span></p></div>
</div>
</body></html>`

describe('parsing OneNote output HTML', () => {
  const parsed = parsePageHtml(ONENOTE_OUTPUT)

  it('finds every section by data-id and records the generated ids', () => {
    expect(parsed.foundBy).toEqual({ src: 'data-id', ing: 'data-id', steps: 'data-id', notes: 'data-id' })
    expect(parsed.generatedIds).toEqual({
      src: 'div:{aa}{10}',
      ing: 'div:{aa}{20}',
      steps: 'div:{aa}{30}',
      notes: 'div:{aa}{40}',
    })
  })

  it('reads lines and groups through the spans OneNote adds', () => {
    expect(parsed.sections.ing).toEqual([
      { name: null, items: ['2 كوب mixed leaves', 'خيار مقطع'] },
      { name: 'الصوص', items: ['ليمون'] },
    ])
    expect(parsed.sections.steps).toEqual(['نغسل الخضار', 'نخلط الصوص ونصبه'])
    expect(parsed.sections.notes).toEqual([])
  })

  it('keeps link text as written and ignores blank paragraphs', () => {
    expect(parsed.sections.src).toEqual([
      { text: 'فيديو تيك توك', url: 'https://www.tiktok.com/@cook/video/123' },
    ])
  })

  it('reads the recipe id marker', () => {
    expect(parsed.recipeIdMarker).toBe('salads-007')
  })
})

describe('heading fallback', () => {
  it('finds sections by their headings when the data-ids are gone', () => {
    const html = `<html><head><title>كيكة</title></head><body><div data-id="_default">
      <p><b>المصدر</b></p><p>https://youtu.be/abc</p>
      <h2>المقادير</h2><ul><li>بيض</li><li>سكر</li></ul>
      <p>الطريقة</p><ol><li>نخفق البيض</li></ol>
    </div></body></html>`
    const parsed = parsePageHtml(html)
    expect(parsed.foundBy).toEqual({ src: 'heading', ing: 'heading', steps: 'heading', notes: 'missing' })
    expect(parsed.sections.src).toEqual([{ text: 'https://youtu.be/abc', url: null }])
    expect(parsed.sections.ing).toEqual([{ name: null, items: ['بيض', 'سكر'] }])
    expect(parsed.sections.steps).toEqual(['نخفق البيض'])
  })

  it('uses data-id where present and headings only for the rest', () => {
    const html = `<html><head><title>شوربة</title></head><body><div data-id="_default">
      <div data-id="hk-ing"><h2>المقادير</h2><ul><li>عدس</li></ul></div>
      <h2>ملاحظاتي</h2><p>تتجمد زين</p>
    </div></body></html>`
    const parsed = parsePageHtml(html)
    expect(parsed.foundBy.ing).toBe('data-id')
    expect(parsed.foundBy.notes).toBe('heading')
    expect(parsed.sections.notes).toEqual(['تتجمد زين'])
    expect(parsed.sections.ing).toEqual([{ name: null, items: ['عدس'] }])
  })
})
