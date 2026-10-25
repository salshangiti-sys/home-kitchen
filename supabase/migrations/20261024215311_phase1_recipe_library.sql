-- Phase 1: the recipe library.
--
-- A recipe is stored relationally (sources, ingredient groups and lines, steps, notes, flags) but
-- read and written as one document in the shape of schema/recipe.schema.json, through
-- public.recipe_doc() and public.save_recipe(). The import, the editor and the export all use that
-- same shape, so nothing is translated twice.
--
-- Rules carried from the brief:
-- - Text written by the author (title, ingredient lines, steps, notes, raw_text) is stored verbatim.
-- - Structured fields (quantity, unit, item, servings, times) stay null unless stated; nothing here
--   fills them in.
-- - Flags are for review only; nothing is merged or deleted because of them.
-- - Re-importing a file never duplicates a recipe (the id is the key) and never overwrites a recipe
--   that was changed in the app after it was imported.
--
-- Writes go through security-definer functions that check the caller's role, so a viewer (the
-- sister) can read everything in the household and change nothing.

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Arabic search normalization (src/library/normalize.ts is the same function in TypeScript)
-- ---------------------------------------------------------------------------
-- Removes diacritics, tatweel and bidi marks; treats أ إ آ ٱ as ا, ة as ه and ى as ي; turns
-- Arabic-Indic digits into 0-9; lowercases Latin; collapses spaces. For searching only: stored
-- text is never normalized.
create function public.normalize_ar(input text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(regexp_replace(
    lower(translate(
      regexp_replace(coalesce(input, ''), '[ً-ٰٟـ‌-‏‪-‮⁦-⁩]', '', 'g'),
      'أإآٱةى٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
      'اااايه01234567890123456789'
    )),
    '\s+', ' ', 'g'
  ));
$$;

grant execute on function public.normalize_ar(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create type public.recipe_status as enum ('complete', 'partial', 'link_only', 'note_only');
create type public.flag_status as enum ('open', 'reviewed');

create table public.recipes (
  -- Stable slug from the export (e.g. salads-007); new recipes get one in the same form.
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]*$'),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null,
  language text not null default 'ar',
  status public.recipe_status not null,
  notebook text,
  section_group text,
  section text not null,
  section_en text,
  servings numeric,
  prep_time_min numeric,
  cook_time_min numeric,
  meal_types text[] not null default '{}'
    check (meal_types <@ array['breakfast', 'lunch', 'dinner', 'snack', 'dessert', 'drink', 'side']),
  kid_friendly boolean,
  lunchbox boolean,
  custom_tags text[] not null default '{}',
  -- Where the recipe came from in OneNote: { notebook, section, page_id, created }.
  onenote jsonb not null default '{}'::jsonb,
  -- Placeholders for images and videos that were not exported: [{ type, description }].
  media jsonb not null default '[]'::jsonb,
  raw_text text not null default '',
  search_norm text not null default '',
  version integer not null default 1,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index recipes_household_id_idx on public.recipes (household_id);
create index recipes_search_norm_trgm_idx on public.recipes using gin (search_norm extensions.gin_trgm_ops);

create table public.recipe_sources (
  id uuid primary key default gen_random_uuid(),
  recipe_id text not null references public.recipes (id) on delete cascade,
  position integer not null,
  url text not null,
  platform text check (platform in ('tiktok', 'youtube', 'instagram', 'snapchat', 'web', 'other')),
  label text,
  unique (recipe_id, position)
);

create table public.ingredient_groups (
  id uuid primary key default gen_random_uuid(),
  recipe_id text not null references public.recipes (id) on delete cascade,
  position integer not null,
  -- null: the main, unnamed group.
  name text,
  unique (recipe_id, position)
);

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.ingredient_groups (id) on delete cascade,
  recipe_id text not null references public.recipes (id) on delete cascade,
  position integer not null,
  text text not null,
  -- Only when the page stated them; never guessed.
  quantity numeric,
  unit text,
  item text,
  note text,
  unique (group_id, position)
);

create index recipe_ingredients_recipe_id_idx on public.recipe_ingredients (recipe_id);

create table public.recipe_steps (
  recipe_id text not null references public.recipes (id) on delete cascade,
  position integer not null check (position >= 1),
  text text not null,
  primary key (recipe_id, position)
);

create table public.recipe_notes (
  recipe_id text not null references public.recipes (id) on delete cascade,
  position integer not null,
  text text not null,
  primary key (recipe_id, position)
);

create table public.recipe_flags (
  id uuid primary key default gen_random_uuid(),
  recipe_id text not null references public.recipes (id) on delete cascade,
  flag text not null,
  status public.flag_status not null default 'open',
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  unique (recipe_id, flag)
);

create table public.user_favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  recipe_id text not null references public.recipes (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);

create index user_favorites_recipe_id_idx on public.user_favorites (recipe_id);

-- Every saved version of a recipe, as a document, with where the change came from.
create table public.recipe_versions (
  id uuid primary key default gen_random_uuid(),
  recipe_id text not null references public.recipes (id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  origin text not null check (origin in ('app', 'import', 'onenote', 'restore')),
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now(),
  unique (recipe_id, version)
);

-- ---------------------------------------------------------------------------
-- Reading a recipe as a document
-- ---------------------------------------------------------------------------

-- The recipe in the shape of recipe.schema.json. Optional fields with no value are left out, so
-- the result validates against the schema and two documents compare equal when their content is
-- the same. Security invoker: callers only see what RLS lets them see.
create function public.recipe_doc(recipe_id text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'servings', r.servings,
    'prep_time_min', r.prep_time_min,
    'cook_time_min', r.cook_time_min
  )) || jsonb_build_object(
    'id', r.id,
    'title', r.title,
    'language', r.language,
    'status', r.status,
    'category', jsonb_strip_nulls(jsonb_build_object(
      'notebook', r.notebook,
      'section_group', r.section_group,
      'section', r.section,
      'section_en', r.section_en
    )),
    'sources', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('url', s.url, 'platform', s.platform, 'label', s.label)) order by s.position)
      from public.recipe_sources s where s.recipe_id = r.id
    ), '[]'::jsonb),
    'ingredient_groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', g.name,
        'items', coalesce((
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'text', i.text, 'quantity', i.quantity, 'unit', i.unit, 'item', i.item, 'note', i.note
          )) order by i.position)
          from public.recipe_ingredients i where i.group_id = g.id
        ), '[]'::jsonb)
      ) order by g.position)
      from public.ingredient_groups g where g.recipe_id = r.id
    ), '[]'::jsonb),
    'steps', coalesce((
      select jsonb_agg(jsonb_build_object('order', st.position, 'text', st.text) order by st.position)
      from public.recipe_steps st where st.recipe_id = r.id
    ), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(n.text order by n.position) from public.recipe_notes n where n.recipe_id = r.id
    ), '[]'::jsonb),
    'tags', jsonb_strip_nulls(jsonb_build_object(
      'meal_types', to_jsonb(r.meal_types),
      'kid_friendly', r.kid_friendly,
      'lunchbox', r.lunchbox,
      'custom', to_jsonb(r.custom_tags)
    )),
    'media', r.media,
    'onenote', r.onenote,
    'flags', coalesce((
      select jsonb_agg(f.flag order by f.flag) from public.recipe_flags f where f.recipe_id = r.id
    ), '[]'::jsonb),
    'raw_text', r.raw_text
  )
  from public.recipes r
  where r.id = recipe_doc.recipe_id;
