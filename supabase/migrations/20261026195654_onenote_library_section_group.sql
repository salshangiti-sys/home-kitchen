-- The recipe library can be a section group inside a notebook (the owner's is «الطبخ» in
-- «البيت والطبخ», decided 2026-10-26), not only a whole notebook.
alter table public.onenote_library
  add column place_kind text not null default 'notebook' check (place_kind in ('notebook', 'sectionGroup')),
  add column place_id text,
  add column section_group text;

update public.onenote_library set place_id = notebook_id where place_id is null;

alter table public.onenote_library alter column place_id set not null;
