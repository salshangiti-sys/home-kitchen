-- Ingredients proposed for recipes whose OneNote page has no ingredient lines (the ingredients are
-- written inside the method or the notes). They are SUGGESTIONS: nothing is used (shopping list,
-- prep) until the owner or an editor confirms a line; she can edit or ignore each one. They live in
-- the app, apart from the recipe text, so a read from OneNote never overwrites them and they never
-- change OneNote. Each keeps the passage of the recipe it was taken from, to check it against.
--
-- When the page later gets a real ingredient section, the lines read from OneNote are the recipe's
-- ingredients and these stay as they were (the app shows them only where OneNote has none).
--
-- Part of the nightly backup and the restore (the two functions are wrapped, not rewritten).

create table public.recipe_ingredient_suggestions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  recipe_id text not null references public.recipes (id) on delete cascade,
  position integer not null,
  text text not null check (char_length(btrim(text)) between 1 and 200),
  quote text check (quote is null or char_length(quote) <= 400),
  status text not null default 'suggested' check (status in ('suggested', 'confirmed', 'ignored')),
  source text not null default 'method' check (source in ('method', 'notes', 'text', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recipe_id, text)
);
create index recipe_ingredient_suggestions_household_idx on public.recipe_ingredient_suggestions (household_id);
create index recipe_ingredient_suggestions_recipe_idx on public.recipe_ingredient_suggestions (recipe_id, position);

alter table public.recipe_ingredient_suggestions enable row level security;
revoke all on table public.recipe_ingredient_suggestions from anon, authenticated;
grant select on table public.recipe_ingredient_suggestions to authenticated;
grant all on table public.recipe_ingredient_suggestions to service_role;
create policy "members read ingredient suggestions" on public.recipe_ingredient_suggestions for select to authenticated
  using (private.is_household_member(household_id));

