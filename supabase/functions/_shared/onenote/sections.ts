// The recipe page model shared by the app and the sync worker: a title plus the four template
// sections. Text is kept exactly as the author wrote it; normalizeForCompare exists only to decide
// whether a section changed, never to rewrite what is stored.

export const SECTION_KEYS = ['src', 'ing', 'steps', 'notes'] as const
export type SectionKey = (typeof SECTION_KEYS)[number]

export const SECTION_HEADINGS: Record<SectionKey, string> = {
  src: 'المصدر',
  ing: 'المقادير',
  steps: 'الطريقة',
  notes: 'ملاحظاتي',
}

export interface SourceLine {
  text: string
  url: string | null
}

export interface IngredientGroup {
  name: string | null
  items: string[]
}

export interface RecipeSections {
  src: SourceLine[]
  ing: IngredientGroup[]
  steps: string[]
  notes: string[]
}

export interface PageState {
  title: string
  sections: RecipeSections
}

export type MergeKey = 'title' | SectionKey
export const MERGE_KEYS: readonly MergeKey[] = ['title', ...SECTION_KEYS]

export function emptySections(): RecipeSections {
  return { src: [], ing: [], steps: [], notes: [] }
}

// Bidi control marks and non-breaking spaces show up when text passes through OneNote clients;
// they do not change what the author wrote, so they are ignored when comparing.
const INVISIBLE_MARKS = /[‎‏‪-‮⁦-⁩﻿]/g

export function normalizeForCompare(text: string): string {
  return text.replace(INVISIBLE_MARKS, '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
}

function canonical(key: MergeKey, state: PageState): string {
  if (key === 'title') return normalizeForCompare(state.title)
  const value = state.sections[key]
  switch (key) {
    case 'src':
      return JSON.stringify(
        (value as SourceLine[]).map((line) => [normalizeForCompare(line.text), line.url?.trim() ?? null]),
      )
    case 'ing':
      return JSON.stringify(
        (value as IngredientGroup[]).map((group) => [
          group.name === null ? null : normalizeForCompare(group.name),
          group.items.map(normalizeForCompare),
        ]),
      )
    default:
      return JSON.stringify((value as string[]).map(normalizeForCompare))
  }
}

export function sameValue(key: MergeKey, a: PageState, b: PageState): boolean {
  return canonical(key, a) === canonical(key, b)
}

export function valueOf(key: MergeKey, state: PageState): unknown {
  return key === 'title' ? state.title : state.sections[key]
}

export function withValue(state: PageState, key: MergeKey, value: unknown): PageState {
  if (key === 'title') return { ...state, title: value as string }
  return { ...state, sections: { ...state.sections, [key]: value } }
}
