-- Phase 0: foundation for the OneNote sync spike.
--
-- households / household_members are the final sharing model (owner, editor, viewer).
-- spike_recipes is a Phase 0 stand-in that keeps each recipe's page sections as jsonb;
-- Phase 1 replaces it with the relational recipe tables and adds the foreign keys noted below.
-- Everything the sync worker writes (connections, links, conflicts, snapshots) is written by
-- Edge Functions with the service role; signed-in users can only read their own rows.

-- ---------------------------------------------------------------------------
-- Households and membership
-- ---------------------------------------------------------------------------

create type public.household_role as enum ('owner', 'editor', 'viewer');

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.household_role not null,
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index household_members_user_id_idx on public.household_members (user_id);

-- Security definer so policies on other tables can check membership without recursing into
-- household_members' own policies.
create function public.is_household_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = (select auth.uid())
  );
$$;

create function public.can_edit_household(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'editor')
  );
$$;

-- First sign-in: create the caller's household and make them its owner. Returns the existing
-- household when the caller already belongs to one, so calling it twice is harmless.
create function public.ensure_own_household(household_name text default 'البيت')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  hid uuid;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  select m.household_id into hid
  from public.household_members m
  where m.user_id = uid
  order by m.created_at
  limit 1;

  if hid is null then
    insert into public.households (name) values (household_name) returning id into hid;
    insert into public.household_members (household_id, user_id, role) values (hid, uid, 'owner');
  end if;

  return hid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Phase 0 recipes (replaced in Phase 1)
-- ---------------------------------------------------------------------------

create table public.spike_recipes (
  id text primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null,
  -- { "src": [...], "ing": [...], "steps": [...], "notes": [...] } as produced by the shared
  -- OneNote section model (supabase/functions/_shared/onenote/sections.ts).
  sections jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index spike_recipes_household_id_idx on public.spike_recipes (household_id);

-- ---------------------------------------------------------------------------
-- Microsoft connection and OneNote sync state
-- ---------------------------------------------------------------------------

-- One Microsoft account per user. The refresh token itself is stored in Supabase Vault;
-- this table only keeps the vault secret's id.
create table public.ms_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  ms_user_id text,
  display_name text,
  refresh_token_secret_id uuid,
  scopes text,
  status text not null default 'connected' check (status in ('connected', 'needs_reconnect')),
  last_error text,
  connected_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Short-lived OAuth state and PKCE verifier between ms-oauth-start and ms-oauth-callback.
create table public.oauth_states (
  state text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  code_verifier text not null,
  return_to text not null,
  expires_at timestamptz not null
);

-- Notebooks the sync worker may write to. Phase 0 allows the test notebook only; every write
-- to OneNote checks the target page's notebook against this table first.
create table public.onenote_allowed_notebooks (
  user_id uuid not null references auth.users (id) on delete cascade,
  notebook_id text not null,
  notebook_name text,
  default_section_id text,
  created_at timestamptz not null default now(),
  primary key (user_id, notebook_id)
);

create type public.sync_status as enum (
  'synced', 'pending', 'failed', 'conflict', 'remote_deleted', 'needs_reconnect'
);

create table public.onenote_links (
  recipe_id text primary key, -- Phase 1: references recipes (id)
  user_id uuid not null references auth.users (id) on delete cascade,
  notebook_id text not null,
  section_id text not null,
  page_id text,
  web_url text,
  client_url text,
  template_version integer not null default 1,
  sync_status public.sync_status not null default 'pending',
  -- The sections as they were at the last successful sync: the base of the three-way merge.
  base_sections jsonb,
  -- Kept exactly as Graph returns it, so "unchanged since last sync" is an exact string match.
  remote_last_modified text,
  last_synced_at timestamptz,
  parse_method text,
  last_error text,
  retry_count integer not null default 0,
  next_retry_at timestamptz,
  updated_at timestamptz not null default now()
);

create index onenote_links_status_idx on public.onenote_links (sync_status);

create table public.sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  recipe_id text not null, -- Phase 1: references recipes (id)
  section_key text not null,
  base jsonb,
  local jsonb,
  remote jsonb,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text check (resolution in ('local', 'remote', 'manual')),
  resolved_by uuid references auth.users (id)
);

-- At most one open conflict per section; a repeated sync updates it instead of adding another.
create unique index sync_conflicts_open_idx on public.sync_conflicts (recipe_id, section_key) where resolved_at is null;

