// SyncStore backed by the Phase 0 tables, using the service role (Deno only).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AllowedNotebook, ConflictInput, LinkRow, RecipeRow, SyncStore } from '../onenote/engine.ts'
import { emptySections, type MergeKey, type PageState, type RecipeSections } from '../onenote/sections.ts'

const LINK_COLUMNS =
  'recipe_id,notebook_id,section_id,page_id,web_url,client_url,template_version,sync_status,base_sections,' +
  'remote_last_modified,last_synced_at,parse_method,last_error,retry_count,next_retry_at'

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`)
  return result.data
}

export class SupabaseSyncStore implements SyncStore {
  constructor(
    private readonly admin: SupabaseClient,
    private readonly userId: string,
  ) {}

  async getRecipe(recipeId: string): Promise<RecipeRow | null> {
    const row = check(
      await this.admin.from('spike_recipes').select('id,title,sections,version').eq('id', recipeId).maybeSingle(),
      'read recipe',
    )
    if (!row) return null
    return { ...row, sections: { ...emptySections(), ...(row.sections as Partial<RecipeSections>) } } as RecipeRow
  }

  async updateRecipe(recipeId: string, expectedVersion: number, state: PageState): Promise<boolean> {
    const rows = check(
      await this.admin
        .from('spike_recipes')
        .update({ title: state.title, sections: state.sections, version: expectedVersion + 1, updated_at: new Date().toISOString() })
        .eq('id', recipeId)
        .eq('version', expectedVersion)
        .select('id'),
      'update recipe',
    )
    return rows.length === 1
  }

  async getLink(recipeId: string): Promise<LinkRow | null> {
    return check(
      await this.admin.from('onenote_links').select(LINK_COLUMNS).eq('recipe_id', recipeId).maybeSingle(),
      'read link',
    ) as LinkRow | null
  }

  async saveLink(link: LinkRow): Promise<void> {
    check(
      await this.admin
        .from('onenote_links')
        .upsert({ ...link, user_id: this.userId, updated_at: new Date().toISOString() }, { onConflict: 'recipe_id' }),
      'save link',
    )
  }

  async addConflicts(recipeId: string, conflicts: ConflictInput[]): Promise<void> {
    for (const conflict of conflicts) {
      const values = { base: conflict.base, local: conflict.local, remote: conflict.remote, detected_at: new Date().toISOString() }
      const open = await this.getOpenConflict(recipeId, conflict.key)
      if (open) {
        check(await this.admin.from('sync_conflicts').update(values).eq('id', open.id), 'update conflict')
      } else {
        check(
          await this.admin.from('sync_conflicts').insert({ recipe_id: recipeId, section_key: conflict.key, ...values }),
          'record conflict',
        )
      }
    }
  }

  async getOpenConflict(recipeId: string, key: MergeKey): Promise<{ id: string; remote: unknown } | null> {
    return check(
      await this.admin
        .from('sync_conflicts')
        .select('id,remote')
        .eq('recipe_id', recipeId)
        .eq('section_key', key)
        .is('resolved_at', null)
        .maybeSingle(),
      'read conflict',
    )
  }

  async markConflictResolved(conflictId: string, resolution: 'local' | 'remote'): Promise<void> {
    check(
      await this.admin
        .from('sync_conflicts')
        .update({ resolved_at: new Date().toISOString(), resolution, resolved_by: this.userId })
        .eq('id', conflictId),
      'resolve conflict',
    )
  }

  async saveSnapshot(pageId: string, recipeId: string, reason: string, html: string): Promise<void> {
    check(await this.admin.from('onenote_snapshots').insert({ page_id: pageId, recipe_id: recipeId, reason, html }), 'save snapshot')
  }

  async allowedNotebooks(): Promise<AllowedNotebook[]> {
    const rows = check(
      await this.admin
        .from('onenote_allowed_notebooks')
        .select('notebook_id,default_section_id')
        .eq('user_id', this.userId)
        .order('created_at'),
      'read allowed notebooks',
    )
    return rows.map((row) => ({ notebookId: row.notebook_id, defaultSectionId: row.default_section_id }))
  }
}
