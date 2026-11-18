-- Pages in the notebook that are not recipes (a list, a note to herself) can be ignored: they stop
-- appearing in the review list and in its count, and the next check does not bring them back.
-- Kept as a column on the library row ({ "<page id>": "<title>" }), so nothing new needs its own
-- backup: the nightly backup already exports the whole row. A restore does not bring the library
-- row back, so after a restore ignored pages show up again and can be ignored again.
alter table public.onenote_library add column ignored_pages jsonb not null default '{}'::jsonb;

-- A check replaces the review list every time; ignored pages are left out when it does.
create function private.skip_ignored_unlinked_page()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.onenote_library l where l.household_id = new.household_id and l.ignored_pages ? new.page_id) then
    return null;
  end if;
  return new;
end;
$$;

create trigger skip_ignored_unlinked_page
  before insert on public.onenote_unlinked_pages
  for each row execute function private.skip_ignored_unlinked_page();

-- The owner ignores a page of the review list.
create function public.ignore_onenote_page(p_page_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid uuid;
  page_title text;
begin
  select u.household_id, u.title into hid, page_title
  from public.onenote_unlinked_pages u
  where u.page_id = p_page_id and private.can_edit_household(u.household_id)
  limit 1;
  if hid is null then
    raise exception 'page not found or not allowed' using errcode = '42501';
  end if;
  update public.onenote_library set ignored_pages = ignored_pages || jsonb_build_object(p_page_id, coalesce(page_title, '')) where household_id = hid;
  delete from public.onenote_unlinked_pages where household_id = hid and page_id = p_page_id;
end;
$$;

-- Takes a page off the ignored list; the next check lists it for review again.
create function public.unignore_onenote_page(p_page_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.onenote_library l set ignored_pages = l.ignored_pages - p_page_id
  where l.ignored_pages ? p_page_id and private.can_edit_household(l.household_id);
  if not found then
    raise exception 'page is not ignored or not allowed' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.ignore_onenote_page(text) from public, anon;
revoke all on function public.unignore_onenote_page(text) from public, anon;
grant execute on function public.ignore_onenote_page(text) to authenticated;
grant execute on function public.unignore_onenote_page(text) to authenticated;
