-- Move the RLS membership helpers out of the API-exposed public schema. Policies refer to
-- functions by OID, so they keep working; the helpers are just no longer callable via /rest/v1/rpc.
create schema if not exists private;
grant usage on schema private to authenticated, service_role;

alter function public.is_household_member(uuid) set schema private;
alter function public.can_edit_household(uuid) set schema private;

revoke all on function private.is_household_member(uuid) from public, anon;
revoke all on function private.can_edit_household(uuid) from public, anon;
grant execute on function private.is_household_member(uuid) to authenticated, service_role;
grant execute on function private.can_edit_household(uuid) to authenticated, service_role;
