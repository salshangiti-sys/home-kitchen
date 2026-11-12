-- Hardening found by a review of the database (security advisors, grants, and the functions written
-- since phase 1).
--
-- 1. The API roles (anon, authenticated) held TRUNCATE, REFERENCES and TRIGGER on every public
--    table. The web API cannot issue them, and row security does not apply to TRUNCATE, so they
--    are taken away; future tables do not get them either.
-- 2. recipe_doc() was callable by anon (it is only useful to signed-in people).
-- 3. check_cook_entry() was marked immutable although it reads today's date: it is stable.
-- 4. Indexes for the foreign keys of the tables added since (cook_log, recipe_photos).
-- 5. bulk_tag_recipes() answered differently for "no such recipe" and "a recipe you may not edit",
--    which let a signed-in person probe which recipe ids exist, and it locked a row before checking
--    the permission. Now a caller who can edit nothing is refused outright, and a recipe the caller
--    may not edit is treated exactly like one that does not exist (skipped), without being locked.

revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;

revoke execute on function public.recipe_doc(text) from public, anon;
grant execute on function public.recipe_doc(text) to authenticated, service_role;

alter function private.check_cook_entry(date, integer, text) stable;

create index cook_log_household on public.cook_log (household_id);
create index cook_log_user on public.cook_log (user_id);
create index recipe_photos_household on public.recipe_photos (household_id);
create index recipe_photos_created_by on public.recipe_photos (created_by);

create or replace function public.bulk_tag_recipes(p_ids text[], p_changes jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  canon constant text[] := array['breakfast', 'lunch', 'dinner', 'snack', 'dessert', 'drink', 'side'];
  known constant text[] := array['meal_types', 'kid_friendly', 'lunchbox', 'custom'];
  add_meals text[] := '{}';
  remove_meals text[] := '{}';
  add_custom text[] := '{}';
  has_kid boolean;
  has_lunch boolean;
  kid boolean;
  lunch boolean;
  key text;
  value text;
  rid text;
  r public.recipes%rowtype;
  old_meals text[];
  new_meals text[];
  new_custom text[];
  new_kid boolean;
  new_lunch boolean;
  changed integer := 0;
  unchanged integer := 0;
  skipped integer := 0;
begin
  if (select auth.uid()) is null or private.my_edit_household() is null then
    raise exception 'not allowed to edit recipes' using errcode = '42501';
  end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then
    raise exception 'no_recipes: choose at least one recipe' using errcode = 'P0001';
  end if;
  if array_length(p_ids, 1) > 300 then
    raise exception 'too_many: at most 300 recipes at a time' using errcode = 'P0001';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'no_changes: choose what to change' using errcode = 'P0001';
  end if;
  for key in select k from jsonb_object_keys(p_changes) as k loop
    if not key = any(known) then
      raise exception 'bad_changes: unknown key %', key using errcode = 'P0001';
    end if;
  end loop;

  if p_changes ? 'meal_types' then
    add_meals := coalesce(array(select jsonb_array_elements_text(p_changes -> 'meal_types' -> 'add')), '{}');
    remove_meals := coalesce(array(select jsonb_array_elements_text(p_changes -> 'meal_types' -> 'remove')), '{}');
    foreach value in array add_meals || remove_meals loop
      if not value = any(canon) then
        raise exception 'bad_meal_type: %', value using errcode = 'P0001';
      end if;
    end loop;
    if add_meals && remove_meals then
      raise exception 'bad_changes: a meal type cannot be both added and removed' using errcode = 'P0001';
    end if;
  end if;

  has_kid := p_changes ? 'kid_friendly';
  if has_kid and jsonb_typeof(p_changes -> 'kid_friendly') <> 'null' then
    kid := (p_changes ->> 'kid_friendly')::boolean;
  end if;
  has_lunch := p_changes ? 'lunchbox';
  if has_lunch and jsonb_typeof(p_changes -> 'lunchbox') <> 'null' then
    lunch := (p_changes ->> 'lunchbox')::boolean;
  end if;

  if p_changes ? 'custom' then
    foreach value in array coalesce(array(select jsonb_array_elements_text(p_changes -> 'custom' -> 'add')), '{}') loop
      value := btrim(value);
      if value = '' or char_length(value) > 40 then
        raise exception 'bad_tag: a tag is 1 to 40 characters' using errcode = 'P0001';
      end if;
      add_custom := add_custom || value;
    end loop;
    if coalesce(array_length(add_custom, 1), 0) > 10 then
      raise exception 'bad_tag: at most 10 tags at a time' using errcode = 'P0001';
    end if;
  end if;

  for rid in select distinct x from unnest(p_ids) as x order by x loop
    -- A recipe the caller may not edit is looked up as if it did not exist (and is not locked).
    select * into r from public.recipes where id = rid and private.can_edit_household(household_id) for update;
    if not found or r.deleted_at is not null then
      skipped := skipped + 1;
      continue;
    end if;

    -- Meal types stay in the fixed order the app uses.
    old_meals := array(select m from unnest(canon) as m where m = any(r.meal_types));
    new_meals := array(select m from unnest(canon) as m where (m = any(r.meal_types) or m = any(add_meals)) and not m = any(remove_meals));
    new_custom := r.custom_tags;
    foreach value in array add_custom loop
      if not exists (select 1 from unnest(new_custom) as c where lower(c) = lower(value)) then
        new_custom := new_custom || value;
      end if;
    end loop;
    new_kid := case when has_kid then kid else r.kid_friendly end;
    new_lunch := case when has_lunch then lunch else r.lunchbox end;

    if new_meals is not distinct from old_meals
       and new_custom is not distinct from r.custom_tags
       and new_kid is not distinct from r.kid_friendly
       and new_lunch is not distinct from r.lunchbox then
      unchanged := unchanged + 1;
      continue;
    end if;

    changed := changed + 1;
    if not p_dry_run then
      perform public.save_recipe(
        jsonb_set(
          public.recipe_doc(rid),
          '{tags}',
          jsonb_strip_nulls(jsonb_build_object('meal_types', to_jsonb(new_meals), 'kid_friendly', new_kid, 'lunchbox', new_lunch, 'custom', to_jsonb(new_custom)))
        ),
        r.version,
        'app'
      );
    end if;
  end loop;

  return jsonb_build_object('changed', changed, 'unchanged', unchanged, 'skipped', skipped, 'dry_run', p_dry_run);
end;
$$;
