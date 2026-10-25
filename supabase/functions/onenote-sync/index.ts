// OneNote sync actions for the signed-in user:
//   setup-test-notebook  create or find the Phase 0 test notebook and put it on the allow list
//   sync                 sync one recipe with its page
//   resolve              settle a conflicted section ('local' = keep the app's, 'remote' = keep OneNote's)
//   rtl-probe, patch-probe  Phase 0 experiments on throwaway pages in the test notebook

import { APP_URL, HttpError, adminClient, corsHeaders, json, oauthConfig, requireUser } from '../_shared/server/http.ts'
import { SupabaseSyncStore } from '../_shared/server/store.ts'
import { accessTokenProvider } from '../_shared/server/tokens.ts'
import { ReconnectRequiredError, resolveConflict, syncRecipe, type SyncDeps } from '../_shared/onenote/engine.ts'
import { GraphError, OneNoteClient } from '../_shared/onenote/graph.ts'
import { MERGE_KEYS, type MergeKey } from '../_shared/onenote/sections.ts'
import { ensureTestNotebook } from '../_shared/onenote/setup.ts'
import { buildRtlProbePages } from '../_shared/onenote/probe.ts'
import { runPatchProbe } from '../_shared/onenote/patchProbe.ts'
import type { SupabaseClient } from '@supabase/supabase-js'

// Switch for writing to existing pages. Off while a write method is being proven on throwaway
// pages; on since the line-by-line method passed probe round 5 (see _shared/onenote/patchProbe.ts).
const PAGE_WRITES_PAUSED = false

interface Body {
  action?: string
  recipeId?: string
  key?: string
  choice?: string
}

// Syncing can write into the recipe (pulling OneNote edits), so only owners and editors may run it.
async function assertCanEdit(admin: SupabaseClient, userId: string, recipeId: string): Promise<void> {
  const { data: recipe } = await admin.from('spike_recipes').select('household_id').eq('id', recipeId).maybeSingle()
  const { data: member } = recipe
    ? await admin.from('household_members').select('role').eq('household_id', recipe.household_id).eq('user_id', userId).maybeSingle()
    : { data: null }
  // Recipes outside the caller's household are reported as missing, not as forbidden.
  if (!recipe || !member) throw new HttpError(404, 'recipe not found', 'not_found')
  if (member.role === 'viewer') throw new HttpError(403, 'only the owner or an editor can sync', 'forbidden')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(req) })
  try {
    const { user } = await requireUser(req)
    const body = (await req.json().catch(() => ({}))) as Body
    const admin = adminClient()
    const graph = new OneNoteClient({ getAccessToken: accessTokenProvider(admin, user.id, oauthConfig()) })
    const deps: SyncDeps = {
      store: new SupabaseSyncStore(admin, user.id),
      graph,
      appUrl: (id) => `${APP_URL}/?recipe=${encodeURIComponent(id)}`,
      now: () => new Date(),
      writesPaused: PAGE_WRITES_PAUSED,
    }

    switch (body.action) {
      case 'setup-test-notebook': {
        const notebook = await ensureTestNotebook(graph)
        const { error } = await admin.from('onenote_allowed_notebooks').upsert(
          {
            user_id: user.id,
            notebook_id: notebook.notebookId,
            notebook_name: notebook.notebookName,
            default_section_id: notebook.defaultSectionId,
          },
          { onConflict: 'user_id,notebook_id' },
        )
        if (error) throw new Error(error.message)
        return json(req, notebook)
      }

      case 'sync': {
        if (!body.recipeId) throw new HttpError(400, 'recipeId is required', 'bad_request')
        await assertCanEdit(admin, user.id, body.recipeId)
        return json(req, await syncRecipe(body.recipeId, deps))
      }

      case 'resolve': {
        const key = body.key as MergeKey
        if (!body.recipeId || !MERGE_KEYS.includes(key) || (body.choice !== 'local' && body.choice !== 'remote')) {
          throw new HttpError(400, 'recipeId, key and choice (local or remote) are required', 'bad_request')
        }
        await assertCanEdit(admin, user.id, body.recipeId)
        return json(req, await resolveConflict(body.recipeId, key, body.choice, deps))
      }

      // Phase 0 experiment: write the RTL probe pages to the test notebook and keep OneNote's
      // output HTML for them and for the existing test recipe pages (which may hold hand-typed text).
      case 'rtl-probe': {
        const [notebook] = await deps.store.allowedNotebooks()
        if (!notebook?.defaultSectionId) throw new HttpError(409, 'create the test notebook first', 'no_test_notebook')
        const pages: Array<{ title: string; webUrl: string | null }> = []
        for (const probe of buildRtlProbePages()) {
          const created = await graph.createPage(notebook.defaultSectionId, probe.html)
          const output = await graph.getPageContent(created.id)
          await admin.from('onenote_snapshots').insert({ page_id: created.id, reason: `probe:${probe.title}`, html: output })
          pages.push({ title: probe.title, webUrl: created.webUrl })
        }
        const { data: links } = await admin.from('onenote_links').select('recipe_id,page_id').eq('user_id', user.id).not('page_id', 'is', null)
        for (const link of links ?? []) {
          const meta = await graph.getPageMeta(link.page_id)
          if (meta.notebookId !== notebook.notebookId) continue
          const output = await graph.getPageContent(link.page_id)
          await admin.from('onenote_snapshots').insert({ page_id: link.page_id, recipe_id: link.recipe_id, reason: 'probe:recipe-page', html: output })
        }
        return json(req, { pages })
      }

      // Phase 0 experiment: try each way of rewriting a section on a throwaway test page and keep
      // OneNote's answer and the page after each try.
      case 'patch-probe': {
        const [notebook] = await deps.store.allowedNotebooks()
        if (!notebook?.defaultSectionId) throw new HttpError(409, 'create the test notebook first', 'no_test_notebook')
        const { page, created, trials } = await runPatchProbe(graph, notebook.defaultSectionId)
        await admin.from('onenote_snapshots').insert({ page_id: page.id, reason: 'patch-probe:0:created', html: created })
        for (const [i, trial] of trials.entries()) {
          await admin.from('onenote_snapshots').insert({ page_id: page.id, reason: `patch-probe:${i + 1}:${trial.name}`, html: trial.htmlAfter })
        }
        return json(req, {
          webUrl: page.webUrl,
          trials: trials.map(({ htmlAfter: _html, ...trial }) => trial),
        })
      }

      default:
        throw new HttpError(400, `unknown action: ${body.action}`, 'bad_request')
    }
  } catch (error) {
    if (error instanceof HttpError) return json(req, { error: error.message, code: error.code }, error.status)
    if (error instanceof ReconnectRequiredError) return json(req, { error: error.message, code: 'needs_reconnect' }, 409)
    if (error instanceof GraphError) return json(req, { error: error.message, code: 'graph_error', status: error.status }, 502)
    console.error('onenote-sync failed', error)
    return json(req, { error: (error as Error).message, code: 'error' }, 500)
  }
})
