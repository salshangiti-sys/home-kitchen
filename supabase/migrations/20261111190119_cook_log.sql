-- Cooking history: one entry each time a recipe was cooked (the date, an optional rating from 1 to
-- 5, and an optional free note: what was changed, how it turned out).
--
-- - Everyone in the household can read the history of the household's recipes.
-- - Any member (owners, editors and viewers) can add an entry, and change or remove their OWN entries:
--   it is a record of cooking, it does not change the recipe.
-- - Written only through the functions below. An entry is removed by hiding it (deleted_at).
-- - Entries are not added to a recipe that is in the trash.

create table public.cook_log (
  id uuid primary key,
  recipe_id text not null references public.recipes (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  cooked_on date not null,
  rating smallint check (rating between 1 and 5),
  note text check (char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index cook_log_recipe on public.cook_log (recipe_id, cooked_on desc) where deleted_at is null;

alter table public.cook_log enable row level security;
grant all on table public.cook_log to service_role;
grant select on table public.cook_log to authenticated;
create policy "members read cook log" on public.cook_log for select to authenticated
  using (private.is_household_member(household_id));

-- The date must be a plausible one: not before 2000, and not more than a day ahead (a day of slack
-- for the difference between the phone's time zone and the server's).
create function private.check_cook_entry(p_cooked_on date, p_rating integer, p_note text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_cooked_on is null or p_cooked_on < date '2000-01-01' or p_cooked_on > current_date + 1 then
    raise exception 'bad_date: the date of cooking is not valid' using errcode = 'P0001';
  end if;
  if p_rating is not null and (p_rating < 1 or p_rating > 5) then
    raise exception 'bad_rating: the rating is from 1 to 5' using errcode = 'P0001';
  end if;
  if p_note is not null and char_length(p_note) > 2000 then
    raise exception 'note_too_long: at most 2000 characters' using errcode = 'P0001';
  end if;
end;
$$;

create function public.add_cook_entry(p_id uuid, p_recipe_id text, p_cooked_on date, p_rating integer, p_note text)
returns public.cook_log
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.recipes%rowtype;
  added public.cook_log;
begin
  select * into r from public.recipes where id = p_recipe_id and deleted_at is null;
  if not found or not private.is_household_member(r.household_id) then
    raise exception 'recipe not found or not allowed' using errcode = '42501';
  end if;
  perform private.check_cook_entry(p_cooked_on, p_rating, p_note);

  insert into public.cook_log (id, recipe_id, household_id, user_id, cooked_on, rating, note)
  values (p_id, r.id, r.household_id, (select auth.uid()), p_cooked_on, p_rating, nullif(btrim(p_note), ''))
  returning * into added;
  return added;
end;
$$;

-- Changes the date, rating or note of your own entry.
create function public.update_cook_entry(p_id uuid, p_cooked_on date, p_rating integer, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.check_cook_entry(p_cooked_on, p_rating, p_note);
  update public.cook_log c
  set cooked_on = p_cooked_on, rating = p_rating, note = nullif(btrim(p_note), ''), updated_at = now()
  where c.id = p_id and c.deleted_at is null and c.user_id = (select auth.uid()) and private.is_household_member(c.household_id);
  if not found then
    raise exception 'entry not found or not allowed' using errcode = '42501';
  end if;
end;
$$;

-- Hides your own entry.
create function public.remove_cook_entry(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.cook_log c set deleted_at = now(), updated_at = now()
  where c.id = p_id and c.deleted_at is null and c.user_id = (select auth.uid()) and private.is_household_member(c.household_id);
  if not found then
    raise exception 'entry not found or not allowed' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.add_cook_entry(uuid, text, date, integer, text) from public, anon;
revoke all on function public.update_cook_entry(uuid, date, integer, text) from public, anon;
revoke all on function public.remove_cook_entry(uuid) from public, anon;
grant execute on function public.add_cook_entry(uuid, text, date, integer, text) to authenticated;
grant execute on function public.update_cook_entry(uuid, date, integer, text) to authenticated;
grant execute on function public.remove_cook_entry(uuid) to authenticated;
grant execute on function private.check_cook_entry(date, integer, text) to authenticated, service_role;

-- The nightly backup includes the cooking history (hidden entries too, marked by deleted_at).
create or replace function public.backup_bundle(p_household uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'household', jsonb_build_object('id', p_household),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'role', m.role) order by m.created_at)
      from public.household_members m where m.household_id = p_household
    ), '[]'::jsonb),
    'recipes', coalesce((
      select jsonb_agg(public.recipe_doc(r.id) order by r.id)
      from public.recipes r where r.household_id = p_household and r.deleted_at is null
    ), '[]'::jsonb),
    'deleted_recipes', coalesce((
      select jsonb_agg(jsonb_build_object('deleted_at', r.deleted_at, 'doc', public.recipe_doc(r.id)) order by r.id)
      from public.recipes r where r.household_id = p_household and r.deleted_at is not null
    ), '[]'::jsonb),
    'favorites', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', f.user_id, 'recipe_id', f.recipe_id, 'created_at', f.created_at) order by f.recipe_id, f.user_id)
      from public.user_favorites f join public.recipes r on r.id = f.recipe_id where r.household_id = p_household
    ), '[]'::jsonb),
    'flags', coalesce((
      select jsonb_agg(jsonb_build_object('recipe_id', f.recipe_id, 'flag', f.flag, 'status', f.status, 'reviewed_at', f.reviewed_at) order by f.recipe_id, f.flag)
      from public.recipe_flags f join public.recipes r on r.id = f.recipe_id where r.household_id = p_household
    ), '[]'::jsonb),
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object('recipe_id', v.recipe_id, 'version', v.version, 'origin', v.origin, 'changed_at', v.changed_at, 'snapshot', v.snapshot) order by v.recipe_id, v.version)
      from public.recipe_versions v join public.recipes r on r.id = v.recipe_id where r.household_id = p_household
    ), '[]'::jsonb),
    'onenote_pages', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.recipe_id)
      from public.recipe_pages p join public.recipes r on r.id = p.recipe_id where r.household_id = p_household
    ), '[]'::jsonb),
    'onenote_library', (select to_jsonb(l) - 'user_id' from public.onenote_library l where l.household_id = p_household),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object('id', ph.id, 'recipe_id', ph.recipe_id, 'path', ph.path, 'thumb_path', ph.thumb_path, 'width', ph.width, 'height', ph.height, 'bytes', ph.bytes, 'position', ph.position, 'created_at', ph.created_at, 'deleted_at', ph.deleted_at) order by ph.recipe_id, ph.position)
      from public.recipe_photos ph where ph.household_id = p_household
    ), '[]'::jsonb),
    'cook_log', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'recipe_id', c.recipe_id, 'user_id', c.user_id, 'cooked_on', c.cooked_on, 'rating', c.rating, 'note', c.note, 'created_at', c.created_at, 'deleted_at', c.deleted_at) order by c.recipe_id, c.cooked_on, c.created_at)
      from public.cook_log c where c.household_id = p_household
    ), '[]'::jsonb)
  );
$$;
