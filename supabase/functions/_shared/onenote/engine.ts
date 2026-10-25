// Syncs one recipe with its OneNote page: create the page if needed, otherwise three-way merge
// section by section, write back only what the app changed, and record conflicts instead of
// overwriting. The store and the Graph client are injected so the whole flow runs in tests
// against a simulated OneNote.

import { GraphError, NotAllowedError, assertWritable, type PageMeta, type PatchCommand } from './graph.ts'
import { planMerge } from './merge.ts'
import { parsePageHtml, type FoundBy } from './parse.ts'
import { MERGE_KEYS, SECTION_KEYS, sameValue, valueOf, withValue, type MergeKey, type PageState, type RecipeSections, type SectionKey } from './sections.ts'
import { REF_DATA_ID, SECTION_DATA_ID, TEMPLATE_VERSION, buildPageHtml, buildRefHtml, buildSectionHtml, escapeHtml, refLine, sectionLines } from './template.ts'
import { ReconnectRequiredError } from './errors.ts'
import { UnsupportedContentError, linesOnPage, planLineWrite, type PageLine } from './lineWriter.ts'

export { ReconnectRequiredError }

export type SyncStatus = 'synced' | 'pending' | 'failed' | 'conflict' | 'remote_deleted' | 'needs_reconnect' | 'needs_review'

// Writing was switched off (Phase 0: while a write method is being proven on throwaway pages).
export class WritesPausedError extends Error {
  constructor() {
    super('writing to OneNote is paused; nothing was changed')
    this.name = 'WritesPausedError'
  }
}

// The page read back after a write differs from what it should hold.
export class PageCheckError extends Error {
  constructor(readonly mismatched: string[]) {
    super(`after writing, the OneNote page did not read back as expected (${mismatched.join(', ')}); syncing this recipe is stopped until the page is checked`)
    this.name = 'PageCheckError'
  }
}

export interface RecipeRow {
  id: string
  title: string
  sections: RecipeSections
  version: number
}

export interface LinkRow {
  recipe_id: string
  notebook_id: string
  section_id: string
  page_id: string | null
  web_url: string | null
  client_url: string | null
  template_version: number
  sync_status: SyncStatus
  base_sections: PageState | null
  remote_last_modified: string | null
  last_synced_at: string | null
  parse_method: string | null
  last_error: string | null
  retry_count: number
  next_retry_at: string | null
}

export interface AllowedNotebook {
  notebookId: string
  defaultSectionId: string | null
}

export interface ConflictInput {
  key: MergeKey
  base: unknown
  local: unknown
  remote: unknown
}

export interface SyncStore {
  getRecipe(recipeId: string): Promise<RecipeRow | null>
  // Writes the merged page back only if the recipe still has expectedVersion; false otherwise.
  updateRecipe(recipeId: string, expectedVersion: number, state: PageState): Promise<boolean>
  getLink(recipeId: string): Promise<LinkRow | null>
  saveLink(link: LinkRow): Promise<void>
  // Replaces any open conflict for the same section, so repeated syncs never pile up duplicates.
  addConflicts(recipeId: string, conflicts: ConflictInput[]): Promise<void>
  getOpenConflict(recipeId: string, key: MergeKey): Promise<{ id: string; remote: unknown } | null>
  markConflictResolved(conflictId: string, resolution: 'local' | 'remote'): Promise<void>
  saveSnapshot(pageId: string, recipeId: string, reason: string, html: string): Promise<void>
  allowedNotebooks(): Promise<AllowedNotebook[]>
}

export interface PageGraph {
  getPageMeta(pageId: string): Promise<PageMeta>
  getPageContent(pageId: string): Promise<string>
  createPage(sectionId: string, html: string): Promise<PageMeta>
  patchPage(pageId: string, commands: PatchCommand[]): Promise<void>
}

export interface SyncDeps {
  store: SyncStore
  graph: PageGraph
  appUrl(recipeId: string): string | null
  now(): Date
  // When set, existing pages are read and merged but never written to.
  writesPaused?: boolean
}

