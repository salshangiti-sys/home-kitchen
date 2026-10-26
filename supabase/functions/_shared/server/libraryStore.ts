// LibraryStore backed by Supabase (Deno only). Recipes are read and saved with the caller's own
// token, through recipe_doc and save_recipe, so the same rules apply as in the app (and the
// version history records the change). The OneNote link tables are written with the service role.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Library, LibraryStore, PageLink, SaveResult, UnlinkedPage } from '../onenote/libraryEngine.ts'
import type { RecipeDoc } from '../onenote/recipeDoc.ts'

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`)
  return result.data
}

interface PageRow {
  recipe_id: string
  page_id: string
  notebook_id: string
  section_id: string | null
  section_name: string | null
  page_title: string | null
  web_url: string | null
  client_url: string | null
  created_by_app: boolean
  read_status: PageLink['readStatus']
  last_read_at: string | null
  last_error: string | null
}

const PAGE_COLUMNS = 'recipe_id,page_id,notebook_id,section_id,section_name,page_title,web_url,client_url,created_by_app,read_status,last_read_at,last_error'

const toLink = (row: PageRow): PageLink => ({
  recipeId: row.recipe_id,
  pageId: row.page_id,
  notebookId: row.notebook_id,
  sectionId: row.section_id,
  sectionName: row.section_name,
  pageTitle: row.page_title,
  webUrl: row.web_url,
  clientUrl: row.client_url,
  createdByApp: row.created_by_app,
  readStatus: row.read_status,
  lastReadAt: row.last_read_at,
  lastError: row.last_error,
})

export class SupabaseLibraryStore implements LibraryStore {
  constructor(
    private readonly admin: SupabaseClient,
    private readonly userClient: SupabaseClient,
    private readonly householdId: string,
    private readonly userId: string,
  ) {}

  async library(): Promise<Library | null> {
    const row = check(
      await this.admin
        .from('onenote_library')
        .select('place_kind,place_id,notebook_id,notebook_name,section_group,sections,last_checked_at')
        .eq('household_id', this.householdId)
        .maybeSingle(),
      'read library',
    )
    if (!row) return null
    return {
      kind: row.place_kind,
      placeId: row.place_id,
      notebookId: row.notebook_id,
      notebookName: row.notebook_name,
      sectionGroup: row.section_group,
      sections: row.sections,
      lastCheckedAt: row.last_checked_at,
    }
  }

  async saveLibrary(library: Library): Promise<void> {
    const existing = await this.library()
    // Linking a different notebook or section group starts over: links and the review list belong
    // to the old one.
    const same = existing?.placeId === library.placeId
    if (existing && !same) {
      const ids = (await this.links()).map((link) => link.recipeId)
      if (ids.length) check(await this.admin.from('recipe_pages').delete().in('recipe_id', ids), 'clear links')
      check(await this.admin.from('onenote_unlinked_pages').delete().eq('household_id', this.householdId), 'clear review list')
    }
    const row = {
      place_kind: library.kind,
      place_id: library.placeId,
      section_group: library.sectionGroup,
      notebook_id: library.notebookId,
      notebook_name: library.notebookName,
      sections: library.sections,
      last_checked_at: library.lastCheckedAt,
      last_error: null,
    }
    // The same library keeps the Microsoft account that linked it; a new link uses the caller's.
    check(
      same
        ? await this.admin.from('onenote_library').update(row).eq('household_id', this.householdId)
        : await this.admin.from('onenote_library').upsert({ household_id: this.householdId, user_id: this.userId, linked_at: new Date().toISOString(), ...row }, { onConflict: 'household_id' }),
      'save library',
    )
  }

  async recipe(recipeId: string): Promise<{ doc: RecipeDoc; version: number } | null> {
    const row = check(
      await this.userClient.from('recipes').select('version').eq('id', recipeId).is('deleted_at', null).maybeSingle(),
      'read recipe',
    )
    if (!row) return null
    const doc = check(await this.userClient.rpc('recipe_doc', { recipe_id: recipeId }), 'read recipe') as RecipeDoc
    return { doc, version: row.version }
  }

  async saveRecipe(doc: RecipeDoc, expectedVersion: number | null, origin: 'app' | 'onenote'): Promise<SaveResult> {
    const saved = check(
      await this.userClient.rpc('save_recipe', { p_doc: doc, p_expected_version: expectedVersion, p_origin: origin }),
      'save recipe',
    ) as { id: string; result: SaveResult['result'] }
    return { id: saved.id, result: saved.result }
  }

  async links(): Promise<PageLink[]> {
    const rows = check(
      await this.admin
        .from('recipe_pages')
        .select(`${PAGE_COLUMNS},recipes!inner(household_id,deleted_at)`)
        .eq('recipes.household_id', this.householdId)
        .is('recipes.deleted_at', null),
      'read links',
    ) as unknown as PageRow[]
    return rows.map(toLink)
  }

  async link(recipeId: string): Promise<PageLink | null> {
    const row = check(await this.admin.from('recipe_pages').select(PAGE_COLUMNS).eq('recipe_id', recipeId).maybeSingle(), 'read link')
    return row ? toLink(row as PageRow) : null
  }

  async saveLink(link: PageLink): Promise<void> {
    check(
      await this.admin.from('recipe_pages').upsert(
        {
          recipe_id: link.recipeId,
          page_id: link.pageId,
          notebook_id: link.notebookId,
          section_id: link.sectionId,
          section_name: link.sectionName,
          page_title: link.pageTitle,
          web_url: link.webUrl,
          client_url: link.clientUrl,
          created_by_app: link.createdByApp,
          read_status: link.readStatus,
          last_read_at: link.lastReadAt,
          last_error: link.lastError,
        },
        { onConflict: 'recipe_id' },
      ),
      'save link',
    )
  }

  async replaceUnlinked(pages: UnlinkedPage[]): Promise<void> {
    check(await this.admin.from('onenote_unlinked_pages').delete().eq('household_id', this.householdId), 'clear review list')
    if (!pages.length) return
    check(
      await this.admin.from('onenote_unlinked_pages').insert(
        pages.map((page) => ({
          household_id: this.householdId,
          page_id: page.pageId,
          title: page.title,
          section_id: page.sectionId,
          section_name: page.sectionName,
          web_url: page.webUrl,
        })),
      ),
      'save review list',
    )
  }

  async removeUnlinked(pageId: string): Promise<void> {
    check(await this.admin.from('onenote_unlinked_pages').delete().eq('household_id', this.householdId).eq('page_id', pageId), 'update review list')
  }

  async importedWithoutLink(limit: number): Promise<Array<{ recipeId: string; pageId: string }>> {
    const recipes = check(
      await this.admin
        .from('recipes')
        .select('id,onenote')
        .eq('household_id', this.householdId)
        .is('deleted_at', null)
        .not('onenote->>page_id', 'is', null),
      'read imported recipes',
    ) as Array<{ id: string; onenote: { page_id?: string } }>
    const linked = new Set((await this.links()).map((link) => link.recipeId))
    return recipes
      .filter((recipe) => recipe.onenote.page_id && !linked.has(recipe.id))
      .slice(0, limit)
      .map((recipe) => ({ recipeId: recipe.id, pageId: recipe.onenote.page_id! }))
  }
}
