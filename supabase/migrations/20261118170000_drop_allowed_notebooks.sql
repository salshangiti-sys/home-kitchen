-- Left over from the Phase 0 sync experiment, which could write into a test notebook. Nothing reads
-- it any more: the app reads pages and creates new ones only, in the library set in onenote_library.
-- Its one row pointed at the test notebook «وصفات - تجربة».
drop table public.onenote_allowed_notebooks;
