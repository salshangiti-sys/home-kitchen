-- A task that was ticked by the owner of a backup file from another account is ticked by the
-- (new) owner after a restore, like favorites and cooking history: the file's single owner becomes
-- the household's single owner.

create or replace function public.restore_from_backup(p_bundle jsonb, p_dry_run boolean default true)
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
  v_food integer := 0;
  v_people integer := 0;
  v_meals integer := 0;
  v_templates integer := 0;
  v_tasks integer := 0;
  plan_id uuid;
  pid uuid;
  plan_map jsonb := '{}'::jsonb;
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

    -- Food groups of the recipes created above.
    for entry in select value from jsonb_array_elements(coalesce(p_bundle -> 'food_groups', '[]'::jsonb)) loop
      rid := entry ->> 'recipe_id';
      continue when not (rid = any(created));
      insert into public.recipe_food_groups (recipe_id, food_group) values (rid, entry ->> 'food_group') on conflict do nothing;
      get diagnostics n = row_count;
      v_food := v_food + n;
    end loop;

    -- The weekly plan: settings, people, slots, weeks, meals and manual food-group changes. Merge only:
    -- rows with an id that is already there are left as they are, and a week that already exists
    -- (same start day) takes the meals of the file's week as extra meals.
    if jsonb_typeof(p_bundle -> 'plan_settings') = 'object' then
      insert into public.plan_settings (household_id, week_start_dow)
      values (hh, (p_bundle -> 'plan_settings' ->> 'week_start_dow')::smallint)
      on conflict do nothing;
    end if;

    for entry in select value from jsonb_array_elements(coalesce(p_bundle -> 'people', '[]'::jsonb)) loop
      insert into public.people (id, household_id, name, kind, allergies, notes, position, created_at, deleted_at)
      values (
        (entry ->> 'id')::uuid, hh, entry ->> 'name', entry ->> 'kind',
        coalesce(array(select jsonb_array_elements_text(entry -> 'allergies')), '{}'), entry ->> 'notes',
        coalesce((entry ->> 'position')::integer, 0), coalesce((entry ->> 'created_at')::timestamptz, now()), (entry ->> 'deleted_at')::timestamptz
      )
      on conflict do nothing;
      get diagnostics n = row_count;
      v_people := v_people + n;
    end loop;

    for entry in select value from jsonb_array_elements(coalesce(p_bundle -> 'meal_slots', '[]'::jsonb)) loop
      insert into public.meal_slots (id, household_id, name, position, created_at, deleted_at)
      values (
        (entry ->> 'id')::uuid, hh, entry ->> 'name', coalesce((entry ->> 'position')::integer, 0),
        coalesce((entry ->> 'created_at')::timestamptz, now()), (entry ->> 'deleted_at')::timestamptz
      )
      on conflict do nothing;
    end loop;

    for entry in select value from jsonb_array_elements(coalesce(p_bundle -> 'week_plans', '[]'::jsonb)) loop
      select w.id into plan_id from public.week_plans w where w.household_id = hh and w.week_start = (entry ->> 'week_start')::date;
      if plan_id is null then
        insert into public.week_plans (id, household_id, week_start, notes, created_at)
        values ((entry ->> 'id')::uuid, hh, (entry ->> 'week_start')::date, entry ->> 'notes', coalesce((entry ->> 'created_at')::timestamptz, now()))
        returning id into plan_id;
      end if;
      plan_map := plan_map || jsonb_build_object(entry ->> 'id', plan_id::text);
    end loop;

    for entry in select value from jsonb_array_elements(coalesce(p_bundle -> 'planned_meals', '[]'::jsonb)) loop
      pid := (plan_map ->> (entry ->> 'week_plan_id'))::uuid;
      continue when pid is null;
      continue when not exists (select 1 from public.meal_slots s where s.id = (entry ->> 'slot_id')::uuid and s.household_id = hh);
      continue when entry ->> 'recipe_id' is not null and not exists (select 1 from public.recipes r where r.id = entry ->> 'recipe_id');
      insert into public.planned_meals (id, week_plan_id, household_id, day, slot_id, recipe_id, title, free_text, servings, people, position, status, created_at)
      values (
        (entry ->> 'id')::uuid, pid, hh, (entry ->> 'day')::date, (entry ->> 'slot_id')::uuid, entry ->> 'recipe_id', entry ->> 'title',
        entry ->> 'free_text', (entry ->> 'servings')::numeric,
        coalesce(array(select (jsonb_array_elements_text(entry -> 'people'))::uuid), '{}'),
        coalesce((entry ->> 'position')::integer, 0), coalesce(entry ->> 'status', 'planned'), coalesce((entry ->> 'created_at')::timestamptz, now())
      )
      on conflict do nothing;
      get diagnostics n = row_count;
      v_meals := v_meals + n;
    end loop;

    for entry in select value from jsonb_array_elements(coalesce(p_bundle -> 'slot_food_groups', '[]'::jsonb)) loop
      pid := (plan_map ->> (entry ->> 'week_plan_id'))::uuid;
      continue when pid is null;
      continue when not exists (select 1 from public.meal_slots s where s.id = (entry ->> 'slot_id')::uuid and s.household_id = hh);
      insert into public.slot_food_groups (week_plan_id, household_id, day, slot_id, food_group, mode)
      values (pid, hh, (entry ->> 'day')::date, (entry ->> 'slot_id')::uuid, entry ->> 'food_group', entry ->> 'mode')
      on conflict do nothing;
    end loop;

    -- Prep templates and tasks. Tasks come back with their done state; a person who is not in the
    -- household any more is simply not named as the one who did it.
    for entry in select value from jsonb_array_elements(coalesce(p_bundle -> 'prep_templates', '[]'::jsonb)) loop
      continue when not exists (select 1 from public.recipes r where r.id = entry ->> 'recipe_id');
      insert into public.recipe_prep_templates (id, recipe_id, household_id, kind, timing, at_time, body, position, created_at)
      values (
        (entry ->> 'id')::uuid, entry ->> 'recipe_id', hh, entry ->> 'kind', entry ->> 'timing', (entry ->> 'at_time')::time,
        entry ->> 'body', coalesce((entry ->> 'position')::integer, 0), coalesce((entry ->> 'created_at')::timestamptz, now())
      )
      on conflict do nothing;
      get diagnostics n = row_count;
      v_templates := v_templates + n;
    end loop;

    for entry in select value from jsonb_array_elements(coalesce(p_bundle -> 'prep_tasks', '[]'::jsonb)) loop
      continue when entry ->> 'planned_meal_id' is not null
        and not exists (select 1 from public.planned_meals m where m.id = (entry ->> 'planned_meal_id')::uuid and m.household_id = hh);
      insert into public.prep_tasks (id, household_id, planned_meal_id, day, timing, at_time, kind, body, template_id, from_template, manually_edited, dismissed_at, done_at, done_by, position, created_at)
      values (
        (entry ->> 'id')::uuid, hh, (entry ->> 'planned_meal_id')::uuid, (entry ->> 'day')::date, entry ->> 'timing', (entry ->> 'at_time')::time,
        entry ->> 'kind', entry ->> 'body',
        (select t.id from public.recipe_prep_templates t where t.id = (entry ->> 'template_id')::uuid),
        coalesce((entry ->> 'from_template')::boolean, false), coalesce((entry ->> 'manually_edited')::boolean, false),
        (entry ->> 'dismissed_at')::timestamptz, (entry ->> 'done_at')::timestamptz,
        case
          when exists (select 1 from public.household_members m where m.household_id = hh and m.user_id = (entry ->> 'done_by')::uuid) then (entry ->> 'done_by')::uuid
          when one_owner and entry ->> 'done_by' = old_owner then me
        end,
        coalesce((entry ->> 'position')::integer, 0), coalesce((entry ->> 'created_at')::timestamptz, now())
      )
      on conflict do nothing;
      get diagnostics n = row_count;
      v_tasks := v_tasks + n;
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
    'food_groups_added', v_food,
    'people_added', v_people,
    'planned_meals_added', v_meals,
    'prep_templates_added', v_templates,
    'prep_tasks_added', v_tasks,
    'entries_skipped_unknown_person', v_unknown,
    'photos_in_file', jsonb_array_length(coalesce(p_bundle -> 'photos', '[]'::jsonb)),
    'errors', errors
  );
end;
$$;


revoke all on function public.restore_from_backup(jsonb, boolean) from public, anon;
grant execute on function public.restore_from_backup(jsonb, boolean) to authenticated;