$$;

grant execute on function public.recipe_doc(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Writing a recipe
-- ---------------------------------------------------------------------------

-- The household the caller can add recipes to (their first one where they are owner or editor).
create function private.my_edit_household()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.household_id from public.household_members m
  where m.user_id = (select auth.uid()) and m.role in ('owner', 'editor')
  order by m.created_at
  limit 1;
$$;

-- Next free id for a new recipe: <prefix>-001, <prefix>-002 ...
create function private.next_recipe_id(prefix text)
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select prefix || '-' || lpad((coalesce(max(substring(r.id from '-(\d+)$')::integer), 0) + 1)::text, 3, '0')
  from public.recipes r
  where r.id ~ ('^' || prefix || '-\d+$');
$$;

-- Saves one recipe document (schema shape). Returns { id, version, result } where result is
-- 'created', 'updated', 'unchanged' or, for imports only, 'skipped_edited'.
--
-- - p_expected_version: when given, the save only goes ahead if the stored recipe still has that
--   version (raises 'version_conflict' otherwise), so two edits never silently overwrite each other.
-- - p_origin 'import': a recipe that was changed in the app (or anywhere but an import) since it
--   was last imported is left alone and reported as 'skipped_edited'.
-- - A document identical to the stored one changes nothing and adds no version.
-- - Flags from an import are added; flags already reviewed keep their review.
create function public.save_recipe(p_doc jsonb, p_expected_version integer default null, p_origin text default 'app')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  rid text := nullif(btrim(p_doc ->> 'id'), '');
  existing public.recipes%rowtype;
  hid uuid;
  old_doc jsonb;
  new_doc jsonb;
  new_version integer;
  last_origin text;
  grp jsonb;
  grp_id uuid;
  gpos integer;
  ipos integer;
  item jsonb;
  unchanged boolean := false;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if p_origin not in ('app', 'import', 'onenote', 'restore') then
    raise exception 'unknown origin %', p_origin;
  end if;

  if rid is not null then
    select * into existing from public.recipes where id = rid for update;
  end if;

  if existing.id is not null then
    hid := existing.household_id;
    if not private.can_edit_household(hid) then
      raise exception 'not allowed to edit this recipe' using errcode = '42501';
    end if;
    if p_expected_version is not null and existing.version <> p_expected_version then
      raise exception 'version_conflict' using errcode = 'P0001', detail = existing.version::text;
    end if;
    if p_origin = 'import' then
      select v.origin into last_origin from public.recipe_versions v
      where v.recipe_id = rid order by v.version desc limit 1;
      if last_origin is distinct from 'import' then
        return jsonb_build_object('id', rid, 'version', existing.version, 'result', 'skipped_edited');
      end if;
    end if;
    old_doc := public.recipe_doc(rid);
  else
    hid := private.my_edit_household();
    if hid is null then
      raise exception 'not allowed to add recipes' using errcode = '42501';
    end if;
    if rid is null then
      rid := private.next_recipe_id(coalesce(
        nullif(regexp_replace(lower(coalesce(p_doc -> 'category' ->> 'section_en', '')), '[^a-z0-9]+', '-', 'g'), '-'),
        'recipe'
      ));
      rid := btrim(rid, '-');
    end if;
  end if;

  begin
    insert into public.recipes as r (
      id, household_id, title, language, status, notebook, section_group, section, section_en,
      servings, prep_time_min, cook_time_min, meal_types, kid_friendly, lunchbox, custom_tags,
      onenote, media, raw_text, version, created_by
    ) values (
      rid, hid,
      p_doc ->> 'title',
      coalesce(p_doc ->> 'language', 'ar'),
      (p_doc ->> 'status')::public.recipe_status,
      p_doc -> 'category' ->> 'notebook',
      p_doc -> 'category' ->> 'section_group',
      p_doc -> 'category' ->> 'section',
      p_doc -> 'category' ->> 'section_en',
      (p_doc ->> 'servings')::numeric,
      (p_doc ->> 'prep_time_min')::numeric,
      (p_doc ->> 'cook_time_min')::numeric,
      coalesce(array(select jsonb_array_elements_text(p_doc -> 'tags' -> 'meal_types')), '{}'),
      (p_doc -> 'tags' ->> 'kid_friendly')::boolean,
      (p_doc -> 'tags' ->> 'lunchbox')::boolean,
      coalesce(array(select jsonb_array_elements_text(p_doc -> 'tags' -> 'custom')), '{}'),
      coalesce(p_doc -> 'onenote', '{}'::jsonb),
      coalesce(p_doc -> 'media', '[]'::jsonb),
      coalesce(p_doc ->> 'raw_text', ''),
      1, uid
    )
    on conflict (id) do update set
      title = excluded.title,
      language = excluded.language,
      status = excluded.status,
      notebook = excluded.notebook,
      section_group = excluded.section_group,
      section = excluded.section,
      section_en = excluded.section_en,
      servings = excluded.servings,
      prep_time_min = excluded.prep_time_min,
      cook_time_min = excluded.cook_time_min,
      meal_types = excluded.meal_types,
      kid_friendly = excluded.kid_friendly,
      lunchbox = excluded.lunchbox,
      custom_tags = excluded.custom_tags,
      onenote = excluded.onenote,
      media = excluded.media,
      raw_text = excluded.raw_text;

    delete from public.recipe_sources where recipe_id = rid;
    delete from public.ingredient_groups where recipe_id = rid;
    delete from public.recipe_steps where recipe_id = rid;
    delete from public.recipe_notes where recipe_id = rid;

    insert into public.recipe_sources (recipe_id, position, url, platform, label)
    select rid, s.ord, s.value ->> 'url', s.value ->> 'platform', s.value ->> 'label'
    from jsonb_array_elements(coalesce(p_doc -> 'sources', '[]'::jsonb)) with ordinality as s (value, ord);

    gpos := 0;
    for grp in select value from jsonb_array_elements(coalesce(p_doc -> 'ingredient_groups', '[]'::jsonb)) loop
      gpos := gpos + 1;
      insert into public.ingredient_groups (recipe_id, position, name)
      values (rid, gpos, grp ->> 'name')
      returning id into grp_id;
      ipos := 0;
      for item in select value from jsonb_array_elements(coalesce(grp -> 'items', '[]'::jsonb)) loop
        ipos := ipos + 1;
        insert into public.recipe_ingredients (group_id, recipe_id, position, text, quantity, unit, item, note)
        values (grp_id, rid, ipos, item ->> 'text', (item ->> 'quantity')::numeric, item ->> 'unit', item ->> 'item', item ->> 'note');
      end loop;
    end loop;

    -- Steps are kept in the order given and numbered 1, 2, 3 ...
    insert into public.recipe_steps (recipe_id, position, text)
    select rid, row_number() over (order by (st.value ->> 'order')::integer, st.ord), st.value ->> 'text'
    from jsonb_array_elements(coalesce(p_doc -> 'steps', '[]'::jsonb)) with ordinality as st (value, ord);

    insert into public.recipe_notes (recipe_id, position, text)
    select rid, n.ord, n.value
    from jsonb_array_elements_text(coalesce(p_doc -> 'notes', '[]'::jsonb)) with ordinality as n (value, ord);

    insert into public.recipe_flags (recipe_id, flag)
    select rid, f.value
    from jsonb_array_elements_text(coalesce(p_doc -> 'flags', '[]'::jsonb)) as f (value)
    on conflict (recipe_id, flag) do nothing;

    new_doc := public.recipe_doc(rid);
    if old_doc is not null and new_doc = old_doc then
      raise exception 'hk_unchanged';
    end if;
  exception
    when raise_exception then
      if sqlerrm <> 'hk_unchanged' then
        raise;
      end if;
      unchanged := true;
  end;

  if unchanged then
    return jsonb_build_object('id', rid, 'version', existing.version, 'result', 'unchanged');
  end if;

  new_version := coalesce(existing.version, 0) + 1;
  update public.recipes set
    version = new_version,
    updated_at = now(),
    search_norm = public.normalize_ar(concat_ws(' ',
      new_doc ->> 'title',
      new_doc -> 'category' ->> 'section',
      new_doc -> 'category' ->> 'section_en',
      (select string_agg(i.text, ' ') from public.recipe_ingredients i where i.recipe_id = rid),
      (select string_agg(g.name, ' ') from public.ingredient_groups g where g.recipe_id = rid),
      (select string_agg(st.text, ' ') from public.recipe_steps st where st.recipe_id = rid),
      (select string_agg(n.text, ' ') from public.recipe_notes n where n.recipe_id = rid),
      array_to_string(coalesce(array(select jsonb_array_elements_text(new_doc -> 'tags' -> 'custom')), '{}'), ' ')
    ))
  where id = rid;

  insert into public.recipe_versions (recipe_id, version, snapshot, origin, changed_by)
  values (rid, new_version, new_doc, p_origin, uid);

  return jsonb_build_object('id', rid, 'version', new_version, 'result', case when existing.id is null then 'created' else 'updated' end);
end;
$$;

-- Imports a batch of recipe documents. With p_dry_run nothing is kept: every record is saved and
-- the whole batch is then rolled back, so the report shows exactly what a real import would do.
-- Returns one { id, result, error } per record, in order.
create function public.import_recipes(p_docs jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  results jsonb := '[]'::jsonb;
  doc jsonb;
  outcome jsonb;
begin
  if private.my_edit_household() is null then
    raise exception 'not allowed to import recipes' using errcode = '42501';
  end if;

  begin
    for doc in select value from jsonb_array_elements(p_docs) loop
      begin
        outcome := public.save_recipe(doc, null, 'import');
        results := results || jsonb_build_array(jsonb_build_object('id', outcome ->> 'id', 'result', outcome ->> 'result'));
      exception when others then
        results := results || jsonb_build_array(jsonb_build_object('id', doc ->> 'id', 'result', 'error', 'error', sqlerrm));
      end;
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

  return results;
end;
$$;

-- Every recipe in the caller's households as schema documents (for export and backup).
create function public.export_recipes()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.recipe_doc(r.id) order by r.id), '[]'::jsonb)
  from public.recipes r
  where r.deleted_at is null;