export interface SyncOutcome {
  status: SyncStatus
  created: boolean
  pushed: MergeKey[]
  pulled: MergeKey[]
  conflicts: MergeKey[]
  // Sections the app needed to write but cannot (found only by their heading, or holding OneNote
  // lists, tables, images or ink): read, but not rewritten until the page is repaired.
  needsRepair: SectionKey[]
  error: string | null
}

function outcome(status: SyncStatus, partial: Partial<SyncOutcome> = {}): SyncOutcome {
  return { status, created: false, pushed: [], pulled: [], conflicts: [], needsRepair: [], error: null, ...partial }
}

const toState = (recipe: RecipeRow): PageState => ({ title: recipe.title, sections: recipe.sections })

// Retry delay for the next scheduled attempt: 1, 2, 4 ... minutes, capped at an hour.
export function nextRetryAt(now: Date, retryCount: number): string {
  const minutes = Math.min(2 ** retryCount, 60)
  return new Date(now.getTime() + minutes * 60_000).toISOString()
}

function summarizeFoundBy(foundBy: Record<SectionKey, FoundBy>): string {
  return SECTION_KEYS.map((key) => `${key}:${foundBy[key]}`).join(',')
}

export async function syncRecipe(recipeId: string, deps: SyncDeps): Promise<SyncOutcome> {
  const { store, now } = deps
  const recipe = await store.getRecipe(recipeId)
  if (!recipe) return outcome('failed', { error: 'recipe not found' })

  const allowed = await store.allowedNotebooks()
  const allowedIds = allowed.map((n) => n.notebookId)
  const existing = await store.getLink(recipeId)
  const link: LinkRow = existing ?? {
    recipe_id: recipeId,
    notebook_id: allowed[0]?.notebookId ?? '',
    section_id: allowed[0]?.defaultSectionId ?? '',
    page_id: null,
    web_url: null,
    client_url: null,
    template_version: TEMPLATE_VERSION,
    sync_status: 'pending',
    base_sections: null,
    remote_last_modified: null,
    last_synced_at: null,
    parse_method: null,
    last_error: null,
    retry_count: 0,
    next_retry_at: null,
  }

  // A page that failed its read-back check is left alone until someone has looked at it: syncing
  // it again could pull damaged text into the app as if it were an edit.
  if (link.sync_status === 'needs_review') return outcome('needs_review', { error: link.last_error })

  try {
    if (!link.page_id) return await createPage(recipe, link, allowedIds, deps)
    return await updatePage(recipe, link, allowedIds, deps)
  } catch (error) {
    const failed = async (status: SyncStatus, message: string, retry: boolean) => {
      // Re-read the link: the failed run may already have saved a new page id that must be kept.
      const latest = (await store.getLink(recipeId)) ?? link
      const retryCount = retry ? latest.retry_count + 1 : latest.retry_count
      await store.saveLink({
        ...latest,
        sync_status: status,
        last_error: message,
        retry_count: retryCount,
        next_retry_at: retry ? nextRetryAt(now(), retryCount) : null,
      })
      return outcome(status, { error: message })
    }
    if (error instanceof ReconnectRequiredError) return failed('needs_reconnect', error.message, false)
    if (error instanceof PageCheckError) return failed('needs_review', error.message, false)
    if (error instanceof NotAllowedError || error instanceof WritesPausedError || error instanceof UnsupportedContentError) {
      return failed('failed', error.message, false)
    }
    if (error instanceof GraphError) {
      if (error.status === 404) return failed('remote_deleted', 'the OneNote page no longer exists', false)
      // Keep OneNote's own explanation (its error code and message) so failures can be diagnosed.
      const detail = error.body ? ` — ${error.body.replace(/\s+/g, ' ').slice(0, 400)}` : ''
      return failed('failed', `${error.message}${detail}`, error.retryable)
    }
    throw error
  }
}

