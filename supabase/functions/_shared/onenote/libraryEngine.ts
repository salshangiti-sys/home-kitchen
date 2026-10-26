// Working with the recipe notebook (وصفاتي): read-only, plus creating new pages.
//
// - connect: find the notebook by name and remember it and its sections.
// - refresh: read one recipe's page and take its text into the app (app-only fields stay).
// - check: list the notebook's pages; mark pages that are gone, list pages no recipe is linked to
//   yet (for the owner to add or link), and refresh the recipes read longest ago.
// - add / link: make a recipe from an unlisted page, or link a page to an existing recipe (for a
//   page that moved, which gives it a new id).
// - linkImported: link recipes imported from recipes.json to their pages by page_id.
// - createPage: create a new page from the app with the template, once.
//
// Every function takes a ReadCreateGraph, which has no way to change or delete a page.

import { GraphError, type PageMeta, type ReadCreateGraph } from './graph.ts'
import { readPage, recipeFromPage, sectionsOf } from './library.ts'
import type { RecipeDoc } from './recipeDoc.ts'
import { buildPageHtml } from './template.ts'

export interface LibrarySection {
  id: string
  name: string
}

export interface Library {
  notebookId: string
  notebookName: string
  sections: LibrarySection[]
  lastCheckedAt: string | null
}

export type ReadStatus = 'ok' | 'missing' | 'error'

export interface PageLink {
  recipeId: string
  pageId: string
  notebookId: string
  sectionId: string | null
  sectionName: string | null
  pageTitle: string | null
  webUrl: string | null
  clientUrl: string | null
  createdByApp: boolean
  readStatus: ReadStatus
  lastReadAt: string | null
  lastError: string | null
}

export interface UnlinkedPage {
  pageId: string
  title: string
  sectionId: string | null
  sectionName: string | null
  webUrl: string | null
}

export type SaveResult = { id: string; result: 'created' | 'updated' | 'unchanged' }

export interface LibraryStore {
  library(): Promise<Library | null>
  saveLibrary(library: Library): Promise<void>
  recipe(recipeId: string): Promise<{ doc: RecipeDoc; version: number } | null>
  // Raises on a version conflict; origin 'onenote' for text read from a page, 'app' otherwise.
  saveRecipe(doc: RecipeDoc, expectedVersion: number | null, origin: 'app' | 'onenote'): Promise<SaveResult>
  links(): Promise<PageLink[]>
  link(recipeId: string): Promise<PageLink | null>
  saveLink(link: PageLink): Promise<void>
  replaceUnlinked(pages: UnlinkedPage[]): Promise<void>
  removeUnlinked(pageId: string): Promise<void>
  // Recipes whose document names a OneNote page_id but that have no page link yet.
  importedWithoutLink(limit: number): Promise<Array<{ recipeId: string; pageId: string }>>
}

export class LibraryError extends Error {
  constructor(
    message: string,
    readonly code: 'not_linked' | 'notebook_not_found' | 'wrong_notebook' | 'unknown_section' | 'not_found',
  ) {
    super(message)
  }
}

export interface LibraryDeps {
  graph: ReadCreateGraph
  store: LibraryStore
  appUrl(recipeId: string): string | null
  now(): Date
}

const is404 = (error: unknown) => error instanceof GraphError && error.status === 404

async function requireLibrary(store: LibraryStore): Promise<Library> {
  const library = await store.library()
  if (!library) throw new LibraryError('the recipe notebook is not linked yet', 'not_linked')
  return library
}

const sectionName = (library: Library, sectionId: string | null) => library.sections.find((s) => s.id === sectionId)?.name ?? null

function linkFrom(recipeId: string, meta: PageMeta, library: Library, extra: Partial<PageLink> = {}): PageLink {
  return {
    recipeId,
    pageId: meta.id,
    notebookId: meta.notebookId ?? library.notebookId,
    sectionId: meta.sectionId,
    sectionName: sectionName(library, meta.sectionId),
    pageTitle: meta.title,
    webUrl: meta.webUrl,
    clientUrl: meta.clientUrl,
    createdByApp: false,
    readStatus: 'ok',
    lastReadAt: null,
    lastError: null,
    ...extra,
  }
}

export async function connectLibrary(deps: LibraryDeps, notebookName: string): Promise<Library> {
  const notebook = await deps.graph.findNotebook(notebookName)
  if (!notebook) throw new LibraryError(`no OneNote notebook named «${notebookName}»`, 'notebook_not_found')
  const sections = await deps.graph.listSections(notebook.id)
  const library: Library = {
    notebookId: notebook.id,
    notebookName: notebook.displayName,
    sections: sections.map((s) => ({ id: s.id, name: s.displayName })),
    lastCheckedAt: null,
  }
  await deps.store.saveLibrary(library)
  return library
}

