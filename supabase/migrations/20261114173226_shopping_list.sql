-- The shopping list. The list itself is worked out in the app from the week's meals and the ingredient
-- lines of their recipes (so it is always up to date after the plan changes); only what the person DOES
-- to it is kept here, per week and per item name:
--   shopping_marks   "bought" / "I have it" / "to buy" for an item, and the items she added by hand.
--                    Keyed by the item's name (see src/shopping/catalog.ts), so changing the plan, which
--                    makes the list work out again, never loses a tick or a manual item.
--   pantry_items     things kept at home ("متوفر في البيت") for every week, until she removes them.
-- Owners and editors write, through these functions; everyone in the household reads.
-- Both are part of the nightly backup and the restore (the wrapper functions are extended here).

create table public.shopping_marks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  week_start date not null check (week_start between date '2000-01-01' and date '2100-12-31'),
  key text not null check (char_length(btrim(key)) between 1 and 120),
  label text check (label is null or char_length(btrim(label)) between 1 and 120),
  status text not null default 'needed' check (status in ('needed', 'have', 'bought')),
  is_manual boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, week_start, key),
  check (not is_manual or label is not null)
);
create index shopping_marks_week_idx on public.shopping_marks (household_id, week_start);

create table public.pantry_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  key text not null check (char_length(btrim(key)) between 1 and 120),
  label text not null check (char_length(btrim(label)) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (household_id, key)
);

alter table public.shopping_marks enable row level security;
alter table public.pantry_items enable row level security;
revoke all on table public.shopping_marks, public.pantry_items from anon, authenticated;
grant select on table public.shopping_marks, public.pantry_items to authenticated;
grant all on table public.shopping_marks, public.pantry_items to service_role;
create policy "members read shopping marks" on public.shopping_marks for select to authenticated using (private.is_household_member(household_id));
create policy "members read pantry" on public.pantry_items for select to authenticated using (private.is_household_member(household_id));

-- Tick an item of a week ("to buy", "I have it", "bought"). An item of the list that has no mark yet gets one.
create function public.set_shopping_mark(p_week date, p_key text, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid uuid := private.my_edit_household();
begin
  if hid is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_status not in ('needed', 'have', 'bought') then
    raise exception 'bad_status';
  end if;
  insert into public.shopping_marks (household_id, week_start, key, status)
  values (hid, p_week, btrim(p_key), p_status)
  on conflict (household_id, week_start, key) do update set status = excluded.status, updated_at = now();
end;
$$;

-- An item she adds by hand (or a manual one she re-adds).
create function public.add_shopping_item(p_week date, p_key text, p_label text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid uuid := private.my_edit_household();
begin
  if hid is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.shopping_marks (household_id, week_start, key, label, status, is_manual)
  values (hid, p_week, btrim(p_key), btrim(p_label), 'needed', true)
  on conflict (household_id, week_start, key) do update set
    label = coalesce(public.shopping_marks.label, excluded.label),
    is_manual = true,
    status = 'needed',
    updated_at = now();
end;
$$;

-- Takes the person's mark off an item: a derived item goes back to its default, a manual item is removed.
create function public.clear_shopping_mark(p_week date, p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid uuid := private.my_edit_household();
begin
  if hid is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.shopping_marks where household_id = hid and week_start = p_week and key = btrim(p_key);
end;
$$;

-- Keeps (p_on) or stops keeping an item at home for every week.
create function public.set_pantry_item(p_key text, p_label text, p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid uuid := private.my_edit_household();
begin
  if hid is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_on then
    insert into public.pantry_items (household_id, key, label) values (hid, btrim(p_key), btrim(p_label)) on conflict (household_id, key) do nothing;
  else
    delete from public.pantry_items where household_id = hid and key = btrim(p_key);
  end if;
end;
$$;

revoke all on function public.set_shopping_mark(date, text, text) from public, anon;
grant execute on function public.set_shopping_mark(date, text, text) to authenticated;
revoke all on function public.add_shopping_item(date, text, text) from public, anon;
grant execute on function public.add_shopping_item(date, text, text) to authenticated;
revoke all on function public.clear_shopping_mark(date, text) from public, anon;
grant execute on function public.clear_shopping_mark(date, text) to authenticated;
revoke all on function public.set_pantry_item(text, text, boolean) from public, anon;
grant execute on function public.set_pantry_item(text, text, boolean) to authenticated;

-- ---- backup and restore: the wrappers now carry these two parts too ----

create or replace function public.backup_bundle(p_household uuid)
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
    ), '[]'::jsonb),
    'shopping_marks', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'week_start', m.week_start, 'key', m.key, 'label', m.label, 'status', m.status, 'is_manual', m.is_manual, 'created_at', m.created_at, 'updated_at', m.updated_at) order by m.week_start, m.key)
      from public.shopping_marks m where m.household_id = p_household
    ), '[]'::jsonb),
    'pantry_items', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'key', p.key, 'label', p.label, 'created_at', p.created_at) order by p.key)
      from public.pantry_items p where p.household_id = p_household
    ), '[]'::jsonb)
  );
