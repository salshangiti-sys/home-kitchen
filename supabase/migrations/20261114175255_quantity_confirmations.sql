-- Quantities the person has CONFIRMED on a recipe's ingredient line. The shopping list adds up only
-- confirmed quantities (and only compatible units, see src/shopping/quantity.ts); a quantity the parser
-- merely read from a line is a suggestion and is never added. A confirmation belongs to a recipe line
-- (by its exact text) and to the shopping item it counts for (a line that lists several ingredients can
-- be confirmed for each), so it holds for every week, and stops applying if the line is rewritten in
-- OneNote (the new text has not been confirmed). Owners and editors write, through these functions.

create table public.quantity_confirmations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  recipe_id text not null references public.recipes (id) on delete cascade,
  line text not null check (char_length(btrim(line)) between 1 and 400),
  item_key text not null check (char_length(btrim(item_key)) between 1 and 120),
  quantity numeric not null check (quantity > 0 and quantity <= 100000),
  unit text check (unit is null or unit in ('g', 'kg', 'ml', 'l', 'cup', 'tbsp', 'tsp', 'spoon', 'pinch', 'piece', 'clove', 'can', 'pack', 'bunch')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, recipe_id, line, item_key)
);
create index quantity_confirmations_recipe_idx on public.quantity_confirmations (recipe_id);

alter table public.quantity_confirmations enable row level security;
revoke all on table public.quantity_confirmations from anon, authenticated;
grant select on table public.quantity_confirmations to authenticated;
grant all on table public.quantity_confirmations to service_role;
create policy "members read quantity confirmations" on public.quantity_confirmations for select to authenticated using (private.is_household_member(household_id));

create function public.confirm_quantity(p_recipe text, p_line text, p_key text, p_quantity numeric, p_unit text)
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
  if not exists (select 1 from public.recipes r where r.id = p_recipe and r.household_id = hid) then
    raise exception 'recipe not found';
  end if;
  insert into public.quantity_confirmations (household_id, recipe_id, line, item_key, quantity, unit)
  values (hid, p_recipe, p_line, btrim(p_key), round(p_quantity, 4), p_unit)
  on conflict (household_id, recipe_id, line, item_key) do update set quantity = excluded.quantity, unit = excluded.unit, updated_at = now();
end;
$$;

create function public.unconfirm_quantity(p_recipe text, p_line text, p_key text)
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
  delete from public.quantity_confirmations where household_id = hid and recipe_id = p_recipe and line = p_line and item_key = btrim(p_key);
end;
$$;

revoke all on function public.confirm_quantity(text, text, text, numeric, text) from public, anon;
grant execute on function public.confirm_quantity(text, text, text, numeric, text) to authenticated;
revoke all on function public.unconfirm_quantity(text, text, text) from public, anon;
grant execute on function public.unconfirm_quantity(text, text, text) to authenticated;

-- ---- backup and restore: the wrappers carry this part too ----

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
    ), '[]'::jsonb),
    'quantity_confirmations', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'recipe_id', q.recipe_id, 'line', q.line, 'item_key', q.item_key, 'quantity', q.quantity, 'unit', q.unit, 'created_at', q.created_at, 'updated_at', q.updated_at) order by q.recipe_id, q.line, q.item_key)
      from public.quantity_confirmations q where q.household_id = p_household
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
  quantities jsonb := coalesce(p_bundle -> 'quantity_confirmations', '[]'::jsonb);
  hh uuid;
  v_suggestions integer := 0;
  v_marks integer := 0;
  v_pantry integer := 0;
  v_quantities integer := 0;
begin
  res := public.restore_from_backup_core(p_bundle, p_dry_run);
  if jsonb_typeof(suggestions) <> 'array' then suggestions := '[]'::jsonb; end if;
  if jsonb_typeof(marks) <> 'array' then marks := '[]'::jsonb; end if;
  if jsonb_typeof(pantry) <> 'array' then pantry := '[]'::jsonb; end if;
  if jsonb_typeof(quantities) <> 'array' then quantities := '[]'::jsonb; end if;
  hh := private.my_edit_household();
  if p_dry_run then
    select count(*) into v_suggestions from jsonb_array_elements(suggestions) e
    where not exists (select 1 from public.recipe_ingredient_suggestions s where s.recipe_id = e ->> 'recipe_id' and s.text = e ->> 'text');
    select count(*) into v_marks from jsonb_array_elements(marks) e
    where not exists (select 1 from public.shopping_marks m where m.household_id = hh and m.week_start = (e ->> 'week_start')::date and m.key = e ->> 'key');
    select count(*) into v_pantry from jsonb_array_elements(pantry) e
    where not exists (select 1 from public.pantry_items p where p.household_id = hh and p.key = e ->> 'key');
    select count(*) into v_quantities from jsonb_array_elements(quantities) e
    where not exists (select 1 from public.quantity_confirmations q where q.household_id = hh and q.recipe_id = e ->> 'recipe_id' and q.line = e ->> 'line' and q.item_key = e ->> 'item_key');
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
    insert into public.quantity_confirmations (id, household_id, recipe_id, line, item_key, quantity, unit, created_at, updated_at)
    select x.id, hh, x.recipe_id, x.line, x.item_key, x.quantity, x.unit, x.created_at, x.updated_at
    from jsonb_to_recordset(quantities) as x(id uuid, recipe_id text, line text, item_key text, quantity numeric, unit text, created_at timestamptz, updated_at timestamptz)
    join public.recipes r on r.id = x.recipe_id and r.household_id = hh
    on conflict do nothing;
    get diagnostics v_quantities = row_count;
  end if;
  return res || jsonb_build_object('ingredient_suggestions_added', v_suggestions, 'shopping_marks_added', v_marks, 'pantry_items_added', v_pantry, 'quantity_confirmations_added', v_quantities);
end;
$$;

revoke all on function public.restore_from_backup(jsonb, boolean) from public, anon;
grant execute on function public.restore_from_backup(jsonb, boolean) to authenticated;
revoke all on function public.backup_bundle(uuid) from public, anon, authenticated;
grant execute on function public.backup_bundle(uuid) to service_role;
