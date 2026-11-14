-- The Phase 0 sync experiment is over (the app only reads OneNote pages and creates new ones; see
-- docs/02-phase0-findings.md). Its four tables held test data from the test notebook and nothing
-- uses them any more: no function, view, trigger or other table refers to them. Dropped at the
-- owner's request (2026-11-14). The plain DROP (no CASCADE) fails if anything still depends on them.
drop table public.sync_conflicts;
drop table public.onenote_snapshots;
drop table public.onenote_links;
drop table public.spike_recipes;
