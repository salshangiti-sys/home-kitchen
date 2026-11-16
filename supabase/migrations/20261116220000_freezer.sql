-- What is in the freezer ("مخزون الفريزر"): each item has a name, a quantity with its unit, the day it was
-- frozen, an optional link to a recipe page (e.g. «كرات لحم» in the section «مفرزنات») and a free note.
-- Owners and editors write, through these functions; everyone in the household reads.
-- «استعملت» takes one (or an amount) off, and the item is removed when nothing is left.

create table public.freezer_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  quantity numeric not null check (quantity > 0 and quantity <= 100000),
  unit text not null default 'قطعة' check (char_length(btrim(unit)) between 1 and 20),
  frozen_on date not null default current_date,
  recipe_id text references public.recipes (id) on delete set null,
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index freezer_items_household on public.freezer_items (household_id);
create index freezer_items_recipe on public.freezer_items (recipe_id);

alter table public.freezer_items enable row level security;
revoke all on table public.freezer_items from anon, authenticated;
grant select on table public.freezer_items to authenticated;
grant all on table public.freezer_items to service_role;
create policy "members read freezer items" on public.freezer_items for select to authenticated using (private.is_household_member(household_id));

-- Adds an item (p_id null) or changes one. Returns its id.
create function public.save_freezer_item(p_id uuid, p_name text, p_quantity numeric, p_unit text, p_frozen_on date, p_recipe_id text, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid uuid := private.my_edit_household();
  rid text := nullif(btrim(coalesce(p_recipe_id, '')), '');
  out_id uuid;
begin
  if hid is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if rid is not null and not exists (select 1 from public.recipes r where r.id = rid and r.household_id = hid and r.deleted_at is null) then
    raise exception 'recipe_not_found' using errcode = 'P0001';
  end if;
  if p_id is null then
    insert into public.freezer_items (household_id, name, quantity, unit, frozen_on, recipe_id, note)
    values (hid, btrim(p_name), p_quantity, coalesce(nullif(btrim(coalesce(p_unit, '')), ''), 'قطعة'), coalesce(p_frozen_on, current_date), rid, nullif(btrim(coalesce(p_note, '')), ''))
    returning id into out_id;
  else
    update public.freezer_items f set
      name = btrim(p_name),
      quantity = p_quantity,
      unit = coalesce(nullif(btrim(coalesce(p_unit, '')), ''), 'قطعة'),
      frozen_on = coalesce(p_frozen_on, f.frozen_on),
      recipe_id = rid,
      note = nullif(btrim(coalesce(p_note, '')), ''),
      updated_at = now()
    where f.id = p_id and f.household_id = hid
    returning f.id into out_id;
    if out_id is null then
      raise exception 'item_not_found' using errcode = 'P0001';
    end if;
  end if;
  return out_id;
end;
$$;

-- Takes an amount off an item (one by default). Removes the item when nothing is left. Returns what is left.
create function public.use_freezer_item(p_id uuid, p_amount numeric default 1)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid uuid := private.my_edit_household();
  left_over numeric;
begin
  if hid is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'bad_amount' using errcode = 'P0001';
  end if;
  update public.freezer_items f set quantity = f.quantity - p_amount, updated_at = now()
  where f.id = p_id and f.household_id = hid
  returning f.quantity into left_over;
  if left_over is null then
    raise exception 'item_not_found' using errcode = 'P0001';
  end if;
  if left_over <= 0 then
    delete from public.freezer_items where id = p_id and household_id = hid;
    return 0;
  end if;
  return left_over;
end;
$$;

create function public.remove_freezer_item(p_id uuid)
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
  delete from public.freezer_items where id = p_id and household_id = hid;
end;
$$;

revoke all on function public.save_freezer_item(uuid, text, numeric, text, date, text, text) from public, anon;
grant execute on function public.save_freezer_item(uuid, text, numeric, text, date, text, text) to authenticated;
revoke all on function public.use_freezer_item(uuid, numeric) from public, anon;
grant execute on function public.use_freezer_item(uuid, numeric) to authenticated;
revoke all on function public.remove_freezer_item(uuid) from public, anon;
grant execute on function public.remove_freezer_item(uuid) to authenticated;

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
    ), '[]'::jsonb),
    'ingredient_aliases', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'name_key', a.name_key, 'target', a.target, 'aisle', a.aisle, 'created_at', a.created_at, 'updated_at', a.updated_at) order by a.name_key)
      from public.ingredient_aliases a where a.household_id = p_household
    ), '[]'::jsonb),
    'freezer_items', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'quantity', f.quantity, 'unit', f.unit, 'frozen_on', f.frozen_on, 'recipe_id', f.recipe_id, 'note', f.note, 'created_at', f.created_at, 'updated_at', f.updated_at) order by f.name, f.id)
      from public.freezer_items f where f.household_id = p_household
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
  aliases jsonb := coalesce(p_bundle -> 'ingredient_aliases', '[]'::jsonb);
  freezer jsonb := coalesce(p_bundle -> 'freezer_items', '[]'::jsonb);
  hh uuid;
  v_suggestions integer := 0;
  v_marks integer := 0;
  v_pantry integer := 0;
  v_quantities integer := 0;
  v_aliases integer := 0;
  v_freezer integer := 0;
