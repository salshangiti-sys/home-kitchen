-- The old "link imported recipes by page_id" action of the onenote-library function (removed from the
-- code; the deployed copy still has it until the function is next deployed) saved, for every page_id it
-- could not find, a link marked "missing" with this exact error text. The page ids in recipes.json are
-- not OneNote API ids, so it would have marked every imported recipe's page as missing and blocked
-- the right linking (by title, public.link_pages_by_title). This guard refuses such a row.

create function private.refuse_import_missing_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.read_status = 'missing' and new.last_error like 'the page_id from the import was not found%' then
    raise exception 'link_imported_retired: link recipes to their pages by title instead';
  end if;
  return new;
end;
$$;

create trigger refuse_import_missing_link
  before insert or update on public.recipe_pages
  for each row execute function private.refuse_import_missing_link();
