-- Restoring from a backup file (hk-backup-….json, written every night to OneDrive).
--
-- MERGE ONLY: it adds what is missing and never changes or deletes anything that is already in the
-- app. Running it twice adds nothing the second time. So it is safe to run on the live app, and on
-- an empty one after a loss.
--
-- What comes back, from the file's parts:
--   recipes, deleted_recipes   a recipe whose id is not in the app is created (a trashed one comes
--                              back in the trash); one that is already there is left exactly as it is
--   versions                   for a recipe this restore created: its whole edit history (instead of
--                              the single version the creation made); for others, only missing versions
--   flags                      for a recipe this restore created: the review state (open / reviewed)
--   onenote_pages              for a recipe this restore created: the link to its OneNote page
--   favorites, cook_log        entries not yet there, for people who are in the household
--                              (see the user rule below); cook entries keep their ids, so none repeats
-- Not restored here: the photo FILES (they are copied to OneDrive and put back by hand), the
-- chosen OneNote library, and the members list (people sign in again).
--
-- People: the file names people by account id. An id that belongs to the household is kept. When the
-- file has exactly one owner and the household has exactly one owner (the usual loss of the whole
-- project: a new account), the old owner's entries go to the new owner. Anyone else's entries are
-- skipped and counted.
--
-- p_dry_run (the default): everything is done and then rolled back, so the report says exactly what a
-- real restore would add. Only the household's owner may run it.
-- Returns { dry_run, recipes_created, recipes_existing, trashed_created, versions_added,
--           favorites_added, flags_restored, links_added, cook_entries_added, entries_skipped_unknown_person,
--           photos_in_file, errors: [{ id, error }] }.