-- Confirm, ignore, or bring back a line, optionally with corrected text. Owners and editors.
create function public.set_ingredient_suggestion(p_id uuid, p_status text, p_text text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid uuid;
begin
  if p_status not in ('suggested', 'confirmed', 'ignored') then
    raise exception 'bad_status';
  end if;
  select s.household_id into hid from public.recipe_ingredient_suggestions s where s.id = p_id;
  if hid is null or not private.can_edit_household(hid) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.recipe_ingredient_suggestions s set
    status = p_status,
    text = coalesce(nullif(btrim(p_text), ''), s.text),
    updated_at = now()
  where s.id = p_id;
end;
$$;

-- A line the person writes herself: confirmed at once.
create function public.add_ingredient(p_recipe text, p_text text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid uuid;
  new_id uuid;
begin
  select r.household_id into hid from public.recipes r where r.id = p_recipe and r.deleted_at is null;
  if hid is null or not private.can_edit_household(hid) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.recipe_ingredient_suggestions (household_id, recipe_id, position, text, status, source)
  values (hid, p_recipe, coalesce((select max(s.position) from public.recipe_ingredient_suggestions s where s.recipe_id = p_recipe), 0) + 1, btrim(p_text), 'confirmed', 'manual')
  returning id into new_id;
  return new_id;
end;
$$;

-- Confirms every line still waiting for one recipe.
create function public.confirm_recipe_suggestions(p_recipe text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid uuid;
  n integer;
begin
  select r.household_id into hid from public.recipes r where r.id = p_recipe and r.deleted_at is null;
  if hid is null or not private.can_edit_household(hid) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.recipe_ingredient_suggestions s set status = 'confirmed', updated_at = now()
  where s.recipe_id = p_recipe and s.status = 'suggested';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Loads proposals: [{recipe_id, text, quote, source}]. For the server side only (the person never
-- calls it; she confirms what it loaded). A line already there for the recipe is skipped.
create function public.load_ingredient_suggestions(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  hid uuid;
  added integer := 0;
  skipped integer := 0;
begin
  for item in select value from jsonb_array_elements(p_items) loop
    select r.household_id into hid from public.recipes r where r.id = item ->> 'recipe_id' and r.deleted_at is null;
    if hid is null or exists (select 1 from public.recipe_ingredient_suggestions s where s.recipe_id = item ->> 'recipe_id' and s.text = btrim(item ->> 'text')) then
      skipped := skipped + 1;
      continue;
    end if;
    insert into public.recipe_ingredient_suggestions (household_id, recipe_id, position, text, quote, source)
    values (hid, item ->> 'recipe_id',
            coalesce((select max(s.position) from public.recipe_ingredient_suggestions s where s.recipe_id = item ->> 'recipe_id'), 0) + 1,
            btrim(item ->> 'text'), nullif(left(item ->> 'quote', 400), ''), coalesce(item ->> 'source', 'method'));
    added := added + 1;
  end loop;
  return jsonb_build_object('added', added, 'skipped', skipped);
end;
$$;

revoke all on function public.set_ingredient_suggestion(uuid, text, text) from public, anon;
grant execute on function public.set_ingredient_suggestion(uuid, text, text) to authenticated;
revoke all on function public.add_ingredient(text, text) from public, anon;
grant execute on function public.add_ingredient(text, text) to authenticated;
revoke all on function public.confirm_recipe_suggestions(text) from public, anon;
grant execute on function public.confirm_recipe_suggestions(text) to authenticated;
revoke all on function public.load_ingredient_suggestions(jsonb) from public, anon, authenticated;
grant execute on function public.load_ingredient_suggestions(jsonb) to service_role;

-- ---- backup and restore: wrap the existing functions, adding this part ----

alter function public.backup_bundle(uuid) rename to backup_bundle_core;

create function public.backup_bundle(p_household uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.backup_bundle_core(p_household) || jsonb_build_object(
    'ingredient_suggestions', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'recipe_id', s.recipe_id, 'position', s.position, 'text', s.text, 'quote', s.quote, 'status', s.status, 'source', s.source, 'created_at', s.created_at, 'updated_at', s.updated_at) order by s.recipe_id, s.position, s.id)
      from public.recipe_ingredient_suggestions s where s.household_id = p_household
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.backup_bundle(uuid) from public, anon, authenticated;
grant execute on function public.backup_bundle(uuid) to service_role;
revoke all on function public.backup_bundle_core(uuid) from public, anon, authenticated;
grant execute on function public.backup_bundle_core(uuid) to service_role;

alter function public.restore_from_backup(jsonb, boolean) rename to restore_from_backup_core;

create function public.restore_from_backup(p_bundle jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  res jsonb;
  items jsonb := coalesce(p_bundle -> 'ingredient_suggestions', '[]'::jsonb);
  hh uuid;
  added integer := 0;
begin
  -- the owner check, the file check and everything else are the existing function's
  res := public.restore_from_backup_core(p_bundle, p_dry_run);
  if jsonb_typeof(items) <> 'array' then
    items := '[]'::jsonb;
  end if;
  hh := private.my_edit_household();
  if p_dry_run then
    select count(*) into added from jsonb_array_elements(items) e
    where not exists (select 1 from public.recipe_ingredient_suggestions s where s.recipe_id = e ->> 'recipe_id' and s.text = e ->> 'text');
  else
    insert into public.recipe_ingredient_suggestions (id, household_id, recipe_id, position, text, quote, status, source, created_at, updated_at)
    select x.id, hh, x.recipe_id, x.position, x.text, x.quote, x.status, x.source, x.created_at, x.updated_at
    from jsonb_to_recordset(items) as x(id uuid, recipe_id text, position integer, text text, quote text, status text, source text, created_at timestamptz, updated_at timestamptz)
    join public.recipes r on r.id = x.recipe_id and r.household_id = hh
    on conflict do nothing;
    get diagnostics added = row_count;
  end if;
  return res || jsonb_build_object('ingredient_suggestions_added', added);
end;
$$;

revoke all on function public.restore_from_backup(jsonb, boolean) from public, anon;
grant execute on function public.restore_from_backup(jsonb, boolean) to authenticated;
revoke all on function public.restore_from_backup_core(jsonb, boolean) from public, anon, authenticated;