-- Full page HTML saved before every write to OneNote, so any change can be undone.
create table public.onenote_snapshots (
  id uuid primary key default gen_random_uuid(),
  page_id text not null,
  recipe_id text,
  reason text not null,
  html text not null,
  taken_at timestamptz not null default now()
);

create index onenote_snapshots_page_idx on public.onenote_snapshots (page_id, taken_at desc);

-- ---------------------------------------------------------------------------
-- Vault helpers for the Microsoft refresh token (service role only)
-- ---------------------------------------------------------------------------

create function public.ms_store_refresh_token(p_user_id uuid, p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret_id uuid;
begin
  select c.refresh_token_secret_id into secret_id
  from public.ms_connections c
  where c.user_id = p_user_id;

  if not found then
    raise exception 'no Microsoft connection row for user %', p_user_id;
  end if;

  if secret_id is null then
    secret_id := vault.create_secret(p_token, 'ms_refresh_token_' || p_user_id::text, 'Microsoft refresh token');
    update public.ms_connections set refresh_token_secret_id = secret_id where user_id = p_user_id;
  else
    perform vault.update_secret(secret_id, p_token);
  end if;
end;
$$;

create function public.ms_read_refresh_token(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret
  from vault.decrypted_secrets s
  join public.ms_connections c on c.refresh_token_secret_id = s.id
  where c.user_id = p_user_id;
$$;

revoke all on function public.ms_store_refresh_token(uuid, text) from public, anon, authenticated;
revoke all on function public.ms_read_refresh_token(uuid) from public, anon, authenticated;
grant execute on function public.ms_store_refresh_token(uuid, text) to service_role;
grant execute on function public.ms_read_refresh_token(uuid) to service_role;

revoke all on function public.ensure_own_household(text) from public, anon;
grant execute on function public.ensure_own_household(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------
-- New tables are not exposed automatically in this project, so every grant is explicit.

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.spike_recipes enable row level security;
alter table public.ms_connections enable row level security;
alter table public.oauth_states enable row level security;
alter table public.onenote_allowed_notebooks enable row level security;
alter table public.onenote_links enable row level security;
alter table public.sync_conflicts enable row level security;
alter table public.onenote_snapshots enable row level security;

grant all on table
  public.households,
  public.household_members,
  public.spike_recipes,
  public.ms_connections,
  public.oauth_states,
  public.onenote_allowed_notebooks,
  public.onenote_links,
  public.sync_conflicts,
  public.onenote_snapshots
to service_role;

grant select on table public.households, public.household_members to authenticated;
grant select, insert, update, delete on table public.spike_recipes to authenticated;
grant select on table
  public.ms_connections,
  public.onenote_allowed_notebooks,
  public.onenote_links,
  public.sync_conflicts,
  public.onenote_snapshots
to authenticated;

create policy "members read their household"
  on public.households for select to authenticated
  using (public.is_household_member(id));

create policy "members read their household's members"
  on public.household_members for select to authenticated
  using (public.is_household_member(household_id));

create policy "members read recipes"
  on public.spike_recipes for select to authenticated
  using (public.is_household_member(household_id));

create policy "editors add recipes"
  on public.spike_recipes for insert to authenticated
  with check (public.can_edit_household(household_id));

create policy "editors change recipes"
  on public.spike_recipes for update to authenticated
  using (public.can_edit_household(household_id))
  with check (public.can_edit_household(household_id));

create policy "editors delete recipes"
  on public.spike_recipes for delete to authenticated
  using (public.can_edit_household(household_id));

create policy "users read their Microsoft connection"
  on public.ms_connections for select to authenticated
  using (user_id = (select auth.uid()));

create policy "users read their allowed notebooks"
  on public.onenote_allowed_notebooks for select to authenticated
  using (user_id = (select auth.uid()));

create policy "members read sync links"
  on public.onenote_links for select to authenticated
  using (exists (
    select 1 from public.spike_recipes r
    where r.id = recipe_id and public.is_household_member(r.household_id)
  ));

create policy "members read sync conflicts"
  on public.sync_conflicts for select to authenticated
  using (exists (
    select 1 from public.spike_recipes r
    where r.id = recipe_id and public.is_household_member(r.household_id)
  ));

create policy "members read page snapshots"
  on public.onenote_snapshots for select to authenticated
  using (exists (
    select 1 from public.spike_recipes r
    where r.id = recipe_id and public.is_household_member(r.household_id)
  ));