create function public.restore_from_backup(p_bundle jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  hh uuid;
  old_owner text;
  one_owner boolean;
  created text[] := '{}';
  purged text[] := '{}';
  entry jsonb;
  doc jsonb;
  rid text;
  n integer;
  max_version integer;
  v_recipes_created integer := 0;
  v_recipes_existing integer := 0;
  v_trashed integer := 0;
  v_versions integer := 0;
  v_favorites integer := 0;
  v_flags integer := 0;
  v_links integer := 0;
  v_cook integer := 0;
  v_unknown integer := 0;
  errors jsonb := '[]'::jsonb;
  mapped uuid;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select m.household_id into hh from public.household_members m where m.user_id = me and m.role = 'owner' order by m.created_at limit 1;
  if hh is null then
    raise exception 'only the owner can restore from a backup' using errcode = '42501';
  end if;
  if p_bundle is null or jsonb_typeof(p_bundle) <> 'object'
     or p_bundle ->> 'format' is distinct from 'home-kitchen-backup' or (p_bundle ->> 'version')::integer is distinct from 1 then
    raise exception 'not_a_backup: this is not a home-kitchen backup file' using errcode = 'P0001';
  end if;

  -- The owner of the file, when there is exactly one, and whether the household has exactly one.
  select count(*) = 1, min(x ->> 'user_id') into one_owner, old_owner
  from jsonb_array_elements(coalesce(p_bundle -> 'members', '[]'::jsonb)) as x
  where x ->> 'role' = 'owner';
  if one_owner and (select count(*) from public.household_members m where m.household_id = hh and m.role = 'owner') <> 1 then
    one_owner := false;
  end if;

  begin
    -- Recipes, then the trashed ones.
    for entry in
      select value from jsonb_array_elements(coalesce(p_bundle -> 'recipes', '[]'::jsonb))
      union all
      select value || jsonb_build_object('doc', value -> 'doc') from jsonb_array_elements(coalesce(p_bundle -> 'deleted_recipes', '[]'::jsonb))
    loop
      -- A trashed entry is { deleted_at, doc }; a recipe is the document itself.
      doc := case when entry ? 'doc' then entry -> 'doc' else entry end;
      rid := doc ->> 'id';
      begin
        if exists (select 1 from public.recipes r where r.id = rid) then
          v_recipes_existing := v_recipes_existing + 1;
        else
          perform public.save_recipe(doc, null, 'restore');
          created := created || rid;
          if entry ? 'doc' then
            update public.recipes set deleted_at = coalesce((entry ->> 'deleted_at')::timestamptz, now()) where id = rid;
            v_trashed := v_trashed + 1;
          else
            v_recipes_created := v_recipes_created + 1;
          end if;
        end if;
      exception when others then
        errors := errors || jsonb_build_array(jsonb_build_object('id', rid, 'error', sqlerrm));
      end;
    end loop;

    -- Edit history: the whole history for the recipes created above, only missing versions otherwise.
    for entry in select value from jsonb_array_elements(coalesce(p_bundle -> 'versions', '[]'::jsonb)) loop
      rid := entry ->> 'recipe_id';
      continue when not exists (select 1 from public.recipes r where r.id = rid);
      if rid = any(created) and not rid = any(purged) then
        -- first backup version seen for a recipe created here: drop the one version its creation made
        delete from public.recipe_versions v where v.recipe_id = rid;
        purged := purged || rid;
      end if;
      insert into public.recipe_versions (recipe_id, version, snapshot, origin, changed_at)
      values (rid, (entry ->> 'version')::integer, entry -> 'snapshot', entry ->> 'origin', (entry ->> 'changed_at')::timestamptz)
      on conflict (recipe_id, version) do nothing;
      get diagnostics n = row_count;
      v_versions := v_versions + n;
    end loop;
    -- A recipe created above is at the version of its newest kept version.
    foreach rid in array created loop
      select max(v.version) into max_version from public.recipe_versions v where v.recipe_id = rid;
      if max_version is not null then
        update public.recipes set version = max_version where id = rid;
      end if;
    end loop;

    -- Review state and OneNote links of the recipes created above.
    for entry in select value from jsonb_array_elements(coalesce(p_bundle -> 'flags', '[]'::jsonb)) loop
      rid := entry ->> 'recipe_id';
      continue when not (rid = any(created));
      insert into public.recipe_flags (recipe_id, flag, status, reviewed_at)
      values (rid, entry ->> 'flag', (entry ->> 'status')::public.flag_status, (entry ->> 'reviewed_at')::timestamptz)
      on conflict (recipe_id, flag) do update set status = excluded.status, reviewed_at = excluded.reviewed_at;
      get diagnostics n = row_count;
      v_flags := v_flags + n;
    end loop;

    for entry in select value from jsonb_array_elements(coalesce(p_bundle -> 'onenote_pages', '[]'::jsonb)) loop
      rid := entry ->> 'recipe_id';
      continue when not (rid = any(created));
      insert into public.recipe_pages
      select * from jsonb_populate_record(null::public.recipe_pages, entry)
      on conflict do nothing;
      get diagnostics n = row_count;
      v_links := v_links + n;
    end loop;

    -- Favorites and cooking history, for people who are in the household.
    for entry in select value from jsonb_array_elements(coalesce(p_bundle -> 'favorites', '[]'::jsonb)) loop
      mapped := case
        when exists (select 1 from public.household_members m where m.household_id = hh and m.user_id = (entry ->> 'user_id')::uuid) then (entry ->> 'user_id')::uuid
        when one_owner and entry ->> 'user_id' = old_owner then me
      end;
      if mapped is null then
        v_unknown := v_unknown + 1;
        continue;
      end if;
      continue when not exists (select 1 from public.recipes r where r.id = entry ->> 'recipe_id');
      insert into public.user_favorites (user_id, recipe_id, created_at)
      values (mapped, entry ->> 'recipe_id', coalesce((entry ->> 'created_at')::timestamptz, now()))
      on conflict do nothing;
      get diagnostics n = row_count;
      v_favorites := v_favorites + n;
    end loop;

    for entry in select value from jsonb_array_elements(coalesce(p_bundle -> 'cook_log', '[]'::jsonb)) loop
      mapped := case
        when exists (select 1 from public.household_members m where m.household_id = hh and m.user_id = (entry ->> 'user_id')::uuid) then (entry ->> 'user_id')::uuid
        when one_owner and entry ->> 'user_id' = old_owner then me
      end;
      if mapped is null then
        v_unknown := v_unknown + 1;
        continue;
      end if;
      continue when not exists (select 1 from public.recipes r where r.id = entry ->> 'recipe_id');
      insert into public.cook_log (id, recipe_id, household_id, user_id, cooked_on, rating, note, created_at, deleted_at)
      values (
        (entry ->> 'id')::uuid, entry ->> 'recipe_id', hh, mapped, (entry ->> 'cooked_on')::date,
        (entry ->> 'rating')::smallint, entry ->> 'note',
        coalesce((entry ->> 'created_at')::timestamptz, now()), (entry ->> 'deleted_at')::timestamptz
      )
      on conflict (id) do nothing;
      get diagnostics n = row_count;
      v_cook := v_cook + n;
    end loop;

    if p_dry_run then
      raise exception 'hk_dry_run';
    end if;
  exception
    when raise_exception then
      if sqlerrm <> 'hk_dry_run' then
        raise;
      end if;
  end;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'recipes_created', v_recipes_created,
    'recipes_existing', v_recipes_existing,
    'trashed_created', v_trashed,
    'versions_added', v_versions,
    'favorites_added', v_favorites,
    'flags_restored', v_flags,
    'links_added', v_links,
    'cook_entries_added', v_cook,
    'entries_skipped_unknown_person', v_unknown,
    'photos_in_file', jsonb_array_length(coalesce(p_bundle -> 'photos', '[]'::jsonb)),
    'errors', errors
  );
end;
$$;

revoke all on function public.restore_from_backup(jsonb, boolean) from public, anon;
grant execute on function public.restore_from_backup(jsonb, boolean) to authenticated;
