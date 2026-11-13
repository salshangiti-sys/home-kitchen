-- Phase 2, step 2d: prep tasks ("مهام التجهيز").
--
-- - recipe_prep_templates: what a recipe needs before cooking, written by the owner or an editor:
--   defrost, wash and chop, marinade/spices, sauce, other; with a timing (the night before, in the
--   morning, before cooking, or at a given time). The app never makes up durations.
-- - prep_tasks: the tasks for planned meals, made from the templates of the recipes in the plan, plus
--   tasks added by hand. A task has the day it is due (the night-before ones are due the day before the
--   meal). Everyone in the household can tick a task; only owners and editors make or change them.
--
-- Regenerating (generate_prep_tasks) follows the same rule as the shopping list will: it adds tasks
-- for templates that have none yet, brings untouched, not-yet-done tasks up to date with their
-- template and meal (the day moves with the meal), and removes untouched tasks whose template is
-- gone or whose meal was skipped. It never changes a task you edited, a task that is done, or one you
-- dismissed, and never brings a dismissed task back.

create table public.recipe_prep_templates (
  id uuid primary key default gen_random_uuid(),
  recipe_id text not null references public.recipes (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  kind text not null default 'other' check (kind in ('defrost', 'wash_chop', 'marinade', 'sauce', 'other')),
  timing text not null check (timing in ('night_before', 'morning', 'before_cooking', 'at_time')),
  at_time time,
  body text not null check (char_length(btrim(body)) between 1 and 200),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  check ((timing = 'at_time') = (at_time is not null))
);

create table public.prep_tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  planned_meal_id uuid references public.planned_meals (id) on delete cascade,
  day date not null,
  timing text not null check (timing in ('night_before', 'morning', 'before_cooking', 'at_time')),
  at_time time,
  kind text not null default 'other' check (kind in ('defrost', 'wash_chop', 'marinade', 'sauce', 'other')),
  body text not null check (char_length(btrim(body)) between 1 and 200),
  template_id uuid references public.recipe_prep_templates (id) on delete set null,
  from_template boolean not null default false,
  manually_edited boolean not null default false,
  dismissed_at timestamptz,
  done_at timestamptz,
  done_by uuid references auth.users (id) on delete set null,
  position integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((timing = 'at_time') = (at_time is not null))
);

create unique index prep_tasks_template_once on public.prep_tasks (planned_meal_id, template_id) where template_id is not null;
create index prep_tasks_household_day on public.prep_tasks (household_id, day);
create index prep_tasks_meal on public.prep_tasks (planned_meal_id);
create index prep_tasks_template on public.prep_tasks (template_id);
create index prep_tasks_done_by on public.prep_tasks (done_by);
create index prep_tasks_created_by on public.prep_tasks (created_by);
create index prep_templates_recipe on public.recipe_prep_templates (recipe_id, position);
create index prep_templates_household on public.recipe_prep_templates (household_id);

do $$
declare t text;
begin
  foreach t in array array['recipe_prep_templates', 'prep_tasks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (private.is_household_member(household_id))', t);
  end loop;
end $$;

-- The day a task of this timing is due for a meal on meal_day.
create function private.prep_due(meal_day date, timing text)
returns date
language sql
immutable
set search_path = ''
as $$
  select case when timing = 'night_before' then meal_day - 1 else meal_day end;
$$;

grant execute on function private.prep_due(date, text) to authenticated, service_role;