$$;

create or replace function public.restore_from_backup(p_bundle jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  res jsonb;
  suggestions jsonb := coalesce(p_bundle -> 'ingredient_suggestions', '[]'::jsonb);
  marks jsonb := coalesce(p_bundle -> 'shopping_marks', '[]'::jsonb);
  pantry jsonb := coalesce(p_bundle -> 'pantry_items', '[]'::jsonb);
  hh uuid;
  v_suggestions integer := 0;
  v_marks integer := 0;
  v_pantry integer := 0;
begin
  -- the owner check, the file check and everything else are the existing function's
  res := public.restore_from_backup_core(p_bundle, p_dry_run);
  if jsonb_typeof(suggestions) <> 'array' then suggestions := '[]'::jsonb; end if;
  if jsonb_typeof(marks) <> 'array' then marks := '[]'::jsonb; end if;
  if jsonb_typeof(pantry) <> 'array' then pantry := '[]'::jsonb; end if;
  hh := private.my_edit_household();
  if p_dry_run then
    select count(*) into v_suggestions from jsonb_array_elements(suggestions) e
    where not exists (select 1 from public.recipe_ingredient_suggestions s where s.recipe_id = e ->> 'recipe_id' and s.text = e ->> 'text');
    select count(*) into v_marks from jsonb_array_elements(marks) e
    where not exists (select 1 from public.shopping_marks m where m.household_id = hh and m.week_start = (e ->> 'week_start')::date and m.key = e ->> 'key');
    select count(*) into v_pantry from jsonb_array_elements(pantry) e
    where not exists (select 1 from public.pantry_items p where p.household_id = hh and p.key = e ->> 'key');
  else
    insert into public.recipe_ingredient_suggestions (id, household_id, recipe_id, position, text, quote, status, source, created_at, updated_at)
    select x.id, hh, x.recipe_id, x.position, x.text, x.quote, x.status, x.source, x.created_at, x.updated_at
    from jsonb_to_recordset(suggestions) as x(id uuid, recipe_id text, position integer, text text, quote text, status text, source text, created_at timestamptz, updated_at timestamptz)
    join public.recipes r on r.id = x.recipe_id and r.household_id = hh
    on conflict do nothing;
    get diagnostics v_suggestions = row_count;
    insert into public.shopping_marks (id, household_id, week_start, key, label, status, is_manual, created_at, updated_at)
    select x.id, hh, x.week_start, x.key, x.label, x.status, x.is_manual, x.created_at, x.updated_at
    from jsonb_to_recordset(marks) as x(id uuid, week_start date, key text, label text, status text, is_manual boolean, created_at timestamptz, updated_at timestamptz)
    on conflict do nothing;
    get diagnostics v_marks = row_count;
    insert into public.pantry_items (id, household_id, key, label, created_at)
    select x.id, hh, x.key, x.label, x.created_at
    from jsonb_to_recordset(pantry) as x(id uuid, key text, label text, created_at timestamptz)
    on conflict do nothing;
    get diagnostics v_pantry = row_count;
  end if;
  return res || jsonb_build_object('ingredient_suggestions_added', v_suggestions, 'shopping_marks_added', v_marks, 'pantry_items_added', v_pantry);
end;
$$;

revoke all on function public.restore_from_backup(jsonb, boolean) from public, anon;
grant execute on function public.restore_from_backup(jsonb, boolean) to authenticated;
revoke all on function public.backup_bundle(uuid) from public, anon, authenticated;
grant execute on function public.backup_bundle(uuid) to service_role;
