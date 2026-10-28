// Keeps the free Supabase project from being paused: Supabase pauses Free Plan projects that show
// little database activity over 7 days, and "a few user requests to the database each day" is
// enough to prevent it (supabase.com/docs/guides/platform/free-project-pausing). A daily GitHub
// Actions job (.github/workflows/keep-alive.yml) calls this function, which runs one small query.
// It needs no key and returns nothing private, so it is open to anyone.

import { adminClient } from '../_shared/server/http.ts'

Deno.serve(async () => {
  const { count, error } = await adminClient().from('households').select('id', { count: 'exact', head: true })
  if (error) return new Response(JSON.stringify({ ok: false }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  return new Response(JSON.stringify({ ok: true, checked: count !== null }), { headers: { 'Content-Type': 'application/json' } })
})
