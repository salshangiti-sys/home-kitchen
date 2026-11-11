-- Tagging many recipes at once (meal type, "for kids", "lunch box", and added private tags).
--
-- Changes ONLY the tags: the title, ingredients, steps, notes and everything else are saved back
-- exactly as they are. Each recipe that really changes gets a new version (origin 'app'), like an
-- edit in the editor, so it shows in the version history and can be restored.
--
-- p_changes (every key optional, at least one required):
--   { "meal_types": { "add": ["lunch"], "remove": ["snack"] },
--     "kid_friendly": true | false | null,      -- set yes / no / "not set"; leave the key out for no change
--     "lunchbox":     true | false | null,
--     "custom":       { "add": ["سريعة"] } }     -- private tags to add (already present ones are kept once)
--
-- - All or nothing: one call is one transaction. If anything is wrong, nothing is changed.
-- - p_dry_run (the default) changes nothing and only counts what a real run would do, so the page can
--   say "this will change 12 of 14 recipes" before asking.
-- - Recipes in the trash or not found are skipped and counted. If any recipe is one the caller may
--   not edit, the whole call is refused.
-- - Up to 300 recipes per call.
-- Returns { changed, unchanged, skipped, dry_run }.

create function public.bulk_tag_recipes(p_ids text[], p_changes jsonb, p_dry_run boolean default true)
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
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '42501';
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
    select * into r from public.recipes where id = rid for update;
    if not found or r.deleted_at is not null then
      skipped := skipped + 1;
      continue;
    end if;
    if not private.can_edit_household(r.household_id) then
      raise exception 'not allowed to edit this recipe' using errcode = '42501';
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

revoke all on function public.bulk_tag_recipes(text[], jsonb, boolean) from public, anon;
grant execute on function public.bulk_tag_recipes(text[], jsonb, boolean) to authenticated;