async function createPage(recipe: RecipeRow, link: LinkRow, allowedIds: string[], deps: SyncDeps): Promise<SyncOutcome> {
  const { store, graph, now } = deps
  assertWritable(link.notebook_id || null, allowedIds)
  if (!link.section_id) throw new NotAllowedError(link.notebook_id)

  const html = buildPageHtml({ recipeId: recipe.id, title: recipe.title, sections: recipe.sections, appUrl: deps.appUrl(recipe.id) })
  const created = await graph.createPage(link.section_id, html)
  // Save the page id straight away so a later failure can never create a second page.
  const withPage: LinkRow = { ...link, page_id: created.id, web_url: created.webUrl, client_url: created.clientUrl }
  await store.saveLink({ ...withPage, sync_status: 'pending' })

  const meta = await graph.getPageMeta(created.id)
  await store.saveLink({
    ...withPage,
    template_version: TEMPLATE_VERSION,
    sync_status: 'synced',
    base_sections: toState(recipe),
    remote_last_modified: meta.lastModifiedDateTime,
    last_synced_at: now().toISOString(),
    parse_method: 'created',
    last_error: null,
    retry_count: 0,
    next_retry_at: null,
  })
  return outcome('synced', { created: true, pushed: [...MERGE_KEYS] })
}

async function updatePage(recipe: RecipeRow, link: LinkRow, allowedIds: string[], deps: SyncDeps): Promise<SyncOutcome> {
  const { store, graph, now } = deps
  const pageId = link.page_id!
  const meta = await graph.getPageMeta(pageId)
  const local = toState(recipe)
  const base = link.base_sections
  // A page written with an older template is rewritten section by section in the current one.
  let upgrading = link.template_version < TEMPLATE_VERSION

  // The page content is always read: in Phase 0 the page's lastModifiedDateTime stayed the same
  // after both an app write and a hand edit in OneNote on the web, so it cannot tell whether the
  // page changed. It is still stored, for diagnosis only.
  const html = await graph.getPageContent(pageId)
  const parsed = parsePageHtml(html)
  const remote: PageState = { title: parsed.title || meta.title, sections: parsed.sections }
  const plan = planMerge(base, local, remote, parsed.foundBy)

  let wanted: MergeKey[] = upgrading ? MERGE_KEYS.filter((key) => key !== 'title' || plan.toPush.includes(key)) : plan.toPush
  // Each section's lines as they are on the page (null: the section is gone). A section found only
  // by its heading, or holding content the app does not rewrite (OneNote lists, tables, images,
  // ink), is read but not written: it waits for the page to be repaired.
  const pageLines = new Map<SectionKey, PageLine[] | null>()
  const blocked: SectionKey[] = []
  for (const key of SECTION_KEYS) {
    if (!wanted.includes(key)) continue
    if (parsed.foundBy[key] === 'heading') {
      blocked.push(key)
      continue
    }
    try {
      pageLines.set(key, linesOnPage(html, SECTION_DATA_ID[key]))
    } catch (error) {
      if (!(error instanceof UnsupportedContentError)) throw error
      blocked.push(key)
    }
  }
  // A page is upgraded whole or not at all: with a section that cannot be written (OneNote lists,
  // say), only the app's own edits are written and the page keeps its older template.
  if (upgrading && blocked.length) {
    upgrading = false
    wanted = plan.toPush
  }
  const needsRepair = blocked.filter((key) => wanted.includes(key))
  const toPush = wanted.filter((key) => !plan.conflicts.includes(key) && !needsRepair.includes(key as SectionKey))
  let nextBase = plan.nextBase
  for (const key of needsRepair) nextBase = withValue(nextBase, key, valueOf(key, base ?? remote))

  if (plan.toPull.length) {
    const saved = await store.updateRecipe(recipe.id, recipe.version, plan.merged)
    if (!saved) {
      // The recipe changed in the app while we were merging; leave everything for the next run.
      await store.saveLink({ ...link, sync_status: 'pending' })
      return outcome('pending', { error: 'recipe changed during sync; will retry' })
    }
  }

  if (plan.conflicts.length) {
    await store.addConflicts(
      recipe.id,
      plan.conflicts.map((key) => ({
        key,
        base: base ? valueOf(key, base) : null,
        local: valueOf(key, local),
        remote: valueOf(key, remote),
      })),
    )
  }

  let lastModified = meta.lastModifiedDateTime
  const refCommands = upgrading ? refWrite(html, recipe.id, deps) : []
  if (toPush.length || refCommands.length) {
    assertWritable(meta.notebookId, allowedIds)
    if (deps.writesPaused) throw new WritesPausedError()
    await store.saveSnapshot(pageId, recipe.id, 'before-update', html)
    // One request per section, each changing single lines of that section only.
    for (const key of toPush) {
      if (key === 'title') {
        await graph.patchPage(pageId, [{ target: 'title', action: 'replace', content: escapeHtml(plan.merged.title) }])
        continue
      }
      const lines = pageLines.get(key) ?? null
      // A section deleted in OneNote is written back whole at the end of the page.
      if (lines === null) await graph.patchPage(pageId, [{ target: 'body', action: 'append', content: buildSectionHtml(key, plan.merged.sections) }])
      else {
        const commands = planLineWrite(SECTION_DATA_ID[key], lines, sectionLines(key, plan.merged.sections), upgrading)
        if (commands.length) await graph.patchPage(pageId, commands)
      }
    }
    if (refCommands.length) await graph.patchPage(pageId, refCommands)

    // Read the whole page back: the written sections must hold the new text and everything else
    // must be as it was. Anything else stops syncing this recipe until the page is checked.
    const after = await graph.getPageContent(pageId)
    const expected = toPush.reduce((state, key) => withValue(state, key, valueOf(key, plan.merged)), remote)
    const reread = parsePageHtml(after)
    const mismatched: string[] = MERGE_KEYS.filter((key) => !sameValue(key, { title: reread.title, sections: reread.sections }, expected))
    const expectedMarker = upgrading ? recipe.id : parsed.recipeIdMarker
    if (reread.recipeIdMarker !== expectedMarker) mismatched.push('ref')
    if (mismatched.length) {
      await store.saveSnapshot(pageId, recipe.id, 'after-failed-check', after)
      throw new PageCheckError(mismatched)
    }
    lastModified = (await graph.getPageMeta(pageId)).lastModifiedDateTime
  }

  const status: SyncStatus = plan.conflicts.length ? 'conflict' : 'synced'
  const upgraded = upgrading && !plan.conflicts.length
  await store.saveLink({
    ...link,
    template_version: upgraded ? TEMPLATE_VERSION : link.template_version,
    web_url: meta.webUrl ?? link.web_url,
    client_url: meta.clientUrl ?? link.client_url,
    sync_status: status,
    base_sections: nextBase,
    remote_last_modified: lastModified,
    last_synced_at: now().toISOString(),
    parse_method: summarizeFoundBy(parsed.foundBy),
    last_error: null,
    retry_count: 0,
    next_retry_at: null,
  })
  return outcome(status, { pushed: toPush, pulled: plan.toPull, conflicts: plan.conflicts, needsRepair: blocked })
}

