// Plain-text editing for the Phase 0 sync lab: one line per item.
// Sources: "label | url", a bare URL, or plain text. Ingredients: "## name" starts a sub-group.

import type { IngredientGroup, RecipeSections, SourceLine } from '../../supabase/functions/_shared/onenote/sections.ts'

const lines = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean)

export function sourcesToText(src: SourceLine[]): string {
  return src.map((line) => (line.url ? (line.text && line.text !== line.url ? `${line.text} | ${line.url}` : line.url) : line.text)).join('\n')
}

export function textToSources(text: string): SourceLine[] {
  return lines(text).map((line) => {
    const [label, url] = line.split(' | ')
    if (url && /^https?:\/\//.test(url.trim())) return { text: label.trim(), url: url.trim() }
    if (/^https?:\/\//.test(line)) return { text: line, url: line }
    return { text: line, url: null }
  })
}

export function ingredientsToText(groups: IngredientGroup[]): string {
  return groups.flatMap((group) => [...(group.name === null ? [] : [`## ${group.name}`]), ...group.items]).join('\n')
}

export function textToIngredients(text: string): IngredientGroup[] {
  const groups: IngredientGroup[] = []
  let current: IngredientGroup = { name: null, items: [] }
  for (const line of lines(text)) {
    if (line.startsWith('## ')) {
      if (current.name !== null || current.items.length) groups.push(current)
      current = { name: line.slice(3).trim(), items: [] }
    } else {
      current.items.push(line)
    }
  }
  if (current.name !== null || current.items.length) groups.push(current)
  return groups
}

export interface SectionsText {
  src: string
  ing: string
  steps: string
  notes: string
}

export function sectionsToText(sections: RecipeSections): SectionsText {
  return {
    src: sourcesToText(sections.src),
    ing: ingredientsToText(sections.ing),
    steps: sections.steps.join('\n'),
    notes: sections.notes.join('\n'),
  }
}

export function textToSections(text: SectionsText): RecipeSections {
  return {
    src: textToSources(text.src),
    ing: textToIngredients(text.ing),
    steps: lines(text.steps),
    notes: lines(text.notes),
  }
}

export const SAMPLE_SECTIONS: RecipeSections = {
  src: [{ text: 'وصفة تجريبية', url: 'https://www.youtube.com/watch?v=example' }],
  ing: [
    { name: null, items: ['2 كوب رز', 'صدر دجاج', 'بصلة مقطعة'] },
    { name: 'البهارات', items: ['هيل', 'ملح'] },
  ],
  steps: ['نحمر البصل', 'نضيف الدجاج والبهارات', 'نضيف الرز والماء ونطبخ'],
  notes: ['هذه وصفة للتجربة فقط'],
}
