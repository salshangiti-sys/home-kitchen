-- Photos for recipes.
--
-- - The files live in a PRIVATE storage bucket, recipe-photos, one folder per household:
--     <household id>/<recipe id>/<photo id>.jpg          (the resized photo)
--     <household id>/<recipe id>/<photo id>-thumb.jpg    (the small version for lists)
--   Household members can read them (through short-lived signed addresses); owners and editors can
--   add files. Nobody can change or delete a file through the app (no update/delete rule), and
--   only JPEGs up to 3 MB are accepted.
-- - recipe_photos holds one row per photo, written only through the functions below.
-- - A photo is removed by hiding it (deleted_at); the file stays in storage.
-- - At most 10 photos per recipe.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-photos', 'recipe-photos', false, 3145728, array['image/jpeg'])
on conflict (id) do nothing;

-- The household named by the first folder of a file's path, if it is a household id.
create function private.photo_household(file_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when (storage.foldername(file_name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(file_name))[1])::uuid
  end;
$$;

grant execute on function private.photo_household(text) to authenticated, service_role;

create policy "members read recipe photos" on storage.objects for select to authenticated
  using (bucket_id = 'recipe-photos' and private.is_household_member(private.photo_household(name)));

create policy "editors add recipe photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'recipe-photos' and private.can_edit_household(private.photo_household(name)));

create table public.recipe_photos (
  id uuid primary key,
  recipe_id text not null references public.recipes (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  path text not null unique,
  thumb_path text not null unique,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  bytes integer not null check (bytes > 0),
  -- The lowest position is the cover photo.
  position integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index recipe_photos_recipe on public.recipe_photos (recipe_id, position) where deleted_at is null;

alter table public.recipe_photos enable row level security;
grant all on table public.recipe_photos to service_role;
grant select on table public.recipe_photos to authenticated;
create policy "members read recipe photos" on public.recipe_photos for select to authenticated
  using (private.is_household_member(household_id));

create function private.photo_path(h uuid, recipe text, photo uuid, thumb boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select h::text || '/' || recipe || '/' || photo::text || case when thumb then '-thumb' else '' end || '.jpg';
$$;

-- Records a photo whose two files (full and thumbnail) have already been uploaded to the paths
-- private.photo_path gives. Refuses if either file is missing, so a row never points at nothing.
create function public.add_recipe_photo(p_id uuid, p_recipe_id text, p_width integer, p_height integer, p_bytes integer)
returns public.recipe_photos
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.recipes%rowtype;
  full_path text;
  thumb_path text;
  added public.recipe_photos;
begin
  select * into r from public.recipes where id = p_recipe_id and deleted_at is null;
  if not found or not private.can_edit_household(r.household_id) then
    raise exception 'recipe not found or not allowed' using errcode = '42501';
  end if;
  if (select count(*) from public.recipe_photos x where x.recipe_id = p_recipe_id and x.deleted_at is null) >= 10 then
    raise exception 'photo_limit: a recipe can have at most 10 photos' using errcode = 'P0001';
  end if;

  full_path := private.photo_path(r.household_id, r.id, p_id, false);
  thumb_path := private.photo_path(r.household_id, r.id, p_id, true);
  if (select count(*) from storage.objects o where o.bucket_id = 'recipe-photos' and o.name in (full_path, thumb_path)) < 2 then
    raise exception 'photo_files_missing: upload both files first' using errcode = 'P0001';
  end if;

  insert into public.recipe_photos (id, recipe_id, household_id, path, thumb_path, width, height, bytes, position, created_by)
  values (
    p_id, r.id, r.household_id, full_path, thumb_path, p_width, p_height, p_bytes,
    coalesce((select max(x.position) from public.recipe_photos x where x.recipe_id = r.id and x.deleted_at is null), -1) + 1,
    (select auth.uid())
  )
  returning * into added;
  return added;
end;
$$;

-- Hides a photo (the file stays in storage).
create function public.remove_recipe_photo(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.recipe_photos p set deleted_at = now()
  where p.id = p_id and p.deleted_at is null and private.can_edit_household(p.household_id);
  if not found then
    raise exception 'photo not found or not allowed' using errcode = '42501';
  end if;
end;
$$;

-- Makes a photo the first one (the cover): it goes before all the others.
create function public.make_cover_photo(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.recipe_photos p
  set position = (select coalesce(min(x.position), 0) - 1 from public.recipe_photos x where x.recipe_id = p.recipe_id and x.deleted_at is null)
  where p.id = p_id and p.deleted_at is null and private.can_edit_household(p.household_id);
  if not found then
    raise exception 'photo not found or not allowed' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.add_recipe_photo(uuid, text, integer, integer, integer) from public, anon;
revoke all on function public.remove_recipe_photo(uuid) from public, anon;
revoke all on function public.make_cover_photo(uuid) from public, anon;
grant execute on function public.add_recipe_photo(uuid, text, integer, integer, integer) to authenticated;
grant execute on function public.remove_recipe_photo(uuid) to authenticated;
grant execute on function public.make_cover_photo(uuid) to authenticated;
grant execute on function private.photo_path(uuid, text, uuid, boolean) to authenticated, service_role;

-- The nightly backup records which photos exist (the files themselves stay in storage).
create or replace function public.backup_bundle(p_household uuid)
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
    'onenote_library', (select to_jsonb(l) - 'user_id' from public.onenote_library l where l.household_id = p_household),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object('id', ph.id, 'recipe_id', ph.recipe_id, 'path', ph.path, 'thumb_path', ph.thumb_path, 'width', ph.width, 'height', ph.height, 'bytes', ph.bytes, 'position', ph.position, 'created_at', ph.created_at, 'deleted_at', ph.deleted_at) order by ph.recipe_id, ph.position)
      from public.recipe_photos ph where ph.household_id = p_household
    ), '[]'::jsonb)
  );
$$;
