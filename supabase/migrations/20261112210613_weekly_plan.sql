-- Phase 2, step 2a: the weekly plan.
--
-- - people: the family members a meal can be for (name, adult/child, allergies, notes). No age.
-- - meal_slots: breakfast, lunch, dinner, snack, extra by default; renamed, added, reordered by the
--   owner or an editor. A slot that has meals cannot be removed.
-- - plan_settings: the day a plan week starts (Saturday by default).
-- - week_plans, planned_meals: a week has meals on days and slots. A meal is a recipe or free text. Two
--   rows in the same day and slot are one meal of two recipes. The meal keeps the title it had when
--   planned. A recipe that is in a plan cannot be erased for good (the trash still works).
-- - slot_food_groups: manual changes to the food groups of a day's slot, on top of the union of its
--   recipes' groups: 'add' puts a group in, 'remove' takes one out.
--
-- Everyone in the household reads the plan; only owners and editors change it, through the
-- functions below (direct writes to the tables are not possible).

create table public.plan_settings (
  household_id uuid primary key references public.households (id) on delete cascade,
  -- 0 = Sunday ... 6 = Saturday
  week_start_dow smallint not null default 6 check (week_start_dow between 0 and 6)
);

create table public.people (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  kind text not null default 'adult' check (kind in ('adult', 'child')),
  allergies text[] not null default '{}',
  notes text check (char_length(notes) <= 500),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.meal_slots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.week_plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  week_start date not null,
  notes text check (char_length(notes) <= 1000),
  copied_from_id uuid references public.week_plans (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (household_id, week_start)
);

create table public.planned_meals (
  id uuid primary key default gen_random_uuid(),
  week_plan_id uuid not null references public.week_plans (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  day date not null,
  slot_id uuid not null references public.meal_slots (id) on delete restrict,
  recipe_id text references public.recipes (id) on delete restrict,
  title text not null,
  free_text text check (char_length(free_text) <= 120),
  servings numeric check (servings > 0 and servings <= 100),
  people uuid[] not null default '{}',
  position integer not null default 0,
  status text not null default 'planned' check (status in ('planned', 'cooked', 'skipped')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((recipe_id is not null) <> (free_text is not null))
);

create table public.slot_food_groups (
  week_plan_id uuid not null references public.week_plans (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  day date not null,
  slot_id uuid not null references public.meal_slots (id) on delete cascade,
  food_group text not null check (food_group in ('vegetables', 'protein', 'carbs', 'fruit', 'dairy')),
  mode text not null check (mode in ('add', 'remove')),
  primary key (week_plan_id, day, slot_id, food_group)
);

create index planned_meals_week on public.planned_meals (week_plan_id, day, slot_id, position);
create index planned_meals_household on public.planned_meals (household_id);
create index planned_meals_slot on public.planned_meals (slot_id);
create index planned_meals_recipe on public.planned_meals (recipe_id) where recipe_id is not null;
create index planned_meals_creator on public.planned_meals (created_by);
create index people_household on public.people (household_id);
create index meal_slots_household on public.meal_slots (household_id);
create index slot_food_groups_household on public.slot_food_groups (household_id);
create index slot_food_groups_slot on public.slot_food_groups (slot_id);
create index week_plans_copied_from on public.week_plans (copied_from_id);

do $$
declare t text;
begin
  foreach t in array array['plan_settings', 'people', 'meal_slots', 'week_plans', 'planned_meals', 'slot_food_groups'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (private.is_household_member(household_id))', t);
  end loop;
end $$;

-- The first day of the plan week that holds d, for a week that starts on day-of-week dow.
create function private.week_start_of(d date, dow smallint)
returns date
language sql
immutable
set search_path = ''
as $$
  select d - ((extract(dow from d)::integer - dow + 7) % 7);
$$;

grant execute on function private.week_start_of(date, smallint) to authenticated, service_role;

-- The household of the caller when they may change the plan; refuses everyone else.
create function private.plan_household()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare hh uuid := private.my_edit_household();
begin
  if hh is null then
    raise exception 'not allowed to change the plan' using errcode = '42501';
  end if;
  return hh;
end;
$$;

revoke all on function private.plan_household() from public, anon;
grant execute on function private.plan_household() to authenticated, service_role;

-- The plan week row for a day (created if missing).
create function private.week_plan_for(hh uuid, d date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  dow smallint := coalesce((select s.week_start_dow from public.plan_settings s where s.household_id = hh), 6);
  wstart date := private.week_start_of(d, dow);
  plan uuid;
begin
  if d < date '2000-01-01' or d > date '2100-12-31' then
    raise exception 'bad_date: the date is not valid' using errcode = 'P0001';
  end if;
  select w.id into plan from public.week_plans w where w.household_id = hh and w.week_start = wstart;
  if plan is null then
    insert into public.week_plans (household_id, week_start) values (hh, wstart) returning id into plan;
  end if;
  return plan;
end;
$$;

revoke all on function private.week_plan_for(uuid, date) from public, anon;
grant execute on function private.week_plan_for(uuid, date) to authenticated, service_role;

-- Settings and the default meal slots, made the first time an owner or editor opens the plan.
create function public.plan_defaults()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare hh uuid := private.plan_household();
begin
  insert into public.plan_settings (household_id) values (hh) on conflict do nothing;
  if not exists (select 1 from public.meal_slots s where s.household_id = hh) then
    insert into public.meal_slots (household_id, name, position)
    values (hh, 'فطور', 1), (hh, 'غداء', 2), (hh, 'عشاء', 3), (hh, 'سناك', 4), (hh, 'إضافي', 5);
  end if;
end;
$$;

create function public.set_week_start(p_dow integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare hh uuid := private.plan_household();
begin
  if p_dow is null or p_dow < 0 or p_dow > 6 then
    raise exception 'bad_day: the day must be 0 to 6' using errcode = 'P0001';
  end if;
  insert into public.plan_settings (household_id, week_start_dow) values (hh, p_dow)
  on conflict (household_id) do update set week_start_dow = excluded.week_start_dow;
end;
$$;

-- Adds a person (p_id null) or changes one.
create function public.save_person(p_id uuid, p_name text, p_kind text, p_allergies text[], p_notes text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  hh uuid := private.plan_household();
  clean text[] := coalesce(array(select btrim(a) from unnest(coalesce(p_allergies, '{}')) as a where btrim(a) <> ''), '{}');
  result uuid := p_id;
begin
  if p_kind not in ('adult', 'child') then
    raise exception 'bad_kind: adult or child' using errcode = 'P0001';
  end if;
  if result is null then
    insert into public.people (household_id, name, kind, allergies, notes, position)
    values (hh, btrim(p_name), p_kind, clean, nullif(btrim(p_notes), ''), coalesce((select max(p.position) from public.people p where p.household_id = hh), 0) + 1)
    returning id into result;
  else
    update public.people p set name = btrim(p_name), kind = p_kind, allergies = clean, notes = nullif(btrim(p_notes), '')
    where p.id = p_id and p.household_id = hh and p.deleted_at is null;
    if not found then
      raise exception 'person not found or not allowed' using errcode = '42501';
    end if;
  end if;
  return result;
end;
$$;

-- Hides a person (meals planned for them keep the link, which is simply not shown any more).
create function public.remove_person(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare hh uuid := private.plan_household();
begin
  update public.people p set deleted_at = now() where p.id = p_id and p.household_id = hh and p.deleted_at is null;
  if not found then
    raise exception 'person not found or not allowed' using errcode = '42501';
  end if;
end;
$$;

-- Adds a slot (p_id null) or renames/reorders one.
create function public.save_slot(p_id uuid, p_name text, p_position integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  hh uuid := private.plan_household();
  result uuid := p_id;
begin
  if result is null then
    insert into public.meal_slots (household_id, name, position)
    values (hh, btrim(p_name), coalesce(p_position, coalesce((select max(s.position) from public.meal_slots s where s.household_id = hh), 0) + 1))
    returning id into result;
  else
    update public.meal_slots s set name = btrim(p_name), position = coalesce(p_position, s.position)
    where s.id = p_id and s.household_id = hh and s.deleted_at is null;
    if not found then
      raise exception 'slot not found or not allowed' using errcode = '42501';
    end if;
  end if;
  return result;
end;
$$;

-- Hides a slot that has no meals in any week.
create function public.remove_slot(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare hh uuid := private.plan_household();
begin
  if not exists (select 1 from public.meal_slots s where s.id = p_id and s.household_id = hh and s.deleted_at is null) then
    raise exception 'slot not found or not allowed' using errcode = '42501';
  end if;
  if exists (select 1 from public.planned_meals m where m.slot_id = p_id) then
    raise exception 'slot_in_use: this slot has planned meals' using errcode = 'P0001';
  end if;
  update public.meal_slots s set deleted_at = now() where s.id = p_id;
end;
$$;

-- People ids that really are active members of the household's family list.
create function private.active_people(hh uuid, ids uuid[])
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array(select p.id from public.people p where p.household_id = hh and p.deleted_at is null and p.id = any(coalesce(ids, '{}')) order by p.position), '{}');
$$;

revoke all on function private.active_people(uuid, uuid[]) from public, anon;
grant execute on function private.active_people(uuid, uuid[]) to authenticated, service_role;

-- Adds a meal to a day and slot: a recipe, or free text.
create function public.add_planned_meal(p_day date, p_slot uuid, p_recipe_id text, p_free_text text, p_servings numeric, p_people uuid[])
returns public.planned_meals
language plpgsql
security definer
set search_path = ''
as $$
declare
  hh uuid := private.plan_household();
  plan uuid;
  r public.recipes%rowtype;
  text_clean text := nullif(btrim(p_free_text), '');
  result public.planned_meals;
begin
  if (p_recipe_id is null) = (text_clean is null) then
    raise exception 'bad_meal: give a recipe or free text, not both' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.meal_slots s where s.id = p_slot and s.household_id = hh and s.deleted_at is null) then
    raise exception 'slot not found or not allowed' using errcode = '42501';
  end if;
  if p_recipe_id is not null then
    select * into r from public.recipes x where x.id = p_recipe_id and x.household_id = hh;
    if not found or r.deleted_at is not null then
      raise exception 'recipe not found or in the trash' using errcode = 'P0001';
    end if;
  end if;
  plan := private.week_plan_for(hh, p_day);
  insert into public.planned_meals (week_plan_id, household_id, day, slot_id, recipe_id, title, free_text, servings, people, position, created_by)
  values (
    plan, hh, p_day, p_slot, r.id, coalesce(r.title, text_clean), text_clean, p_servings, private.active_people(hh, p_people),
    coalesce((select max(m.position) from public.planned_meals m where m.week_plan_id = plan and m.day = p_day and m.slot_id = p_slot), 0) + 1,
    (select auth.uid())
  )
  returning * into result;
  return result;
end;
$$;

-- Changes a meal's servings, people or status.
create function public.update_planned_meal(p_id uuid, p_servings numeric, p_people uuid[], p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare hh uuid := private.plan_household();
begin
  if p_status not in ('planned', 'cooked', 'skipped') then
    raise exception 'bad_status: planned, cooked or skipped' using errcode = 'P0001';
  end if;
  update public.planned_meals m
  set servings = p_servings, people = private.active_people(hh, p_people), status = p_status
  where m.id = p_id and m.household_id = hh;
  if not found then
    raise exception 'meal not found or not allowed' using errcode = '42501';
  end if;
end;
$$;

-- Moves a meal to another day (any week) and slot, at the end of what is there.
create function public.move_planned_meal(p_id uuid, p_day date, p_slot uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  hh uuid := private.plan_household();
  plan uuid;
begin
  if not exists (select 1 from public.planned_meals m where m.id = p_id and m.household_id = hh) then
    raise exception 'meal not found or not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.meal_slots s where s.id = p_slot and s.household_id = hh and s.deleted_at is null) then
    raise exception 'slot not found or not allowed' using errcode = '42501';
  end if;
  plan := private.week_plan_for(hh, p_day);
  update public.planned_meals m
  set week_plan_id = plan, day = p_day, slot_id = p_slot,
      position = coalesce((select max(x.position) from public.planned_meals x where x.week_plan_id = plan and x.day = p_day and x.slot_id = p_slot and x.id <> p_id), 0) + 1
  where m.id = p_id;
end;
$$;

-- Removes a meal from the plan (the recipe is untouched).
create function public.remove_planned_meal(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare hh uuid := private.plan_household();
begin
  delete from public.planned_meals m where m.id = p_id and m.household_id = hh;
  if not found then
    raise exception 'meal not found or not allowed' using errcode = '42501';
  end if;
end;
$$;

-- Copies a whole week onto another week that has no meals yet. Meals of recipes that are now in the
-- trash or gone are skipped and counted. Returns { copied, skipped }.
create function public.copy_week(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  hh uuid := private.plan_household();
  dow smallint := coalesce((select s.week_start_dow from public.plan_settings s where s.household_id = hh), 6);
  from_start date := private.week_start_of(p_from, dow);
  to_start date := private.week_start_of(p_to, dow);
  from_plan uuid;
  to_plan uuid;
  shift integer := to_start - from_start;
  m public.planned_meals;
  copied integer := 0;
  skipped integer := 0;
begin
  if from_start = to_start then
    raise exception 'same_week: choose a different week' using errcode = 'P0001';
  end if;
  select w.id into from_plan from public.week_plans w where w.household_id = hh and w.week_start = from_start;
  if from_plan is null or not exists (select 1 from public.planned_meals x where x.week_plan_id = from_plan) then
    raise exception 'nothing_to_copy: that week has no meals' using errcode = 'P0001';
  end if;
  to_plan := private.week_plan_for(hh, to_start);
  if exists (select 1 from public.planned_meals x where x.week_plan_id = to_plan) then
    raise exception 'target_not_empty: the week you copy to already has meals' using errcode = 'P0001';
  end if;
  update public.week_plans set copied_from_id = from_plan where id = to_plan;

  for m in select * from public.planned_meals x where x.week_plan_id = from_plan order by x.day, x.slot_id, x.position loop
    if m.recipe_id is not null and not exists (select 1 from public.recipes r where r.id = m.recipe_id and r.deleted_at is null) then
      skipped := skipped + 1;
      continue;
    end if;
    insert into public.planned_meals (week_plan_id, household_id, day, slot_id, recipe_id, title, free_text, servings, people, position, created_by)
    values (to_plan, hh, m.day + shift, m.slot_id, m.recipe_id,
            coalesce((select r.title from public.recipes r where r.id = m.recipe_id), m.title), m.free_text, m.servings,
            private.active_people(hh, m.people), m.position, (select auth.uid()));
    copied := copied + 1;
  end loop;

  insert into public.slot_food_groups (week_plan_id, household_id, day, slot_id, food_group, mode)
  select to_plan, hh, g.day + shift, g.slot_id, g.food_group, g.mode from public.slot_food_groups g where g.week_plan_id = from_plan;

  return jsonb_build_object('copied', copied, 'skipped', skipped);
end;
$$;

-- Sets the manual food-group changes of a day's slot (replacing the earlier ones). p_add puts groups
-- in on top of its recipes' groups, p_remove takes some out. Both empty clears the changes.
create function public.set_slot_food_groups(p_day date, p_slot uuid, p_add text[], p_remove text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  hh uuid := private.plan_household();
  plan uuid;
  adds text[] := coalesce(array(select distinct g from unnest(coalesce(p_add, '{}')) as g), '{}');
  removes text[] := coalesce(array(select distinct g from unnest(coalesce(p_remove, '{}')) as g), '{}');
begin
  if not exists (select 1 from public.meal_slots s where s.id = p_slot and s.household_id = hh and s.deleted_at is null) then
    raise exception 'slot not found or not allowed' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(adds || removes) as g where g not in ('vegetables', 'protein', 'carbs', 'fruit', 'dairy')) then
    raise exception 'bad_group: unknown food group' using errcode = 'P0001';
  end if;
  if adds && removes then
    raise exception 'bad_group: a group cannot be both added and removed' using errcode = 'P0001';
  end if;
  plan := private.week_plan_for(hh, p_day);
  delete from public.slot_food_groups g where g.week_plan_id = plan and g.day = p_day and g.slot_id = p_slot;
  insert into public.slot_food_groups (week_plan_id, household_id, day, slot_id, food_group, mode)
  select plan, hh, p_day, p_slot, g, 'add' from unnest(adds) as g
  union all
  select plan, hh, p_day, p_slot, g, 'remove' from unnest(removes) as g;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.plan_defaults()', 'public.set_week_start(integer)', 'public.save_person(uuid, text, text, text[], text)',
    'public.remove_person(uuid)', 'public.save_slot(uuid, text, integer)', 'public.remove_slot(uuid)',
    'public.add_planned_meal(date, uuid, text, text, numeric, uuid[])', 'public.update_planned_meal(uuid, numeric, uuid[], text)',
    'public.move_planned_meal(uuid, date, uuid)', 'public.remove_planned_meal(uuid)', 'public.copy_week(date, date)',
    'public.set_slot_food_groups(date, uuid, text[], text[])'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
