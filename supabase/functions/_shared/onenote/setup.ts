// Creates (or finds) the Phase 0 test notebook with its two sections. Reuses a notebook that
// already has the test name, so running setup twice, or after creating the notebook by hand,
// never makes a duplicate.

import type { OneNoteClient } from './graph.ts'

export const TEST_NOTEBOOK_NAME = 'وصفات - تجربة'
export const TEST_SECTION_NAMES = ['تجربة 1', 'تجربة 2'] as const

export interface TestNotebook {
  notebookId: string
  notebookName: string
  defaultSectionId: string
}

type SetupGraph = Pick<OneNoteClient, 'findNotebook' | 'createNotebook' | 'listSections' | 'createSection'>

export async function ensureTestNotebook(graph: SetupGraph): Promise<TestNotebook> {
  const notebook = (await graph.findNotebook(TEST_NOTEBOOK_NAME)) ?? (await graph.createNotebook(TEST_NOTEBOOK_NAME))
  const existing = await graph.listSections(notebook.id)
  const ids: string[] = []
  for (const name of TEST_SECTION_NAMES) {
    const found = existing.find((section) => section.displayName === name)
    ids.push(found ? found.id : (await graph.createSection(notebook.id, name)).id)
  }
  return { notebookId: notebook.id, notebookName: notebook.displayName, defaultSectionId: ids[0] }
}
