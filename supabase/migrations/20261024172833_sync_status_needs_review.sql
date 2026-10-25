-- A write to OneNote that did not read back as expected stops syncing for that recipe until the
-- owner has looked at the page, so a damaged page is never pulled back into the app.
alter type public.sync_status add value if not exists 'needs_review';
