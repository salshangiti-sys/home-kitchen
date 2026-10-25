import { describe, expect, it, vi } from 'vitest'
import { TEST_NOTEBOOK_NAME, ensureTestNotebook } from './setup.ts'

function fakeGraph(existingNotebook: boolean, existingSections: string[]) {
  return {
    findNotebook: vi.fn(async () => (existingNotebook ? { id: 'nb1', displayName: TEST_NOTEBOOK_NAME } : null)),
    createNotebook: vi.fn(async (name: string) => ({ id: 'nb-new', displayName: name })),
    listSections: vi.fn(async () => existingSections.map((name, i) => ({ id: `s${i}`, displayName: name }))),
    createSection: vi.fn(async (_nb: string, name: string) => ({ id: `new-${name}`, displayName: name })),
  }
}

describe('ensureTestNotebook', () => {
  it('creates the notebook and both sections when nothing exists', async () => {
    const graph = fakeGraph(false, [])
    const result = await ensureTestNotebook(graph)
    expect(graph.createNotebook).toHaveBeenCalledWith(TEST_NOTEBOOK_NAME)
    expect(graph.createSection).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ notebookId: 'nb-new', notebookName: TEST_NOTEBOOK_NAME, defaultSectionId: 'new-تجربة 1' })
  })

  it('reuses an existing notebook and only adds the missing section', async () => {
    const graph = fakeGraph(true, ['تجربة 1'])
    const result = await ensureTestNotebook(graph)
    expect(graph.createNotebook).not.toHaveBeenCalled()
    expect(graph.createSection).toHaveBeenCalledTimes(1)
    expect(graph.createSection).toHaveBeenCalledWith('nb1', 'تجربة 2')
    expect(result.defaultSectionId).toBe('s0')
  })
})
