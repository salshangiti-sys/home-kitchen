-- rls_auto_enable() is the event trigger function behind the project's "automatic RLS" setting.
-- Event trigger functions cannot be called directly and event triggers do not check EXECUTE,
-- so revoking it only removes the meaningless /rest/v1/rpc exposure the security advisor flags.
--
-- The function exists in the hosted project only (the setting creates it), not in a database built
-- from these migrations alone (the restore test in CI), so the revoke runs only where it exists.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;
