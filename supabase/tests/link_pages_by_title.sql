-- Linking recipes to OneNote pages by title (public.link_pages_by_title). Runs in CI after the
-- migrations, in one household of its own. Any failure raises an error.

do $t$
declare
  owner_id uuid := gen_random_uuid();
  editor_id uuid := gen_random_uuid();
  viewer_id uuid := gen_random_uuid();
  hh uuid;
  doc jsonb := '{"title":"x","status":"complete","category":{"section":"سلطات","section_en":"Salads"},"sources":[],"ingredient_groups":[],"steps":[],"notes":[],"tags":{},"onenote":{},"raw_text":"x","flags":[]}';
  caesar text; kale text; chicken1 text; chicken2 text; lonely text; trashed text; already text;
  r jsonb; n int;
begin
  insert into auth.users (id) values (owner_id), (editor_id), (viewer_id);
  insert into public.households (name) values ('بيت الاختبار') returning id into hh;
  insert into public.household_members (household_id, user_id, role) values (hh, owner_id, 'owner'), (hh, editor_id, 'editor'), (hh, viewer_id, 'viewer');
  insert into public.onenote_library (household_id, user_id, place_id, place_kind, notebook_id, notebook_name, section_group, sections)
    values (hh, owner_id, 'place-1', 'sectionGroup', 'nb-1', 'البيت والطبخ', 'الطبخ', '[]'::jsonb);

  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  caesar   := public.save_recipe(doc || '{"title":"سلطة سيزر"}', null, 'app') ->> 'id';
  kale     := public.save_recipe(doc || '{"title":"سلطة الكيل والسبانخ"}', null, 'app') ->> 'id';
  chicken1 := public.save_recipe(doc || '{"title":"دجاج مشوي"}', null, 'app') ->> 'id';
  chicken2 := public.save_recipe(doc || '{"title":"دجاج مشوي"}', null, 'app') ->> 'id';
  lonely   := public.save_recipe(doc || '{"title":"وصفة بلا صفحة"}', null, 'app') ->> 'id';
  trashed  := public.save_recipe(doc || '{"title":"في السلة"}', null, 'app') ->> 'id';
  already  := public.save_recipe(doc || '{"title":"مربوطة أصلًا"}', null, 'app') ->> 'id';
  perform public.trash_recipe(trashed);
  reset role;

  insert into public.recipe_pages (recipe_id, page_id, notebook_id, section_name, web_url) values (already, 'page-already', 'nb-1', 'سلطات', 'https://example.test/a');
  insert into public.onenote_unlinked_pages (household_id, page_id, title, section_id, section_name, web_url) values
    (hh, 'page-caesar',  'سلطة سيزر ',          's1', 'سلطات', 'https://example.test/caesar'),       -- trailing space
    (hh, 'page-kale',    'سلطه الكيل والسبانخ', 's1', 'سلطات', 'https://example.test/kale'),         -- ه for ة
    (hh, 'page-chicken', 'دجاج مشوي',           's2', 'دجاج',  'https://example.test/chicken'),      -- two recipes share it
    (hh, 'page-nobody',  'صفحة بلا وصفة',       's2', 'دجاج',  'https://example.test/nobody'),
    (hh, 'page-trashed', 'في السلة',            's2', 'دجاج',  'https://example.test/trashed');      -- its recipe is in the trash

  -- readers are refused
  perform set_config('request.jwt.claims', json_build_object('sub', viewer_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.link_pages_by_title(true);
    raise exception 'FAILED: a reader could preview the linking';
  exception when sqlstate '42501' then null;
  end;
  reset role;

  -- an editor can; the dry run changes nothing and says what it would do
  perform set_config('request.jwt.claims', json_build_object('sub', editor_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.link_pages_by_title(true);
  reset role;
  if (r ->> 'linked')::int <> 2 then raise exception 'FAILED: expected 2 links, got %', r; end if;
  if (select count(*) from jsonb_array_elements(r -> 'pairs') p where p ->> 'recipe_id' in (caesar, kale)) <> 2 then raise exception 'FAILED: the wrong recipes were paired: %', r; end if;
  if (r ->> 'pages_without_recipe')::int <> 3 then raise exception 'FAILED: expected 3 pages without a recipe (chicken, nobody, trashed), got %', r; end if;
  if (r ->> 'recipes_without_page')::int <> 3 then raise exception 'FAILED: expected 3 recipes without a page (2 chicken + lonely), got %', r; end if;
  if jsonb_array_length(r -> 'ambiguous_titles') <> 1 then raise exception 'FAILED: expected the chicken title as ambiguous, got %', r; end if;
  select count(*) into n from public.recipe_pages where recipe_id in (caesar, kale);
  if n <> 0 then raise exception 'FAILED: the dry run linked something'; end if;
  select count(*) into n from public.onenote_unlinked_pages where household_id = hh;
  if n <> 5 then raise exception 'FAILED: the dry run changed the list of pages'; end if;

  -- the real run
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.link_pages_by_title(false);
  reset role;
  if (r ->> 'linked')::int <> 2 then raise exception 'FAILED: the real run linked %', r; end if;
  if not exists (select 1 from public.recipe_pages where recipe_id = caesar and page_id = 'page-caesar' and notebook_id = 'nb-1' and section_name = 'سلطات' and read_status = 'ok' and last_read_at is null and web_url = 'https://example.test/caesar') then
    raise exception 'FAILED: the caesar link is wrong';
  end if;
  if not exists (select 1 from public.recipe_pages where recipe_id = kale and page_id = 'page-kale') then raise exception 'FAILED: the kale link is missing'; end if;
  if exists (select 1 from public.recipe_pages where recipe_id in (chicken1, chicken2, lonely, trashed)) then raise exception 'FAILED: an ambiguous, lonely or trashed recipe was linked'; end if;
  select count(*) into n from public.onenote_unlinked_pages where household_id = hh and page_id in ('page-caesar', 'page-kale');
  if n <> 0 then raise exception 'FAILED: linked pages are still listed as not in the app'; end if;
  select count(*) into n from public.onenote_unlinked_pages where household_id = hh;
  if n <> 3 then raise exception 'FAILED: the other pages must stay listed (got %)', n; end if;
  -- the recipe text is not touched
  if (select title from public.recipes where id = caesar) <> 'سلطة سيزر' or (select version from public.recipes where id = caesar) <> 1 then
    raise exception 'FAILED: linking changed a recipe';
  end if;

  -- again: nothing left to link
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.link_pages_by_title(false);
  reset role;
  if (r ->> 'linked')::int <> 0 then raise exception 'FAILED: a second run linked %', r; end if;

  raise notice 'LINK BY TITLE PASSED';
end $t$;

-- The retired "link imported by page_id" action can no longer write its "missing" links.
do $t$
declare
  owner_id uuid := gen_random_uuid();
  hh uuid;
  rid text;
begin
  insert into auth.users (id) values (owner_id);
  insert into public.households (name) values ('بيت الاختبار') returning id into hh;
  insert into public.household_members (household_id, user_id, role) values (hh, owner_id, 'owner');
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  rid := public.save_recipe('{"title":"x","status":"complete","category":{"section":"s"},"sources":[],"ingredient_groups":[],"steps":[],"notes":[],"tags":{},"onenote":{},"raw_text":"x","flags":[]}'::jsonb, null, 'app') ->> 'id';
  reset role;
  begin
    insert into public.recipe_pages (recipe_id, page_id, notebook_id, read_status, last_error)
      values (rid, 'fake-page', 'nb-1', 'missing', 'the page_id from the import was not found in the recipe notebook');
    raise exception 'FAILED: the retired action could still write a missing link';
  exception when others then
    if sqlerrm not like 'link_imported_retired%' then raise; end if;
  end;
  -- an ordinary missing link (a page deleted in OneNote) is still allowed
  insert into public.recipe_pages (recipe_id, page_id, notebook_id, read_status, last_error)
    values (rid, 'real-page', 'nb-1', 'missing', 'the page is not in the recipe notebook any more');
  raise notice 'GUARD PASSED';
end $t$;