export type RefreshOutcome = { status: ReadStatus; result: SaveResult['result'] | null; error: string | null }

// Reads the recipe's page and takes its text into the app. A page that is gone is marked missing;
// the recipe itself is never deleted.
export async function refreshRecipe(deps: LibraryDeps, recipeId: string): Promise<RefreshOutcome> {
  const { graph, store, now } = deps
  const library = await requireLibrary(store)
  const link = await store.link(recipeId)
  if (!link) throw new LibraryError('this recipe has no OneNote page', 'not_found')
  try {
    const meta = await graph.getPageMeta(link.pageId)
    if (meta.notebookId !== library.notebookId) {
      throw new LibraryError('the page is no longer in the recipe notebook', 'wrong_notebook')
    }
    const html = await graph.getPageContent(link.pageId)
    const current = await store.recipe(recipeId)
    if (!current) throw new LibraryError('recipe not found', 'not_found')
    const { doc } = readPage(current.doc, { title: meta.title, html })
    const saved = await store.saveRecipe(doc, current.version, 'onenote')
    await store.saveLink(linkFrom(recipeId, meta, library, { createdByApp: link.createdByApp, lastReadAt: now().toISOString() }))
    return { status: 'ok', result: saved.result, error: null }
  } catch (error) {
    const missing = is404(error) || (error instanceof LibraryError && error.code === 'wrong_notebook')
    const status: ReadStatus = missing ? 'missing' : 'error'
    const message = missing ? 'the page is not in the recipe notebook any more' : (error as Error).message
    await store.saveLink({ ...link, readStatus: status, lastError: message, lastReadAt: now().toISOString() })
    if (!missing && !(error instanceof GraphError) && !(error instanceof LibraryError)) throw error
    return { status, result: null, error: message }
  }
}

export interface CheckSummary {
  pages: number
  unlinked: number
  missing: string[]
  refreshed: number
  changed: number
}

// Lists every page of the notebook. Linked pages that are not listed are checked one by one (a
// page OneNote still returns stays linked); pages no recipe is linked to are kept for the owner's
// review; then the recipes read longest ago are refreshed, a few per check to stay well inside
// OneNote's request limits.
export async function checkLibrary(deps: LibraryDeps, refreshLimit = 10): Promise<CheckSummary> {
  const { graph, store, now } = deps
  const library = await requireLibrary(store)
  const sections = await graph.listSections(library.notebookId)
  const fresh: Library = { ...library, sections: sections.map((s) => ({ id: s.id, name: s.displayName })) }

  const pages: PageMeta[] = []
  for (const section of fresh.sections) pages.push(...(await graph.listSectionPages(section.id)))
  const listed = new Map(pages.map((page) => [page.id, page]))

  const links = await store.links()
  const linkedIds = new Set(links.map((link) => link.pageId))
  const missing: string[] = []
  for (const link of links) {
    if (listed.has(link.pageId)) continue
    try {
      const meta = await graph.getPageMeta(link.pageId)
      if (meta.notebookId === fresh.notebookId) continue
    } catch (error) {
      if (!is404(error)) throw error
    }
    missing.push(link.recipeId)
    await store.saveLink({ ...link, readStatus: 'missing', lastError: 'the page is not in the recipe notebook any more' })
  }

  const unlinked = pages
    .filter((page) => !linkedIds.has(page.id))
    .map((page) => ({ pageId: page.id, title: page.title, sectionId: page.sectionId, sectionName: sectionName(fresh, page.sectionId), webUrl: page.webUrl }))
  await store.replaceUnlinked(unlinked)

  const stale = links
    .filter((link) => !missing.includes(link.recipeId) && listed.has(link.pageId))
    .sort((a, b) => (a.lastReadAt ?? '').localeCompare(b.lastReadAt ?? ''))
    .slice(0, refreshLimit)
  let changed = 0
  for (const link of stale) {
    const outcome = await refreshRecipe(deps, link.recipeId)
    if (outcome.result === 'updated') changed += 1
  }

  await store.saveLibrary({ ...fresh, lastCheckedAt: now().toISOString() })
  return { pages: pages.length, unlinked: unlinked.length, missing, refreshed: stale.length, changed }
}

async function pageInLibrary(deps: LibraryDeps, library: Library, pageId: string): Promise<PageMeta> {
  const meta = await deps.graph.getPageMeta(pageId)
  if (meta.notebookId !== library.notebookId) throw new LibraryError('the page is not in the recipe notebook', 'wrong_notebook')
  return meta
}