// The recipe-id line in the current template (used when upgrading an older page).
function refWrite(html: string, recipeId: string, deps: SyncDeps): PatchCommand[] {
  let lines: PageLine[] | null
  try {
    lines = linesOnPage(html, REF_DATA_ID)
  } catch (error) {
    if (error instanceof UnsupportedContentError) return []
    throw error
  }
  if (lines === null) return [{ target: 'body', action: 'append', content: buildRefHtml(recipeId, deps.appUrl(recipeId)) }]
  return planLineWrite(REF_DATA_ID, lines, [refLine(recipeId, deps.appUrl(recipeId))], true)
}

// The owner picked a side for a conflicted section. Choosing OneNote copies its value into the
// app; choosing the app makes OneNote's value the base, so the next sync pushes the app's value.
export async function resolveConflict(
  recipeId: string,
  key: MergeKey,
  choice: 'local' | 'remote',
  deps: SyncDeps,
): Promise<SyncOutcome> {
  const { store } = deps
  const conflict = await store.getOpenConflict(recipeId, key)
  const recipe = await store.getRecipe(recipeId)
  const link = await store.getLink(recipeId)
  if (!conflict || !recipe || !link?.base_sections) return outcome('failed', { error: 'no open conflict for this section' })

  if (choice === 'remote') {
    const saved = await store.updateRecipe(recipeId, recipe.version, withValue(toState(recipe), key, conflict.remote))
    if (!saved) return outcome('pending', { error: 'recipe changed meanwhile; try again' })
  }
  await store.saveLink({ ...link, base_sections: withValue(link.base_sections, key, conflict.remote) })
  await store.markConflictResolved(conflict.id, choice)
  return syncRecipe(recipeId, deps)
}
