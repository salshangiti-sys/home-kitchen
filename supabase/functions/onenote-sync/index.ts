// Retired. This was the Phase 0 OneNote sync experiment (it could write into existing OneNote pages
// in the test notebook). The finished app never changes an existing page: it reads pages and creates
// new ones only (see onenote-library). The function stays deployed only so that old links answer
// "gone" instead of "not found", and it does nothing.

Deno.serve(
  () =>
    new Response(JSON.stringify({ error: 'retired', message: 'This function was retired. The app no longer writes to existing OneNote pages.' }), {
      status: 410,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    }),
)
