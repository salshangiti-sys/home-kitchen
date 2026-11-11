-- Nightly backup of the app's data to the owner's OneDrive (app folder), with a log of every run.
--
-- - backup_runs: one row per run (what was written, whether it read back identical and valid).
-- - backup_bundle(): everything worth keeping for one household, in one consistent read.
-- - A random token in Vault (never shown, never leaves the database) lets the timer call the
--   nightly-backup Edge Function; the function refuses calls without it (or without the owner's
--   own sign-in).
-- - pg_cron starts the function every night at 02:30 UTC (05:30 in Jeddah).

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table public.backup_runs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  trigger text not null check (trigger in ('schedule', 'manual')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  -- The file written to OneDrive, and the folder it is in (named after the app registration).
  file_name text,
  folder_name text,
  bytes integer,
  sha256 text,
  recipes integer,
  deleted_recipes integer,
  -- The file was read back from OneDrive: identical bytes, valid JSON, every recipe valid.
  verified boolean not null default false,
  old_files_removed integer not null default 0,
  error text
);

create index backup_runs_household_started on public.backup_runs (household_id, started_at desc);

alter table public.backup_runs enable row level security;
grant all on table public.backup_runs to service_role;
grant select on table public.backup_runs to authenticated;
create policy "members read backup runs" on public.backup_runs for select to authenticated
  using (private.is_household_member(household_id));

-- Everything for one household. Security definer and for the backup function only (service role).
create function public.backup_bundle(p_household uuid)
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
    -- Same documents as the export, so this array can be imported as recipes.json.
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
    'onenote_library', (select to_jsonb(l) - 'user_id' from public.onenote_library l where l.household_id = p_household)
  );
$$;

revoke all on function public.backup_bundle(uuid) from public, anon, authenticated;
grant execute on function public.backup_bundle(uuid) to service_role;

-- The token the timer presents. Created once here, readable only inside the database.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'backup_token', 'Lets the nightly timer call the nightly-backup function')
where not exists (select 1 from vault.secrets where name = 'backup_token');

create function public.check_backup_token(p_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_token is not null and p_token <> '' and exists (
    select 1 from vault.decrypted_secrets s where s.name = 'backup_token' and s.decrypted_secret = p_token
  );
$$;

revoke all on function public.check_backup_token(text) from public, anon, authenticated;
grant execute on function public.check_backup_token(text) to service_role;

select cron.schedule(
  'nightly-backup',
  '30 2 * * *',
  $job$
  select net.http_post(
    url := 'https://rknhlhrnncmfzkyyzgmd.supabase.co/functions/v1/nightly-backup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'backup_token')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);
