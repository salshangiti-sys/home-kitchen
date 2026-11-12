-- The Phase 0 sync lab is retired: nobody writes to its table any more through the web API.
revoke insert, update, delete on public.spike_recipes from authenticated;
