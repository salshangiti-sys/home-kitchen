import { beforeEach, describe, expect, it } from 'vitest'
import { FakeOneNote } from './fakeOneNote.ts'
import {
  addPage,
  checkLibrary,
  connectLibrary,
  createRecipePage,
  linkImported,
  linkPage,
  refreshRecipe,
  type Library,
  type LibraryDeps,
  type LibraryStore,
  type PageLink,
  type UnlinkedPage,
} from './libraryEngine.ts'
import type { RecipeDoc } from './recipeDoc.ts'

class MemoryStore implements LibraryStore {
  lib: Library | null = null
  recipes = new Map<string, { doc: RecipeDoc; version: number }>()
  pageLinks = new Map<string, PageLink>()
  unlinked: UnlinkedPage[] = []
  saves: Array<{ id: string; origin: string }> = []
  private seq = 0

  async library() {
    return this.lib
  }
  async saveLibrary(library: Library) {
    this.lib = library
  }
  async recipe(id: string) {
    const found = this.recipes.get(id)
    return found ? structuredClone(found) : null
  }
  async saveRecipe(doc: RecipeDoc, expectedVersion: number | null, origin: 'app' | 'onenote') {
    const id = doc.id || `recipe-${String(++this.seq).padStart(3, '0')}`
    const current = this.recipes.get(id)
    if (current && expectedVersion !== current.version) throw new Error('version_conflict')
    this.saves.push({ id, origin })
    const next = { ...doc, id }
    if (current && JSON.stringify(current.doc) === JSON.stringify(next)) return { id, result: 'unchanged' as const }
    this.recipes.set(id, { doc: next, version: (current?.version ?? 0) + 1 })
    return { id, result: current ? ('updated' as const) : ('created' as const) }
  }
  async links() {
    return [...this.pageLinks.values()]
  }
  async link(id: string) {
    return this.pageLinks.get(id) ?? null
  }
  async saveLink(link: PageLink) {
    this.pageLinks.set(link.recipeId, link)
  }
  async replaceUnlinked(pages: UnlinkedPage[]) {
    this.unlinked = pages
  }
  async removeUnlinked(pageId: string) {
    this.unlinked = this.unlinked.filter((page) => page.pageId !== pageId)
  }
  async importedWithoutLink(limit: number) {
    return [...this.recipes.values()]
      .filter(({ doc }) => doc.onenote?.page_id && !this.pageLinks.has(doc.id))
      .slice(0, limit)
      .map(({ doc }) => ({ recipeId: doc.id, pageId: doc.onenote!.page_id! }))
  }
}

const page = (title: string, body: string) => `<html><head><title>${title}</title></head><body><div data-id="_default">${body}</div></body></html>`
const HAND_MADE = page('كبسة دجاج', '<p><b>المقادير</b></p><ul><li>2 كوب رز</li><li>دجاج</li></ul><p><b>الطريقة</b></p><ol><li>نحمر البصل</li></ol>')

const NEW_DOC: RecipeDoc = {
  id: '',
  title: 'كبسة تونا',
  language: 'ar',
  status: 'link_only',
  category: { notebook: 'وصفاتي', section: 'أرز' },
  sources: [{ url: 'https://www.instagram.com/reel/DOqEOzAjZQO/', platform: 'instagram' }],
  ingredient_groups: [],
  steps: [],
  notes: [],
  tags: { meal_types: ['lunch'], kid_friendly: null, lunchbox: null, custom: [] },
  onenote: { notebook: 'وصفاتي', section: 'أرز', page_id: null, created: null },
  flags: [],
  raw_text: '',
}

let onenote: FakeOneNote
let store: MemoryStore
let deps: LibraryDeps

beforeEach(() => {
  onenote = new FakeOneNote(
    { 'sec-rice': 'nb-real', 'sec-sweets': 'nb-real', 'sec-other': 'nb-other' },
    { 'nb-real': 'وصفاتي', 'sec-rice': 'أرز', 'sec-sweets': 'حلويات', 'nb-other': 'ملاحظات', 'sec-other': 'عام' },
  )
  store = new MemoryStore()
  let tick = 0
  deps = { graph: onenote, store, appUrl: (id) => `https://app.example/#/recipe/${id}`, now: () => new Date(Date.UTC(2026, 9, 26, 12, 0, tick++)) }
})

