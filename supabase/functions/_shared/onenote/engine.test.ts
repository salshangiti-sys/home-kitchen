// Runs the sync engine against a simulated OneNote, one scenario per row of the Phase 0 test
// matrix that can be checked without a real account.

import { beforeEach, describe, expect, it } from 'vitest'
import { GraphError } from './graph.ts'
import { FakeOneNote } from './fakeOneNote.ts'
import {
  ReconnectRequiredError,
  resolveConflict,
  syncRecipe,
  type ConflictInput,
  type LinkRow,
  type RecipeRow,
  type SyncDeps,
  type SyncStore,
} from './engine.ts'
import type { MergeKey, PageState, RecipeSections } from './sections.ts'

// --- in-memory store ----------------------------------------------------------------------

class MemoryStore implements SyncStore {
  recipes = new Map<string, RecipeRow>()
  links = new Map<string, LinkRow>()
  conflicts: Array<{ id: string; recipeId: string; input: ConflictInput; resolution: string | null }> = []
  snapshots: Array<{ pageId: string; reason: string; html: string }> = []
  allowed = [{ notebookId: 'nb-test', defaultSectionId: 'sec-test' }]

  async getRecipe(id: string) {
    const recipe = this.recipes.get(id)
    return recipe ? structuredClone(recipe) : null
  }
  async updateRecipe(id: string, expectedVersion: number, state: PageState) {
    const recipe = this.recipes.get(id)!
    if (recipe.version !== expectedVersion) return false
    this.recipes.set(id, { ...recipe, title: state.title, sections: structuredClone(state.sections), version: recipe.version + 1 })
    return true
  }
  async getLink(id: string) {
    const link = this.links.get(id)
    return link ? structuredClone(link) : null
  }
  async saveLink(link: LinkRow) {
    this.links.set(link.recipe_id, structuredClone(link))
  }
  async addConflicts(recipeId: string, inputs: ConflictInput[]) {
    for (const input of inputs) {
      const open = this.conflicts.find((c) => c.recipeId === recipeId && c.input.key === input.key && !c.resolution)
      if (open) open.input = input
      else this.conflicts.push({ id: `c${this.conflicts.length + 1}`, recipeId, input, resolution: null })
    }
  }
  async getOpenConflict(recipeId: string, key: MergeKey) {
    const open = this.conflicts.find((c) => c.recipeId === recipeId && c.input.key === key && !c.resolution)
    return open ? { id: open.id, remote: open.input.remote } : null
  }
  async markConflictResolved(id: string, resolution: 'local' | 'remote') {
    this.conflicts.find((c) => c.id === id)!.resolution = resolution
  }
  async saveSnapshot(pageId: string, _recipeId: string, reason: string, html: string) {
    this.snapshots.push({ pageId, reason, html })
  }
  async allowedNotebooks() {
    return this.allowed
  }

  editInApp(id: string, change: (sections: RecipeSections) => Partial<RecipeSections>, title?: string) {
    const recipe = this.recipes.get(id)!
    this.recipes.set(id, {
      ...recipe,
      title: title ?? recipe.title,
      sections: { ...recipe.sections, ...change(recipe.sections) },
      version: recipe.version + 1,
    })
  }
}

// --- scenarios ----------------------------------------------------------------------------

const RECIPE: RecipeRow = {
  id: 'test-001',
  title: 'كبسة دجاج',
  version: 1,
  sections: {
    src: [{ text: 'يوتيوب', url: 'https://youtu.be/x' }],
    ing: [{ name: null, items: ['دجاج', 'رز'] }, { name: 'البهارات', items: ['هيل'] }],
    steps: ['نحمر البصل', 'نضيف الدجاج'],
    notes: ['بهارات أقل'],
  },
}

let store: MemoryStore
let onenote: FakeOneNote
let deps: SyncDeps
const pageId = () => store.links.get(RECIPE.id)!.page_id!

beforeEach(async () => {
  store = new MemoryStore()
  store.recipes.set(RECIPE.id, structuredClone(RECIPE))
  onenote = new FakeOneNote({ 'sec-test': 'nb-test', 'sec-real': 'nb-real' })
  deps = { store, graph: onenote, appUrl: (id) => `https://app.example/r/${id}`, now: () => new Date('2026-10-24T12:00:00Z') }
})

