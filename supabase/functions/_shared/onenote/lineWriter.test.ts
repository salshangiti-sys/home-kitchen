import { describe, expect, it } from 'vitest'
import { BLANK_LINE, UnsupportedContentError, linesOnPage, planLineWrite } from './lineWriter.ts'

const page = (inner: string) => `<html><body><div data-id="_default" id="div:{g}{1}"><div data-id="hk-steps" id="div:{g}{2}:{g}{9}">${inner}</div></body></html>`

describe('linesOnPage', () => {
  it('lists headings and paragraphs with their ids, across split parts and nested parts', () => {
    const html = `<html><body>
      <div data-id="hk-ing" id="d1"><h2 id="h2:1">\u202bالمقادير\u202c</h2><div data-id="hk-ing" id="d3"><p id="p:0">• رز</p></div></div>
      <div data-id="hk-ing" id="d2"><h3 id="h3:1">الصوص</h3><p id="p:1">• ليمون</p></div>
    </body></html>`
    expect(linesOnPage(html, 'hk-ing')).toEqual([
      { id: 'h2:1', tag: 'H2', text: 'المقادير' },
      { id: 'p:0', tag: 'P', text: '• رز' },
      { id: 'h3:1', tag: 'H3', text: 'الصوص' },
      { id: 'p:1', tag: 'P', text: '• ليمون' },
    ])
  })

  it('returns null when the section is gone', () => {
    expect(linesOnPage(page('<p id="p:1">x</p>'), 'hk-notes')).toBeNull()
  })

  it('refuses sections with content it does not rewrite', () => {
    expect(() => linesOnPage(page('<h2 id="h:1">الطريقة</h2><table id="t:1"><tr><td>x</td></tr></table>'), 'hk-steps')).toThrow(UnsupportedContentError)
    // OneNote lists are never written: replacing one deleted the rest of the page in the probe.
    expect(() => linesOnPage(page('<h2 id="h:1">الطريقة</h2><ol id="o:1"><li id="l:1">نحمر</li></ol>'), 'hk-steps')).toThrow(/a OneNote list/)
  })
})

const wrapped = (html: string) => `<div data-id="hk-steps">${html}</div>`

describe('planLineWrite', () => {
  const lines = linesOnPage(page('<h2 id="h">الطريقة</h2><p id="a">1. نحمر</p><p id="b">2. نضيف</p>'), 'hk-steps')!

  it('sends nothing when the text already matches', () => {
    expect(planLineWrite('hk-steps', lines, ['<h2>\u202bالطريقة\u202c</h2>', '<p>\u202b1. نحمر\u202c</p>', '<p>\u202b2. نضيف\u202c</p>'])).toEqual([])
  })

  it('replaces changed lines inside the section data-id and removes the lines no longer needed', () => {
    expect(planLineWrite('hk-steps', lines, ['<h2>الطريقة</h2>', '<p>1. نطبخ</p>'])).toEqual([
      { target: 'a', action: 'replace', content: wrapped('<p>1. نطبخ</p>') },
      { target: 'b', action: 'replace', content: BLANK_LINE },
    ])
  })

  it('inserts extra lines after an unchanged last line', () => {
    expect(planLineWrite('hk-steps', lines, ['<h2>الطريقة</h2>', '<p>1. نحمر جيدًا</p>', '<p>2. نضيف</p>', '<p>3. نطبخ</p>'])).toEqual([
      { target: 'b', action: 'insert', position: 'after', content: wrapped('<p>3. نطبخ</p>') },
      { target: 'a', action: 'replace', content: wrapped('<p>1. نحمر جيدًا</p>') },
    ])
  })

  it('puts extra lines into the replacement of a changed last line, never insert and replace on one line', () => {
    expect(planLineWrite('hk-steps', lines, ['<h2>الطريقة</h2>', '<p>1. نحمر</p>', '<p>2. نضيف الماء</p>', '<p>3. نطبخ</p>'])).toEqual([
      { target: 'b', action: 'replace', content: wrapped('<p>2. نضيف الماء</p><p>3. نطبخ</p>') },
    ])
  })

  it('treats a heading and a paragraph with the same text as different lines', () => {
    const ing = linesOnPage(page('<h2 id="h">المقادير</h2><p id="a">الصوص</p>'), 'hk-steps')!
    expect(planLineWrite('hk-steps', ing, ['<h2>المقادير</h2>', '<h3>الصوص</h3>'])).toEqual([{ target: 'a', action: 'replace', content: wrapped('<h3>الصوص</h3>') }])
  })

  it('rewrites every line when forced (template upgrade)', () => {
    expect(planLineWrite('hk-steps', lines, ['<h2>الطريقة</h2>', '<p>1. نحمر</p>', '<p>2. نضيف</p>'], true)).toHaveLength(3)
  })

  it('appends to an emptied section by its data-id', () => {
    expect(planLineWrite('hk-steps', [], ['<h2>الطريقة</h2>'])).toEqual([{ target: '#hk-steps', action: 'append', content: '<h2>الطريقة</h2>' }])
  })

})