describe('the recipe notebook is read and created in, never edited', () => {
  it('connects to the notebook by name and lists its sections', async () => {
    const library = await connectLibrary(deps, 'وصفاتي')
    expect(library).toMatchObject({ notebookId: 'nb-real', sections: [{ id: 'sec-rice', name: 'أرز' }, { id: 'sec-sweets', name: 'حلويات' }] })
    await expect(connectLibrary(deps, 'وصفات أخرى')).rejects.toMatchObject({ code: 'notebook_not_found' })
  })

  it('lists pages no recipe is linked to, and adds one as a recipe flagged for review', async () => {
    await connectLibrary(deps, 'وصفاتي')
    const created = await onenote.createPage('sec-rice', HAND_MADE)
    await onenote.createPage('sec-other', page('ليست وصفة', '<p>نص</p>'))

    const summary = await checkLibrary(deps)
    expect(summary).toMatchObject({ pages: 1, unlinked: 1, missing: [] })
    expect(store.unlinked).toEqual([expect.objectContaining({ pageId: created.id, title: 'كبسة دجاج', sectionName: 'أرز' })])

    const recipeId = await addPage(deps, created.id)
    const { doc } = (await store.recipe(recipeId))!
    expect(doc).toMatchObject({ title: 'كبسة دجاج', status: 'complete', category: { section: 'أرز' }, flags: ['added_from_onenote'] })
    expect(doc.steps).toEqual([{ order: 1, text: 'نحمر البصل' }])
    expect(store.unlinked).toEqual([])
    expect((await store.link(recipeId))!.pageId).toBe(created.id)
    await expect(addPage(deps, (await onenote.createPage('sec-other', HAND_MADE)).id)).rejects.toMatchObject({ code: 'wrong_notebook' })
  })

  it('takes a change made in OneNote into the recipe and keeps the app fields', async () => {
    await connectLibrary(deps, 'وصفاتي')
    const created = await onenote.createPage('sec-rice', HAND_MADE)
    const recipeId = await addPage(deps, created.id)
    const stored = store.recipes.get(recipeId)!
    stored.doc.tags = { meal_types: ['dinner'], kid_friendly: true, lunchbox: null, custom: ['سريع'] }

    onenote.editByHand(created.id, (html) => html.replace(/>دجاج</, '>صدر دجاج<'))
    const outcome = await refreshRecipe(deps, recipeId)
    expect(outcome).toEqual({ status: 'ok', result: 'updated', error: null })
    const { doc } = (await store.recipe(recipeId))!
    expect(doc.ingredient_groups[0].items.map((i) => i.text)).toEqual(['2 كوب رز', 'صدر دجاج'])
    expect(doc.tags?.custom).toEqual(['سريع'])
    expect(store.saves.at(-1)).toEqual({ id: recipeId, origin: 'onenote' })
    expect(await refreshRecipe(deps, recipeId)).toMatchObject({ result: 'unchanged' })
  })

  it('marks a deleted page missing and keeps the recipe; a moved page can be linked again', async () => {
    await connectLibrary(deps, 'وصفاتي')
    const created = await onenote.createPage('sec-rice', HAND_MADE)
    const recipeId = await addPage(deps, created.id)

    const movedId = onenote.movePage(created.id, 'sec-sweets')
    const summary = await checkLibrary(deps)
    expect(summary.missing).toEqual([recipeId])
    expect((await store.link(recipeId))!.readStatus).toBe('missing')
    expect(store.recipes.has(recipeId)).toBe(true)
    expect(store.unlinked.map((p) => p.pageId)).toEqual([movedId])

    expect(await linkPage(deps, movedId, recipeId)).toMatchObject({ status: 'ok' })
    expect(await store.link(recipeId)).toMatchObject({ pageId: movedId, sectionName: 'حلويات', readStatus: 'ok' })
    expect(store.unlinked).toEqual([])

    onenote.pages.delete(movedId)
    expect(await refreshRecipe(deps, recipeId)).toMatchObject({ status: 'missing' })
    expect(store.recipes.has(recipeId)).toBe(true)
  })

  it('refreshes the recipes read longest ago, a few per check', async () => {
    await connectLibrary(deps, 'وصفاتي')
    const ids: string[] = []
    for (const title of ['أ', 'ب', 'ج']) ids.push(await addPage(deps, (await onenote.createPage('sec-rice', page(title, '<p>نص</p>'))).id))
    onenote.calls = []
    const summary = await checkLibrary(deps, 2)
    expect(summary.refreshed).toBe(2)
    expect(onenote.calls.filter((call) => call === 'getPageContent')).toHaveLength(2)
    const read = await Promise.all(ids.map(async (id) => (await store.link(id))!.lastReadAt))
    expect(read[2]! < read[0]!).toBe(true) // the third one was not read this time
  })

  it('creates a blank page with the template once, and links it', async () => {
    await connectLibrary(deps, 'وصفاتي')
    const created = await createRecipePage(deps, { doc: NEW_DOC, sectionName: 'أرز', blank: true })
    expect(created.webUrl).toMatch(/onenote\.example/)
    const link = (await store.link(created.recipeId))!
    expect(link).toMatchObject({ createdByApp: true, sectionName: 'أرز', readStatus: 'ok' })
    const html = onenote.pages.get(link.pageId)!.html
    for (const heading of ['المصدر', 'المقادير', 'الطريقة', 'ملاحظاتي']) expect(html).toContain(heading)
    expect(html).toContain('instagram.com/reel/DOqEOzAjZQO')
    expect(html).toContain(`معرّف الوصفة: ${created.recipeId}`)
    expect(onenote.calls.filter((call) => call === 'createPage')).toHaveLength(1)

    const { doc } = (await store.recipe(created.recipeId))!
    expect(doc.onenote).toMatchObject({ page_id: link.pageId, section: 'أرز' })
    // Reading the new page back changes nothing.
    expect(await refreshRecipe(deps, created.recipeId)).toMatchObject({ result: 'unchanged' })
    await expect(createRecipePage(deps, { doc: NEW_DOC, sectionName: 'غير موجود', blank: true })).rejects.toMatchObject({ code: 'unknown_section' })
  })

  it('links imported recipes by their page_id, marking the ones not found', async () => {
    await connectLibrary(deps, 'وصفاتي')
    const created = await onenote.createPage('sec-rice', HAND_MADE)
    const outside = await onenote.createPage('sec-other', HAND_MADE)
    for (const [id, pageId] of [['rice-001', created.id], ['rice-002', 'gone'], ['rice-003', outside.id]]) {
      store.recipes.set(id, { doc: { ...NEW_DOC, id, onenote: { notebook: 'وصفاتي', section: 'أرز', page_id: pageId, created: null } }, version: 1 })
    }
    expect(await linkImported(deps, 2)).toEqual({ linked: 1, missing: 1, remaining: true })
    expect(await linkImported(deps, 2)).toEqual({ linked: 0, missing: 1, remaining: false })
    expect((await store.link('rice-001'))!.readStatus).toBe('ok')
    expect((await store.link('rice-002'))!.readStatus).toBe('missing')
    expect((await store.link('rice-003'))!.readStatus).toBe('missing')
  })

  it('never calls anything but reads and page creation', async () => {
    await connectLibrary(deps, 'وصفاتي')
    const created = await onenote.createPage('sec-rice', HAND_MADE)
    const recipeId = await addPage(deps, created.id)
    await refreshRecipe(deps, recipeId)
    await checkLibrary(deps)
    await createRecipePage(deps, { doc: NEW_DOC, sectionName: 'حلويات', blank: false })
    expect(onenote.patches).toEqual([])
    expect(new Set(onenote.calls)).toEqual(new Set(['findNotebook', 'listSections', 'listSectionPages', 'getPageMeta', 'getPageContent', 'createPage']))
  })
})
