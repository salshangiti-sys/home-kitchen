-- Suggested ingredients (public.recipe_ingredient_suggestions and its functions): who can read and
-- change them, and the rules. Runs in CI after the migrations, in one household of its own.

do $t$
declare
  owner_id uuid := gen_random_uuid();
  editor_id uuid := gen_random_uuid();
  viewer_id uuid := gen_random_uuid();
  stranger_id uuid := gen_random_uuid();
  hh uuid;
  rid text;
  doc jsonb := '{"title":"x","status":"note_only","category":{"section":"s"},"sources":[],"ingredient_groups":[],"steps":[],"notes":[],"tags":{},"onenote":{},"raw_text":"x","flags":[]}';
  r jsonb; n int; sid uuid; sid2 uuid;
begin
  insert into auth.users (id) values (owner_id), (editor_id), (viewer_id), (stranger_id);
  insert into public.households (name) values ('بيت الاختبار') returning id into hh;
  insert into public.household_members (household_id, user_id, role) values (hh, owner_id, 'owner'), (hh, editor_id, 'editor'), (hh, viewer_id, 'viewer');
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  rid := public.save_recipe(doc, null, 'app') ->> 'id';
  reset role;

  -- loading is for the server only
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.load_ingredient_suggestions('[]'::jsonb);
    raise exception 'FAILED: a signed-in person could load suggestions';
  exception when sqlstate '42501' then null;
  end;
  begin
    insert into public.recipe_ingredient_suggestions (household_id, recipe_id, position, text) values (hh, rid, 1, 'x');
    raise exception 'FAILED: a direct write to the table was allowed';
  exception when sqlstate '42501' then null;
  end;
  reset role;

  r := public.load_ingredient_suggestions(jsonb_build_array(
    jsonb_build_object('recipe_id', rid, 'text', ' جزر ', 'quote', 'جزر وكوسة', 'source', 'method'),
    jsonb_build_object('recipe_id', rid, 'text', 'كوسة', 'quote', 'جزر وكوسة', 'source', 'method'),
    jsonb_build_object('recipe_id', rid, 'text', 'جزر'),                       -- again: skipped
    jsonb_build_object('recipe_id', 'no-such-recipe', 'text', 'ملح')));         -- no recipe: skipped
  if r <> '{"added": 2, "skipped": 2}'::jsonb then raise exception 'FAILED: loading gave %', r; end if;
  if (select array_agg(text order by position) from public.recipe_ingredient_suggestions where recipe_id = rid) <> array['جزر', 'كوسة'] then
    raise exception 'FAILED: texts or positions are wrong';
  end if;
  if exists (select 1 from public.recipe_ingredient_suggestions where recipe_id = rid and status <> 'suggested') then
    raise exception 'FAILED: loaded lines must start as suggested';
  end if;
  select id into sid from public.recipe_ingredient_suggestions where recipe_id = rid and text = 'جزر';
  select id into sid2 from public.recipe_ingredient_suggestions where recipe_id = rid and text = 'كوسة';

  -- everybody in the household reads; a stranger sees nothing
  perform set_config('request.jwt.claims', json_build_object('sub', viewer_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.recipe_ingredient_suggestions;
  if n <> 2 then raise exception 'FAILED: a reader should see the suggestions, saw %', n; end if;
  begin perform public.set_ingredient_suggestion(sid, 'confirmed'); raise exception 'FAILED: a reader confirmed a line';
  exception when sqlstate '42501' then null; end;
  begin perform public.add_ingredient(rid, 'ملح'); raise exception 'FAILED: a reader added a line';
  exception when sqlstate '42501' then null; end;
  begin perform public.confirm_recipe_suggestions(rid); raise exception 'FAILED: a reader confirmed all';
  exception when sqlstate '42501' then null; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', stranger_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.recipe_ingredient_suggestions;
  if n <> 0 then raise exception 'FAILED: a stranger saw % suggestions', n; end if;
  begin perform public.set_ingredient_suggestion(sid, 'confirmed'); raise exception 'FAILED: a stranger confirmed a line';
  exception when sqlstate '42501' then null; end;
  reset role;

  -- an editor confirms, edits, ignores, adds
  perform set_config('request.jwt.claims', json_build_object('sub', editor_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_ingredient_suggestion(sid, 'confirmed', 'جزر مبشور');
  if (select text || '/' || status from public.recipe_ingredient_suggestions where id = sid) <> 'جزر مبشور/confirmed' then raise exception 'FAILED: confirm with an edit'; end if;
  perform public.set_ingredient_suggestion(sid2, 'ignored');
  perform public.set_ingredient_suggestion(sid2, 'suggested');   -- brought back
  begin perform public.set_ingredient_suggestion(sid2, 'maybe'); raise exception 'FAILED: a bad status was accepted';
  exception when others then if sqlerrm like 'FAILED%' then raise; end if; end;
  begin perform public.set_ingredient_suggestion(sid2, 'confirmed', 'جزر مبشور'); raise exception 'FAILED: two lines got the same text';
  exception when unique_violation then null; end;
  perform public.add_ingredient(rid, 'ملح');
  if not exists (select 1 from public.recipe_ingredient_suggestions where recipe_id = rid and text = 'ملح' and status = 'confirmed' and source = 'manual' and position = 3) then
    raise exception 'FAILED: a line added by hand is confirmed, last in order';
  end if;
  begin perform public.add_ingredient(rid, '   '); raise exception 'FAILED: an empty line was accepted';
  exception when check_violation then null; end;
  if public.confirm_recipe_suggestions(rid) <> 1 then raise exception 'FAILED: confirm all should confirm the one waiting line'; end if;
  if public.confirm_recipe_suggestions(rid) <> 0 then raise exception 'FAILED: confirm all again should change nothing'; end if;
  reset role;

  -- a recipe in the trash takes no new lines
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.trash_recipe(rid);
  begin perform public.add_ingredient(rid, 'فلفل'); raise exception 'FAILED: a line was added to a trashed recipe';
  exception when sqlstate '42501' then null; end;
  reset role;

  raise notice 'INGREDIENT SUGGESTIONS PASSED';
end $t$;
