-- rls_auto_enable() is the event trigger function behind the project's "automatic RLS" setting.
-- Event trigger functions cannot be called directly and event triggers do not check EXECUTE,
-- so revoking it only removes the meaningless /rest/v1/rpc exposure the security advisor flags.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
