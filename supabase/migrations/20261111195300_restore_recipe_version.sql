-- Restoring an earlier version of a recipe.
--
-- The copy is read here, from the recipe_versions table, never taken from the caller; it is saved
-- as a NEW version (origin 'restore'), so nothing is lost: the version it replaces stays in the
-- history and can be restored in turn.
--
-- - Only owners and editors (save_recipe checks this).
-- - Not for a recipe with a OneNote page: its text is read from the page every time it is opened,
--   so a restored text would be overwritten at the next read. Its text is changed in OneNote.
-- - Not for a recipe in the trash.
-- - p_expected_version is the version the person was looking at; if the recipe changed since,
--   the restore is refused (version_conflict) instead of overwriting the newer change.
-- - Restoring the version that is already current changes nothing ('unchanged').
-- Returns what save_recipe returns: { id, version, result }.

create function public.restore_recipe_version(p_recipe_id text, p_version integer, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.recipes%rowtype;
  old_doc jsonb;
begin
  select * into r from public.recipes where id = p_recipe_id;
  if not found or not private.can_edit_household(r.household_id) then
    raise exception 'recipe not found or not allowed' using errcode = '42501';
  end if;
  if r.deleted_at is not null then
    raise exception 'in_trash: restore the recipe from the trash first' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.recipe_pages p where p.recipe_id = r.id) then
    raise exception 'linked_to_onenote: the text of this recipe is changed in OneNote' using errcode = 'P0001';
  end if;

  select v.snapshot into old_doc from public.recipe_versions v where v.recipe_id = r.id and v.version = p_version;
  if old_doc is null then
    raise exception 'no_such_version: this version does not exist' using errcode = 'P0001';
  end if;

  -- Always saved onto this recipe, whatever id the old copy carries.
  return public.save_recipe(jsonb_set(old_doc, '{id}', to_jsonb(r.id)), p_expected_version, 'restore');
end;
$$;

revoke all on function public.restore_recipe_version(text, integer, integer) from public, anon;
grant execute on function public.restore_recipe_version(text, integer, integer) to authenticated;
