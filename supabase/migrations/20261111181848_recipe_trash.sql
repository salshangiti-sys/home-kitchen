-- Trash: a recipe can be moved to the trash and restored. Nothing is erased: the recipe, its
-- history, favorites and OneNote link stay as they were, and the app never empties the trash on
-- its own. Only owners and editors can do either, and only through these functions (the tables
-- themselves cannot be written directly).

create function public.trash_recipe(p_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.recipes r
  set deleted_at = now(), updated_at = now()
  where r.id = p_id and r.deleted_at is null and private.can_edit_household(r.household_id);
  if not found then
    raise exception 'recipe not found, already in the trash, or not allowed' using errcode = '42501';
  end if;
end;
$$;

create function public.restore_recipe(p_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.recipes r
  set deleted_at = null, updated_at = now()
  where r.id = p_id and r.deleted_at is not null and private.can_edit_household(r.household_id);
  if not found then
    raise exception 'recipe not found, not in the trash, or not allowed' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.trash_recipe(text) from public, anon;
revoke all on function public.restore_recipe(text) from public, anon;
grant execute on function public.trash_recipe(text) to authenticated;
grant execute on function public.restore_recipe(text) to authenticated;