$$;

-- The owner marks a flag as reviewed (or open again). Nothing else changes.
create function public.set_flag_status(p_flag_id uuid, p_status public.flag_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.recipe_flags f set
    status = p_status,
    reviewed_by = case when p_status = 'reviewed' then (select auth.uid()) end,
    reviewed_at = case when p_status = 'reviewed' then now() end
  from public.recipes r
  where f.id = p_flag_id and r.id = f.recipe_id and private.can_edit_household(r.household_id);
  if not found then
    raise exception 'flag not found or not allowed' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.save_recipe(jsonb, integer, text) from public, anon;
revoke all on function public.import_recipes(jsonb, boolean) from public, anon;
revoke all on function public.export_recipes() from public, anon;
revoke all on function public.set_flag_status(uuid, public.flag_status) from public, anon;
revoke all on function private.my_edit_household() from public, anon;
revoke all on function private.next_recipe_id(text) from public, anon;
grant execute on function public.save_recipe(jsonb, integer, text) to authenticated;
grant execute on function public.import_recipes(jsonb, boolean) to authenticated;
grant execute on function public.export_recipes() to authenticated;
grant execute on function public.set_flag_status(uuid, public.flag_status) to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security: members read; content changes only through the functions above
-- ---------------------------------------------------------------------------

alter table public.recipes enable row level security;
alter table public.recipe_sources enable row level security;
alter table public.ingredient_groups enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.recipe_steps enable row level security;
alter table public.recipe_notes enable row level security;
alter table public.recipe_flags enable row level security;
alter table public.user_favorites enable row level security;
alter table public.recipe_versions enable row level security;

grant all on table
  public.recipes, public.recipe_sources, public.ingredient_groups, public.recipe_ingredients,
  public.recipe_steps, public.recipe_notes, public.recipe_flags, public.user_favorites, public.recipe_versions
to service_role;

grant select on table
  public.recipes, public.recipe_sources, public.ingredient_groups, public.recipe_ingredients,
  public.recipe_steps, public.recipe_notes, public.recipe_flags, public.recipe_versions
to authenticated;
grant select, insert, delete on table public.user_favorites to authenticated;

create policy "members read recipes"
  on public.recipes for select to authenticated
  using (private.is_household_member(household_id));

create function private.can_read_recipe(rid text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.recipes r where r.id = rid and private.is_household_member(r.household_id));
$$;

revoke all on function private.can_read_recipe(text) from public, anon;
grant execute on function private.can_read_recipe(text) to authenticated, service_role;

create policy "members read recipe sources" on public.recipe_sources for select to authenticated
  using (private.can_read_recipe(recipe_id));
create policy "members read ingredient groups" on public.ingredient_groups for select to authenticated
  using (private.can_read_recipe(recipe_id));
create policy "members read ingredients" on public.recipe_ingredients for select to authenticated
  using (private.can_read_recipe(recipe_id));
create policy "members read steps" on public.recipe_steps for select to authenticated
  using (private.can_read_recipe(recipe_id));
create policy "members read notes" on public.recipe_notes for select to authenticated
  using (private.can_read_recipe(recipe_id));
create policy "members read flags" on public.recipe_flags for select to authenticated
  using (private.can_read_recipe(recipe_id));
create policy "members read versions" on public.recipe_versions for select to authenticated
  using (private.can_read_recipe(recipe_id));

-- Favorites are personal: each member keeps their own, for recipes they can read.
create policy "users read their favorites" on public.user_favorites for select to authenticated
  using (user_id = (select auth.uid()));
create policy "users add favorites" on public.user_favorites for insert to authenticated
  with check (user_id = (select auth.uid()) and private.can_read_recipe(recipe_id));
create policy "users remove favorites" on public.user_favorites for delete to authenticated
  using (user_id = (select auth.uid()));