describe('sync engine', () => {
  it('1. creates the page in the test notebook and records the link', async () => {
    const result = await syncRecipe(RECIPE.id, deps)
    expect(result.status).toBe('synced')
    expect(result.created).toBe(true)
    const link = store.links.get(RECIPE.id)!
    expect(link.notebook_id).toBe('nb-test')
    expect(onenote.pages.get(link.page_id!)!.html).toContain('معرّف الوصفة: test-001')
  })

  it('only reads when neither side changed', async () => {
    await syncRecipe(RECIPE.id, deps)
    onenote.calls = []
    expect((await syncRecipe(RECIPE.id, deps)).status).toBe('synced')
    expect(onenote.calls).toEqual(['getPageMeta', 'getPageContent'])
  })

  it('pulls a OneNote edit even when the page keeps its lastModifiedDateTime', async () => {
    await syncRecipe(RECIPE.id, deps)
    // Seen in Phase 0: after a hand edit in OneNote on the web, Graph still reported the old time.
    const page = onenote.pages.get(pageId())!
    const before = page.lastModified
    onenote.editByHand(pageId(), (html) => html.replace('2. نضيف الدجاج\u202c</p>', '2. نضيف الدجاج\u202c</p><p>5. نقدّمه مع السلطة</p>'))
    page.lastModified = before

    const result = await syncRecipe(RECIPE.id, deps)
    expect(result.pulled).toEqual(['steps'])
    expect(store.recipes.get(RECIPE.id)!.sections.steps).toEqual(['نحمر البصل', 'نضيف الدجاج', 'نقدّمه مع السلطة'])
  })

  it('2. pushes only the edited section and leaves hand-made content alone', async () => {
    await syncRecipe(RECIPE.id, deps)
    onenote.editByHand(pageId(), (html) => html.replace('</body>', '<p>ملاحظة كتبتها يدويًا</p></body>'))
    store.editInApp(RECIPE.id, () => ({ ing: [{ name: null, items: ['دجاج', 'رز بسمتي'] }] }))

    const result = await syncRecipe(RECIPE.id, deps)
    expect(result.pushed).toEqual(['ing'])
    const html = onenote.pages.get(pageId())!.html
    expect(html).toContain('رز بسمتي')
    expect(html).toContain('ملاحظة كتبتها يدويًا')
    expect(store.snapshots).toHaveLength(1)
  })

  it('3. pulls a section edited in OneNote into the app', async () => {
    await syncRecipe(RECIPE.id, deps)
    // A step typed by hand in OneNote: no number and no direction controls.
    onenote.editByHand(pageId(), (html) => html.replace('2. نضيف الدجاج\u202c</p>', '2. نضيف الدجاج\u202c</p><p>نطبخ ساعة</p>'))

    const result = await syncRecipe(RECIPE.id, deps)
    expect(result.pulled).toEqual(['steps'])
    expect(store.recipes.get(RECIPE.id)!.sections.steps).toEqual(['نحمر البصل', 'نضيف الدجاج', 'نطبخ ساعة'])
  })

  it('4. records a conflict without overwriting either side, then resolves it', async () => {
    await syncRecipe(RECIPE.id, deps)
    onenote.editByHand(pageId(), (html) => html.replace('بهارات أقل', 'بهارات أقل من OneNote'))
    store.editInApp(RECIPE.id, () => ({ notes: ['بهارات أقل من التطبيق'] }))

    const result = await syncRecipe(RECIPE.id, deps)
    expect(result.status).toBe('conflict')
    expect(result.conflicts).toEqual(['notes'])
    expect(onenote.pages.get(pageId())!.html).toContain('من OneNote')
    expect(store.recipes.get(RECIPE.id)!.sections.notes).toEqual(['بهارات أقل من التطبيق'])

    // Syncing again does not duplicate the conflict.
    await syncRecipe(RECIPE.id, deps)
    expect(store.conflicts.filter((c) => !c.resolution)).toHaveLength(1)

    const resolved = await resolveConflict(RECIPE.id, 'notes', 'local', deps)
    expect(resolved.status).toBe('synced')
    expect(onenote.pages.get(pageId())!.html).toContain('بهارات أقل من التطبيق')
    expect(onenote.pages.get(pageId())!.html).not.toContain('من OneNote')
  })

  it('4b. resolving in favor of OneNote copies its value into the app', async () => {
    await syncRecipe(RECIPE.id, deps)
    onenote.editByHand(pageId(), (html) => html.replace('بهارات أقل', 'من OneNote'))
    store.editInApp(RECIPE.id, () => ({ notes: ['من التطبيق'] }))
    await syncRecipe(RECIPE.id, deps)

    const resolved = await resolveConflict(RECIPE.id, 'notes', 'remote', deps)
    expect(resolved.status).toBe('synced')
    expect(store.recipes.get(RECIPE.id)!.sections.notes).toEqual(['من OneNote'])
  })

  it('5. merges edits to different sections from both sides', async () => {
    await syncRecipe(RECIPE.id, deps)
    onenote.editByHand(pageId(), (html) => html.replace('<title>كبسة دجاج</title>', '<title>كبسة دجاج بالفرن</title>'))
    store.editInApp(RECIPE.id, () => ({ steps: ['خطوة واحدة'] }))

    const result = await syncRecipe(RECIPE.id, deps)
    expect(result.status).toBe('synced')
    expect(result.pulled).toEqual(['title'])
    expect(result.pushed).toEqual(['steps'])
    expect(store.recipes.get(RECIPE.id)!.title).toBe('كبسة دجاج بالفرن')
    expect(onenote.pages.get(pageId())!.html).toContain('خطوة واحدة')
  })

  it('7-8. marks a temporary failure for retry and succeeds on the next run', async () => {
    await syncRecipe(RECIPE.id, deps)
    store.editInApp(RECIPE.id, () => ({ steps: ['بعد انقطاع'] }))
    onenote.failNext = [new GraphError('throttled', 429, true)]

    const failed = await syncRecipe(RECIPE.id, deps)
    expect(failed.status).toBe('failed')
    expect(store.links.get(RECIPE.id)!.retry_count).toBe(1)
    expect(store.links.get(RECIPE.id)!.next_retry_at).toBe('2026-10-24T12:02:00.000Z')

    const retried = await syncRecipe(RECIPE.id, deps)
    expect(retried.status).toBe('synced')
    expect(store.links.get(RECIPE.id)!.retry_count).toBe(0)
    expect(onenote.pages.get(pageId())!.html).toContain('بعد انقطاع')
  })

  it('keeps OneNote\'s error explanation when a write is rejected', async () => {
    await syncRecipe(RECIPE.id, deps)
    store.editInApp(RECIPE.id, () => ({ steps: ['خطوة'] }))
    onenote.patchPage = async () => {
      throw new GraphError('PATCH failed with 400', 400, false, '{"error":{"code":"20135","message":"bad target"}}')
    }
    const result = await syncRecipe(RECIPE.id, deps)
    expect(result.status).toBe('failed')
    expect(store.links.get(RECIPE.id)!.last_error).toContain('"code":"20135"')
    expect(store.links.get(RECIPE.id)!.next_retry_at).toBeNull()
  })

  it('9. asks to reconnect when the Microsoft token is revoked and keeps the change', async () => {
    await syncRecipe(RECIPE.id, deps)
    store.editInApp(RECIPE.id, () => ({ steps: ['تعديل محفوظ'] }))
    onenote.failNext = [new ReconnectRequiredError()]

    const result = await syncRecipe(RECIPE.id, deps)
    expect(result.status).toBe('needs_reconnect')
    expect(store.recipes.get(RECIPE.id)!.sections.steps).toEqual(['تعديل محفوظ'])
    expect((await syncRecipe(RECIPE.id, deps)).pushed).toEqual(['steps'])
  })

  it('10. reports a page deleted in OneNote and deletes nothing in the app', async () => {
    await syncRecipe(RECIPE.id, deps)
    onenote.pages.delete(pageId())
    const result = await syncRecipe(RECIPE.id, deps)
    expect(result.status).toBe('remote_deleted')
    expect(store.recipes.has(RECIPE.id)).toBe(true)
  })

  it('restores a section whose div was deleted in OneNote', async () => {
    await syncRecipe(RECIPE.id, deps)
    onenote.editByHand(pageId(), (html) => html.replace(/<div[^>]*data-id="hk-notes"[^>]*>[\s\S]*?<\/div>/, ''))
    const result = await syncRecipe(RECIPE.id, deps)
    expect(result.pushed).toEqual(['notes'])
    expect(onenote.pages.get(pageId())!.html).toContain('data-id="hk-notes"')
    expect(store.recipes.get(RECIPE.id)!.sections.notes).toEqual(['بهارات أقل'])
  })

  it('refuses to write to a page outside the allowed notebooks', async () => {
    await syncRecipe(RECIPE.id, deps)
    onenote.pages.get(pageId())!.notebookId = 'nb-real' // page moved to the real recipe notebook
    store.editInApp(RECIPE.id, () => ({ steps: ['لا يجب أن يُكتب'] }))
    const before = onenote.pages.get(pageId())!.html

    const result = await syncRecipe(RECIPE.id, deps)
    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/not allowed/)
    expect(onenote.pages.get(pageId())!.html).toBe(before)
  })

  it('rewrites a page made with an older template and records the new version', async () => {
    await syncRecipe(RECIPE.id, deps)
    store.links.get(RECIPE.id)!.template_version = 1
    const result = await syncRecipe(RECIPE.id, deps)
    expect(result.pushed).toEqual(['src', 'ing', 'steps', 'notes'])
    expect(store.links.get(RECIPE.id)!.template_version).toBe(2)
    expect(store.recipes.get(RECIPE.id)!.sections).toEqual(RECIPE.sections)
    expect((await syncRecipe(RECIPE.id, deps)).pushed).toEqual([])
  })

  it('reads a section OneNote split in two and empties the extra part when writing it back', async () => {
    await syncRecipe(RECIPE.id, deps)
    // Split the steps div after its first line, the way OneNote did in the probe.
    onenote.editByHand(pageId(), (html) =>
      html.replace(/(<div[^>]*data-id="hk-steps"[^>]*>[\s\S]*?1\. نحمر البصل\u202c<\/p>)/, '$1</div><br /><div data-id="hk-steps">'),
    )
    expect((await syncRecipe(RECIPE.id, deps)).pulled).toEqual([])

    store.editInApp(RECIPE.id, () => ({ steps: ['خطوة جديدة'] }))
    expect((await syncRecipe(RECIPE.id, deps)).pushed).toEqual(['steps'])
    const html = onenote.pages.get(pageId())!.html
    expect(html).toContain('خطوة جديدة')
    expect(html).not.toContain('نضيف الدجاج')
  })

  it('changes only the lines that differ, each by its own id', async () => {
    await syncRecipe(RECIPE.id, deps)
    store.editInApp(RECIPE.id, () => ({ steps: ['نحمر البصل', 'نضيف الدجاج والبهارات'] }))
    onenote.patches = []
    expect((await syncRecipe(RECIPE.id, deps)).pushed).toEqual(['steps'])
    expect(onenote.patches).toEqual([[expect.objectContaining({ action: 'replace', target: expect.stringMatching(/^p:/) })]])
    expect(onenote.patches[0][0].content).toContain('2. نضيف الدجاج والبهارات')
  })

  it('blanks lines no longer needed and inserts extra ones after the last line', async () => {
    await syncRecipe(RECIPE.id, deps)
    store.editInApp(RECIPE.id, () => ({ steps: ['خطوة واحدة'], notes: ['أ', 'ب', 'ج'] }))
    await syncRecipe(RECIPE.id, deps)
    const actions = onenote.patches.flat().map((c) => `${c.action}:${c.content === '<p></p>' ? 'blank' : 'line'}`)
    expect(store.links.get(RECIPE.id)!.last_error).toBeNull()
    // steps: line 1 changed, line 2 removed; notes: its one line changed, with the two new lines in it.
    expect(actions).toEqual(['replace:line', 'replace:blank', 'replace:line'])
    expect(onenote.pages.get(pageId())!.html).not.toContain('نضيف الدجاج')
    expect(store.links.get(RECIPE.id)!.sync_status).toBe('synced')
  })

  it('does not upgrade a page whose sections use OneNote lists, and never writes those sections', async () => {
    await syncRecipe(RECIPE.id, deps)
    onenote.editByHand(pageId(), (html) =>
      html.replace(
        /(<div[^>]*data-id="hk-steps"[^>]*>)[\s\S]*?(<\/div>)/,
        '$1<h2>الطريقة</h2><ol><li>نحمر البصل</li><li>نضيف الدجاج</li></ol>$2',
      ),
    )
    await syncRecipe(RECIPE.id, deps) // the base now matches the page as it is
    store.links.get(RECIPE.id)!.template_version = 1
    onenote.patches = []
    const upgrade = await syncRecipe(RECIPE.id, deps)
    expect(upgrade).toMatchObject({ status: 'synced', pushed: [], needsRepair: ['steps'] })
    expect(onenote.patches).toEqual([])
    expect(store.links.get(RECIPE.id)!.template_version).toBe(1)

    // An app edit to another section is still written; the list section is left alone.
    store.editInApp(RECIPE.id, () => ({ notes: ['من التطبيق'] }))
    const edit = await syncRecipe(RECIPE.id, deps)
    expect(edit.pushed).toEqual(['notes'])
    expect(onenote.pages.get(pageId())!.html).toContain('<ol')
  })

  it('stops syncing a recipe whose page does not read back as written', async () => {
    await syncRecipe(RECIPE.id, deps)
    store.editInApp(RECIPE.id, () => ({ steps: ['خطوة'] }))
    // OneNote accepts the write but damages another section, as the range replace did in the probe.
    onenote.patchPage = async (id) => {
      onenote.editByHand(id, (html) => html.replace('بهارات أقل', ''))
    }
    const result = await syncRecipe(RECIPE.id, deps)
    expect(result.status).toBe('needs_review')
    expect(store.snapshots.map((s) => s.reason)).toEqual(['before-update', 'after-failed-check'])
    expect(store.recipes.get(RECIPE.id)!.sections.notes).toEqual(['بهارات أقل'])

    onenote.calls = []
    expect((await syncRecipe(RECIPE.id, deps)).status).toBe('needs_review')
    expect(onenote.calls).toEqual([])
  })

  it('reads but never writes while writes are paused', async () => {
    await syncRecipe(RECIPE.id, deps)
    store.editInApp(RECIPE.id, () => ({ steps: ['لن تُكتب'] }))
    const before = onenote.pages.get(pageId())!.html
    const result = await syncRecipe(RECIPE.id, { ...deps, writesPaused: true })
    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/paused/)
    expect(onenote.pages.get(pageId())!.html).toBe(before)
  })

  it('leaves a section holding a table for the owner instead of rewriting it', async () => {
    await syncRecipe(RECIPE.id, deps)
    onenote.editByHand(pageId(), (html) => html.replace('بهارات أقل\u202c</p>', 'بهارات أقل\u202c</p><table><tr><td>جدول</td></tr></table>'))
    await syncRecipe(RECIPE.id, deps)
    store.editInApp(RECIPE.id, () => ({ notes: ['من التطبيق'] }))
    onenote.patches = []
    const result = await syncRecipe(RECIPE.id, deps)
    expect(result.needsRepair).toEqual(['notes'])
    expect(onenote.patches).toEqual([])
  })

  it('never creates a second page when saving after creation fails', async () => {
    onenote.failNext = []
    const original = onenote.getPageMeta.bind(onenote)
    let first = true
    onenote.getPageMeta = async (id) => {
      if (first) {
        first = false
        throw new GraphError('flaky', 503, true)
      }
      return original(id)
    }
    expect((await syncRecipe(RECIPE.id, deps)).status).toBe('failed')
    await syncRecipe(RECIPE.id, deps)
    expect(onenote.pages.size).toBe(1)
  })
})