begin
  res := public.restore_from_backup_core(p_bundle, p_dry_run);
  if jsonb_typeof(suggestions) <> 'array' then suggestions := '[]'::jsonb; end if;
  if jsonb_typeof(marks) <> 'array' then marks := '[]'::jsonb; end if;
  if jsonb_typeof(pantry) <> 'array' then pantry := '[]'::jsonb; end if;
  if jsonb_typeof(quantities) <> 'array' then quantities := '[]'::jsonb; end if;
  if jsonb_typeof(aliases) <> 'array' then aliases := '[]'::jsonb; end if;
  if jsonb_typeof(freezer) <> 'array' then freezer := '[]'::jsonb; end if;
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
    select count(*) into v_aliases from jsonb_array_elements(aliases) e
    where not exists (select 1 from public.ingredient_aliases a where a.household_id = hh and a.name_key = e ->> 'name_key');
    select count(*) into v_freezer from jsonb_array_elements(freezer) e
    where not exists (select 1 from public.freezer_items f where f.id = (e ->> 'id')::uuid);
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
    insert into public.ingredient_aliases (id, household_id, name_key, target, aisle, created_at, updated_at)
    select x.id, hh, x.name_key, x.target, x.aisle, x.created_at, x.updated_at
    from jsonb_to_recordset(aliases) as x(id uuid, name_key text, target text, aisle text, created_at timestamptz, updated_at timestamptz)
    on conflict do nothing;
    get diagnostics v_aliases = row_count;
    -- the link to a recipe is kept only when that recipe is in this household
    insert into public.freezer_items (id, household_id, name, quantity, unit, frozen_on, recipe_id, note, created_at, updated_at)
    select x.id, hh, x.name, x.quantity, x.unit, x.frozen_on, r.id, x.note, x.created_at, x.updated_at
    from jsonb_to_recordset(freezer) as x(id uuid, name text, quantity numeric, unit text, frozen_on date, recipe_id text, note text, created_at timestamptz, updated_at timestamptz)
    left join public.recipes r on r.id = x.recipe_id and r.household_id = hh
    on conflict do nothing;
    get diagnostics v_freezer = row_count;
  end if;
  return res || jsonb_build_object('ingredient_suggestions_added', v_suggestions, 'shopping_marks_added', v_marks, 'pantry_items_added', v_pantry, 'quantity_confirmations_added', v_quantities, 'ingredient_aliases_added', v_aliases, 'freezer_items_added', v_freezer);
end;
$$;

revoke all on function public.restore_from_backup(jsonb, boolean) from public, anon;
grant execute on function public.restore_from_backup(jsonb, boolean) to authenticated;
revoke all on function public.backup_bundle(uuid) from public, anon, authenticated;
grant execute on function public.backup_bundle(uuid) to service_role;
