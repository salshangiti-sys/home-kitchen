-- The nightly backup now also copies the recipe photo files to OneDrive (photos/<id>.jpg), a few at
-- a time. Each run records how the photo copy went. A problem with photos does not make the data
-- backup count as failed: it is shown as a warning.

alter table public.backup_runs
  add column photos_total integer,   -- photos in the app
  add column photos_copied integer,  -- copied by this run
  add column photos_pending integer, -- still not in OneDrive after this run
  add column photos_error text;