create function public.save_prep_template(p_id uuid, p_recipe_id text, p_kind text, p_timing text, p_at_time time, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  hh uuid := private.plan_household();
  result uuid := p_id;
begin
  if p_kind not in ('defrost', 'wash_chop', 'marinade', 'sauce', 'other') then
    raise exception 'bad_kind: unknown kind' using errcode = 'P0001';
  end if;
  if p_timing not in ('night_before', 'morning', 'before_cooking', 'at_time') or (p_timing = 'at_time') <> (p_at_time is not null) then
    raise exception 'bad_timing: a time is needed exactly when the timing is "at a time"' using errcode = 'P0001';
  end if;
  if result is null then
    if not exists (select 1 from public.recipes r where r.id = p_recipe_id and r.household_id = hh and r.deleted_at is null) then
      raise exception 'recipe not found or in the trash' using errcode = 'P0001';
    end if;
    insert into public.recipe_prep_templates (recipe_id, household_id, kind, timing, at_time, body, position)
    values (p_recipe_id, hh, p_kind, p_timing, p_at_time, btrim(p_body),
            coalesce((select max(t.position) from public.recipe_prep_templates t where t.recipe_id = p_recipe_id), 0) + 1)
    returning id into result;
  else
    update public.recipe_prep_templates t set kind = p_kind, timing = p_timing, at_time = p_at_time, body = btrim(p_body)
    where t.id = p_id and t.household_id = hh;
    if not found then
      raise exception 'template not found or not allowed' using errcode = '42501';
    end if;
  end if;
  return result;
end;
$$;

create function public.remove_prep_template(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare hh uuid := private.plan_household();
begin
  delete from public.recipe_prep_templates t where t.id = p_id and t.household_id = hh;
  if not found then
    raise exception 'template not found or not allowed' using errcode = '42501';
  end if;
end;
$$;

-- Makes the prep tasks of the plan week that holds p_day up to date (see the rules at the top).
-- Returns { added, updated, removed }.
create function public.generate_prep_tasks(p_day date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  hh uuid := private.plan_household();
  dow smallint := coalesce((select s.week_start_dow from public.plan_settings s where s.household_id = hh), 6);
  plan uuid;
  v_added integer := 0;
  v_updated integer := 0;
  v_removed integer := 0;
begin
  select w.id into plan from public.week_plans w where w.household_id = hh and w.week_start = private.week_start_of(p_day, dow);
  if plan is null then
    return jsonb_build_object('added', 0, 'updated', 0, 'removed', 0);
  end if;

  insert into public.prep_tasks (household_id, planned_meal_id, day, timing, at_time, kind, body, template_id, from_template, position)
  select hh, m.id, private.prep_due(m.day, t.timing), t.timing, t.at_time, t.kind, t.body, t.id, true, t.position
  from public.planned_meals m
  join public.recipe_prep_templates t on t.recipe_id = m.recipe_id
  where m.week_plan_id = plan and m.status <> 'skipped'
  on conflict (planned_meal_id, template_id) where template_id is not null do nothing;
  get diagnostics v_added = row_count;

  update public.prep_tasks k
  set day = private.prep_due(m.day, t.timing), timing = t.timing, at_time = t.at_time, kind = t.kind, body = t.body
  from public.planned_meals m, public.recipe_prep_templates t
  where k.planned_meal_id = m.id and k.template_id = t.id and m.week_plan_id = plan
    and not k.manually_edited and k.done_at is null and k.dismissed_at is null
    and (k.day, k.timing, k.at_time, k.kind, k.body) is distinct from (private.prep_due(m.day, t.timing), t.timing, t.at_time, t.kind, t.body);
  get diagnostics v_updated = row_count;

  delete from public.prep_tasks k
  using public.planned_meals m
  where k.planned_meal_id = m.id and m.week_plan_id = plan
    and k.from_template and not k.manually_edited and k.done_at is null and k.dismissed_at is null
    and (k.template_id is null or m.status = 'skipped');
  get diagnostics v_removed = row_count;

  return jsonb_build_object('added', v_added, 'updated', v_updated, 'removed', v_removed);
end;
$$;

-- A task by hand, on a day, optionally for one planned meal.
create function public.add_prep_task(p_day date, p_timing text, p_at_time time, p_kind text, p_body text, p_meal uuid)
returns public.prep_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  hh uuid := private.plan_household();
  result public.prep_tasks;
begin
  if p_kind not in ('defrost', 'wash_chop', 'marinade', 'sauce', 'other') then
    raise exception 'bad_kind: unknown kind' using errcode = 'P0001';
  end if;
  if p_timing not in ('night_before', 'morning', 'before_cooking', 'at_time') or (p_timing = 'at_time') <> (p_at_time is not null) then
    raise exception 'bad_timing: a time is needed exactly when the timing is "at a time"' using errcode = 'P0001';
  end if;
  if p_day < date '2000-01-01' or p_day > date '2100-12-31' then
    raise exception 'bad_date: the date is not valid' using errcode = 'P0001';
  end if;
  if p_meal is not null and not exists (select 1 from public.planned_meals m where m.id = p_meal and m.household_id = hh) then
    raise exception 'meal not found or not allowed' using errcode = '42501';
  end if;
  insert into public.prep_tasks (household_id, planned_meal_id, day, timing, at_time, kind, body, created_by)
  values (hh, p_meal, p_day, p_timing, p_at_time, p_kind, btrim(p_body), (select auth.uid()))
  returning * into result;
  return result;
end;
$$;

-- Changes a task. A task made from a template becomes "edited", so regenerating leaves it alone.
create function public.update_prep_task(p_id uuid, p_day date, p_timing text, p_at_time time, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare hh uuid := private.plan_household();
begin
  if p_timing not in ('night_before', 'morning', 'before_cooking', 'at_time') or (p_timing = 'at_time') <> (p_at_time is not null) then
    raise exception 'bad_timing: a time is needed exactly when the timing is "at a time"' using errcode = 'P0001';
  end if;
  update public.prep_tasks k
  set day = p_day, timing = p_timing, at_time = p_at_time, body = btrim(p_body), manually_edited = k.from_template
  where k.id = p_id and k.household_id = hh and k.dismissed_at is null;
  if not found then
    raise exception 'task not found or not allowed' using errcode = '42501';
  end if;
end;
$$;

-- Hides a task for good (regenerating never brings it back).
create function public.dismiss_prep_task(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare hh uuid := private.plan_household();
begin
  update public.prep_tasks k set dismissed_at = now() where k.id = p_id and k.household_id = hh and k.dismissed_at is null;
  if not found then
    raise exception 'task not found or not allowed' using errcode = '42501';
  end if;
end;
$$;

-- Ticks or unticks a task. Anyone in the household can.
create function public.set_task_done(p_id uuid, p_done boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.prep_tasks k
  set done_at = case when p_done then now() end, done_by = case when p_done then (select auth.uid()) end
  where k.id = p_id and k.dismissed_at is null and private.is_household_member(k.household_id);
  if not found then
    raise exception 'task not found or not allowed' using errcode = '42501';
  end if;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.save_prep_template(uuid, text, text, text, time, text)', 'public.remove_prep_template(uuid)',
    'public.generate_prep_tasks(date)', 'public.add_prep_task(date, text, time, text, text, uuid)',
    'public.update_prep_task(uuid, date, text, time, text)', 'public.dismiss_prep_task(uuid)', 'public.set_task_done(uuid, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
