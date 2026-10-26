-- The recipe notebook (وصفاتي): read-only, plus creating new pages (decision of 2026-10-26).
--
-- onenote_library        which notebook is the household's recipe notebook, and its sections
-- recipe_pages           the OneNote page each recipe is read from
-- onenote_unlinked_pages pages found in the notebook that no recipe is linked to yet. They are
--                        listed for the owner to add or link; nothing is imported on its own, so
--                        the recipes.json import (which links by page_id) never gets duplicates.
--
-- All of these are written only by the onenote-library Edge Function (service role); members
-- read them.

create type public.page_read_status as enum ('ok', 'missing', 'error');

create table public.onenote_library (
  household_id uuid primary key references public.households (id) on delete cascade,
  -- The member whose Microsoft account reads the notebook.
  user_id uuid not null references auth.users (id) on delete cascade,
  notebook_id text not null,
  notebook_name text not null,
  -- [{ "id": "...", "name": "سلطات" }] as of the last check.
  sections jsonb not null default '[]'::jsonb,
  linked_at timestamptz not null default now(),
  last_checked_at timestamptz,
  last_error text
);

create table public.recipe_pages (
  recipe_id text primary key references public.recipes (id) on delete cascade,
  page_id text not null unique,
  notebook_id text not null,
  section_id text,
  section_name text,
  page_title text,
  web_url text,
  client_url text,
  created_by_app boolean not null default false,
  read_status public.page_read_status not null default 'ok',
  last_read_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create table public.onenote_unlinked_pages (
  household_id uuid not null references public.households (id) on delete cascade,
  page_id text not null,
  title text not null,
  section_id text,
  section_name text,
  web_url text,
  seen_at timestamptz not null default now(),
  primary key (household_id, page_id)
);

alter table public.onenote_library enable row level security;
alter table public.recipe_pages enable row level security;
alter table public.onenote_unlinked_pages enable row level security;

grant all on table public.onenote_library, public.recipe_pages, public.onenote_unlinked_pages to service_role;
grant select on table public.onenote_library, public.recipe_pages, public.onenote_unlinked_pages to authenticated;

create policy "members read the recipe notebook link" on public.onenote_library for select to authenticated
  using (private.is_household_member(household_id));
create policy "members read recipe pages" on public.recipe_pages for select to authenticated
  using (private.can_read_recipe(recipe_id));
create policy "members read pages not in the app yet" on public.onenote_unlinked_pages for select to authenticated
  using (private.is_household_member(household_id));