// Makes a new recipe from a page that no recipe is linked to (the owner chose to add it).
export async function addPage(deps: LibraryDeps, pageId: string): Promise<string> {
  const { graph, store, now } = deps
  const library = await requireLibrary(store)
  const meta = await pageInLibrary(deps, library, pageId)
  const html = await graph.getPageContent(pageId)
  const doc = recipeFromPage({ id: meta.id, title: meta.title, html }, { notebook: library.notebookName, section: sectionName(library, meta.sectionId) ?? 'بدون قسم' })
  const saved = await store.saveRecipe(doc, null, 'onenote')
  await store.saveLink(linkFrom(saved.id, meta, library, { lastReadAt: now().toISOString() }))
  await store.removeUnlinked(pageId)
  return saved.id
}

// Links a page to an existing recipe (e.g. the page was moved in OneNote and got a new id), then
// reads it.
export async function linkPage(deps: LibraryDeps, pageId: string, recipeId: string): Promise<RefreshOutcome> {
  const { store } = deps
  const library = await requireLibrary(store)
  if (!(await store.recipe(recipeId))) throw new LibraryError('recipe not found', 'not_found')
  const meta = await pageInLibrary(deps, library, pageId)
  const previous = await store.link(recipeId)
  await store.saveLink(linkFrom(recipeId, meta, library, { createdByApp: previous?.createdByApp ?? false }))
  await store.removeUnlinked(pageId)
  return refreshRecipe(deps, recipeId)
}

// Links recipes imported from recipes.json to their pages, using the page_id in each record.
// Pages that are gone or outside the notebook are linked as missing, so they show up for review.
export async function linkImported(deps: LibraryDeps, limit = 25): Promise<{ linked: number; missing: number; remaining: boolean }> {
  const { graph, store } = deps
  const library = await requireLibrary(store)
  const pending = await store.importedWithoutLink(limit + 1)
  let linked = 0
  let missing = 0
  for (const { recipeId, pageId } of pending.slice(0, limit)) {
    try {
      const meta = await graph.getPageMeta(pageId)
      if (meta.notebookId !== library.notebookId) throw new LibraryError('outside the recipe notebook', 'wrong_notebook')
      await store.saveLink(linkFrom(recipeId, meta, library))
      await store.removeUnlinked(pageId)
      linked += 1
    } catch (error) {
      if (!is404(error) && !(error instanceof LibraryError)) throw error
      await store.saveLink({
        recipeId,
        pageId,
        notebookId: library.notebookId,
        sectionId: null,
        sectionName: null,
        pageTitle: null,
        webUrl: null,
        clientUrl: null,
        createdByApp: false,
        readStatus: 'missing',
        lastReadAt: null,
        lastError: 'the page_id from the import was not found in the recipe notebook',
      })
      missing += 1
    }
  }
  return { linked, missing, remaining: pending.length > limit }
}

// Creates a new page in the recipe notebook for a recipe written in the app, or an empty page
// with the template headings (blank) to fill in OneNote. The page is written once, here.
export async function createRecipePage(deps: LibraryDeps, input: { doc: RecipeDoc; sectionName: string; blank: boolean }): Promise<{ recipeId: string; webUrl: string | null; clientUrl: string | null }> {
  const { graph, store, now } = deps
  const library = await requireLibrary(store)
  const section = library.sections.find((s) => s.name === input.sectionName)
  if (!section) throw new LibraryError(`no section «${input.sectionName}» in «${library.notebookName}»`, 'unknown_section')

  const doc: RecipeDoc = {
    ...input.doc,
    category: { ...input.doc.category, notebook: library.notebookName, section: section.name },
  }
  const saved = await store.saveRecipe(doc, null, 'app')
  const html = buildPageHtml({ recipeId: saved.id, title: doc.title, sections: sectionsOf(doc), appUrl: deps.appUrl(saved.id), blankLines: input.blank })
  const meta = await graph.createPage(section.id, html)
  await store.saveLink(linkFrom(saved.id, { ...meta, notebookId: library.notebookId, sectionId: section.id }, library, { createdByApp: true, lastReadAt: now().toISOString() }))

  // Record where the page is in the recipe itself, so an export carries it, and take the page's
  // text as the recipe's text, as a later read would.
  const stored = await store.recipe(saved.id)
  if (stored) {
    const onenote = { notebook: library.notebookName, section: section.name, page_id: meta.id, created: now().toISOString() }
    const { doc: read } = readPage(stored.doc, { title: doc.title, html })
    await store.saveRecipe({ ...read, onenote }, stored.version, 'app')
  }
  return { recipeId: saved.id, webUrl: meta.webUrl, clientUrl: meta.clientUrl }
}
