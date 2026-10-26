// The recipe library in OneNote (a notebook or section group; the owner's is «الطبخ»), read-only
// plus new pages, for the signed-in owner or editor:
//   places         the account's notebooks and section groups, to choose the library from
//   connect        link the household to one of them (reads its sections)
//   refresh        read one recipe's page into the app
//   check          list the notebook's pages: new ones for review, gone ones, refresh a few
//   add-page       make a recipe from a page in the review list
//   link-page      link a page to an existing recipe (e.g. after the page moved)
//   link-imported  link recipes imported from recipes.json to their pages by page_id
//   create-page    create a new page with the template for a recipe written in the app (or blank)
//
// OneNote is reached only through readCreateOnly(), which has no method that changes or deletes
// an existing page.

import { APP_URL, HttpError, adminClient, corsHeaders, json, oauthConfig, requireUser } from '../_shared/server/http.ts'
import { SupabaseLibraryStore } from '../_shared/server/libraryStore.ts'
import { accessTokenProvider } from '../_shared/server/tokens.ts'
import { ReconnectRequiredError } from '../_shared/onenote/errors.ts'
import { GraphError, OneNoteClient, readCreateOnly } from '../_shared/onenote/graph.ts'
import {
  LibraryError,
  libraryLabel,
  addPage,
  checkLibrary,
  connectLibrary,
  createRecipePage,
  linkImported,
  linkPage,
  refreshRecipe,
  type LibraryDeps,
} from '../_shared/onenote/libraryEngine.ts'
import type { RecipeDoc } from '../_shared/onenote/recipeDoc.ts'

interface Body {
  action?: string
  placeId?: string
  recipeId?: string
  pageId?: string
  doc?: RecipeDoc
  sectionName?: string
  blank?: boolean
}

const required = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${name} is required`, 'bad_request')
  return value
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(req) })
  try {
    const { user, userClient } = await requireUser(req)
    const body = (await req.json().catch(() => ({}))) as Body
    const admin = adminClient()

    // Everything here can change recipes, so viewers are turned away.
    const { data: member } = await admin
      .from('household_members')
      .select('household_id')
      .eq('user_id', user.id)
      .in('role', ['owner', 'editor'])
      .order('created_at')
      .limit(1)
      .maybeSingle()
    if (!member) throw new HttpError(403, 'only the owner or an editor can do this', 'forbidden')

    // The notebook is read with the Microsoft account of whoever linked it.
    const { data: linked } = await admin.from('onenote_library').select('user_id').eq('household_id', member.household_id).maybeSingle()
    const tokenUser = body.action === 'connect' || body.action === 'places' || !linked ? user.id : linked.user_id
    const client = new OneNoteClient({ getAccessToken: accessTokenProvider(admin, tokenUser, oauthConfig()) })
    const deps: LibraryDeps = {
      graph: readCreateOnly(client),
      store: new SupabaseLibraryStore(admin, userClient, member.household_id, user.id),
      appUrl: (id) => `${APP_URL}/#/r/${encodeURIComponent(id)}`,
      now: () => new Date(),
    }

    switch (body.action) {
      case 'places':
        return json(
          req,
          (await deps.graph.listPlaces()).map((place) => ({
            id: place.id,
            kind: place.kind,
            label: libraryLabel({ notebookName: place.notebookName, sectionGroup: place.groupPath.join(' › ') || null }),
          })),
        )
      case 'connect': {
        const library = await connectLibrary(deps, required(body.placeId, 'placeId'))
        return json(req, { label: libraryLabel(library), sections: library.sections.length })
      }
      case 'refresh':
        return json(req, await refreshRecipe(deps, required(body.recipeId, 'recipeId')))
      case 'check':
        try {
          return json(req, await checkLibrary(deps))
        } catch (error) {
          await admin.from('onenote_library').update({ last_error: (error as Error).message }).eq('household_id', member.household_id)
          throw error
        }
      case 'add-page':
        return json(req, { recipeId: await addPage(deps, required(body.pageId, 'pageId')) })
      case 'link-page':
        return json(req, await linkPage(deps, required(body.pageId, 'pageId'), required(body.recipeId, 'recipeId')))
      case 'link-imported':
        return json(req, await linkImported(deps))
      case 'create-page': {
        if (!body.doc || typeof body.doc !== 'object') throw new HttpError(400, 'doc is required', 'bad_request')
        const doc = { ...body.doc, id: '' } // always a new recipe
        return json(req, await createRecipePage(deps, { doc, sectionName: required(body.sectionName, 'sectionName'), blank: body.blank === true }))
      }
      default:
        throw new HttpError(400, `unknown action: ${body.action}`, 'bad_request')
    }
  } catch (error) {
    if (error instanceof HttpError) return json(req, { error: error.message, code: error.code }, error.status)
    if (error instanceof LibraryError) return json(req, { error: error.message, code: error.code }, error.code === 'not_found' ? 404 : 409)
    if (error instanceof ReconnectRequiredError) return json(req, { error: error.message, code: 'needs_reconnect' }, 409)
    if (error instanceof GraphError) return json(req, { error: error.message, code: 'graph_error', status: error.status }, 502)
    const message = (error as Error).message
    if (message.includes('version_conflict')) return json(req, { error: message, code: 'version_conflict' }, 409)
    console.error('onenote-library failed', error)
    return json(req, { error: message, code: 'error' }, 500)
  }
})
