import { describe, expect, it } from 'vitest'
import { SAMPLE_SECTIONS, sectionsToText, textToIngredients, textToSections, textToSources } from './sectionsText'

describe('sync lab text editing', () => {
  it('round-trips the sample recipe', () => {
    expect(textToSections(sectionsToText(SAMPLE_SECTIONS))).toEqual(SAMPLE_SECTIONS)
  })

  it('reads labelled links, bare links and plain sources', () => {
    expect(textToSources('تيك توك | https://tiktok.com/x\nhttps://youtu.be/y\nمن كتاب')).toEqual([
      { text: 'تيك توك', url: 'https://tiktok.com/x' },
      { text: 'https://youtu.be/y', url: 'https://youtu.be/y' },
      { text: 'من كتاب', url: null },
    ])
  })

  it('starts an ingredient group at a ## line and skips blank lines', () => {
    expect(textToIngredients('دجاج\n\n## الصوص\nليمون')).toEqual([
      { name: null, items: ['دجاج'] },
      { name: 'الصوص', items: ['ليمون'] },
    ])
  })
})
