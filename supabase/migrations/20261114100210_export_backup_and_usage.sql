-- Two small functions for the backup card in the app.
--
-- export_backup(): the same data the nightly job puts in OneDrive, handed to the owner to save on
-- her own device ("نزّلي نسخة كاملة الآن"). Owner only: it holds everyone's favorites and cooking log.
-- storage_usage(): how much of the free plan's room is used (database and photo files), for the owner
-- and editors.

create function public.export_backup()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  hh uuid;
begin
  select m.household_id into hh
  from public.household_members m
  where m.user_id = (select auth.uid()) and m.role = 'owner'
  order by m.created_at
  limit 1;
  if hh is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return public.backup_bundle(hh);
end;
$$;

create function public.storage_usage()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  hh uuid;
begin
  select m.household_id into hh
  from public.household_members m
  where m.user_id = (select auth.uid()) and m.role in ('owner', 'editor')
  order by m.created_at
  limit 1;
  if hh is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    -- the photo files in storage (the original and the small copy of each), this household's folder
    'photo_bytes', coalesce((
      select sum((o.metadata ->> 'size')::bigint)
      from storage.objects o
      where o.bucket_id = 'recipe-photos' and (storage.foldername(o.name))[1] = hh::text
    ), 0)
  );
end;
$$;

revoke all on function public.export_backup() from public, anon;
grant execute on function public.export_backup() to authenticated;
revoke all on function public.storage_usage() from public, anon;
grant execute on function public.storage_usage() to authenticated;
