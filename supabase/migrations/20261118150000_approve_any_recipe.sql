-- The owner can approve any recipe in the review list, also one that never had a flag (the original
-- imports). It records an already-reviewed flag «owner_reviewed», which the review screen counts as
-- «approved». Flags are already part of the nightly backup and the restore, so this needs nothing more.
create function public.approve_recipe(p_recipe_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.recipes r
    where r.id = p_recipe_id and r.deleted_at is null and private.can_edit_household(r.household_id)
  ) then
    raise exception 'recipe not found or not allowed' using errcode = '42501';
  end if;
  insert into public.recipe_flags (recipe_id, flag, status, reviewed_by, reviewed_at)
  values (p_recipe_id, 'owner_reviewed', 'reviewed', (select auth.uid()), now())
  on conflict (recipe_id, flag) do update set status = 'reviewed', reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at;
end;
$$;

revoke all on function public.approve_recipe(text) from public, anon;
grant execute on function public.approve_recipe(text) to authenticated;
