-- What is in the freezer (public.freezer_items and its functions): who can read and change it, taking an
-- amount off, and the rules. Runs in CI after the migrations, in households of its own.

do $t$
declare
  owner_id uuid := gen_random_uuid();
  editor_id uuid := gen_random_uuid();
  viewer_id uuid := gen_random_uuid();
  stranger_id uuid := gen_random_uuid();
  other_owner uuid := gen_random_uuid();
  hh uuid;
  hh2 uuid;
  doc jsonb := '{"title":"كرات لحم","status":"complete","category":{"section":"مفرزنات › كفتة"},"sources":[],"ingredient_groups":[],"steps":[],"notes":[],"onenote":{},"raw_text":"x"}';
  rid text;
  foreign_rid text;
  item uuid;
  item2 uuid;
  left_over numeric;
  n int;
begin
  insert into auth.users (id) values (owner_id), (editor_id), (viewer_id), (stranger_id), (other_owner);
  insert into public.households (name) values ('بيت الاختبار') returning id into hh;
  insert into public.households (name) values ('بيت آخر') returning id into hh2;
  insert into public.household_members (household_id, user_id, role) values (hh, owner_id, 'owner'), (hh, editor_id, 'editor'), (hh, viewer_id, 'viewer'), (hh2, other_owner, 'owner');

  perform set_config('request.jwt.claims', json_build_object('sub', other_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  foreign_rid := public.save_recipe(doc, null, 'app') ->> 'id';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  rid := public.save_recipe(doc, null, 'app') ->> 'id';

  -- adding: with a recipe, with the defaults (unit «قطعة», today)
  item := public.save_freezer_item(null, '  كرات لحم  ', 12, 'كرة', date '2026-11-01', rid, 'كيس 500 غ');
  item2 := public.save_freezer_item(null, 'صوص طماطم', 3, null, null, null, '  ');
  select count(*) into n from public.freezer_items;
  if n <> 2 then raise exception 'FAILED: expected 2 items, got %', n; end if;
  if (select name from public.freezer_items where id = item) <> 'كرات لحم' then raise exception 'FAILED: the name is trimmed'; end if;
  if (select unit from public.freezer_items where id = item2) <> 'قطعة' then raise exception 'FAILED: the unit defaults to «قطعة»'; end if;
  if (select frozen_on from public.freezer_items where id = item2) <> current_date then raise exception 'FAILED: the day defaults to today'; end if;
  if (select note from public.freezer_items where id = item2) is not null then raise exception 'FAILED: an empty note should be none'; end if;
  if (select recipe_id from public.freezer_items where id = item) <> rid then raise exception 'FAILED: the recipe link is kept'; end if;

  -- changing keeps one row
  perform public.save_freezer_item(item, 'كرات لحم', 10, 'كرة', null, rid, null);
  if (select quantity from public.freezer_items where id = item) <> 10 then raise exception 'FAILED: the quantity was not changed'; end if;
  if (select frozen_on from public.freezer_items where id = item) <> date '2026-11-01' then raise exception 'FAILED: an empty day on a change keeps the old day'; end if;
  select count(*) into n from public.freezer_items;
  if n <> 2 then raise exception 'FAILED: a change added a row'; end if;

  -- taking off: one, an amount, and the item goes when nothing is left
  left_over := public.use_freezer_item(item);
  if left_over <> 9 then raise exception 'FAILED: using one should leave 9, got %', left_over; end if;
  left_over := public.use_freezer_item(item, 4.5);
  if left_over <> 4.5 then raise exception 'FAILED: using 4.5 should leave 4.5, got %', left_over; end if;
  left_over := public.use_freezer_item(item, 10);
  if left_over <> 0 then raise exception 'FAILED: using more than is left should leave 0, got %', left_over; end if;
  select count(*) into n from public.freezer_items where id = item;
  if n <> 0 then raise exception 'FAILED: an item with nothing left should be removed'; end if;

  -- the rules
  begin perform public.save_freezer_item(null, 'x', 0, 'قطعة', null, null, null); raise exception 'FAILED: a zero quantity was accepted';
  exception when check_violation then null; end;
  begin perform public.save_freezer_item(null, 'x', -2, 'قطعة', null, null, null); raise exception 'FAILED: a negative quantity was accepted';
  exception when check_violation then null; end;
  begin perform public.save_freezer_item(null, '   ', 1, 'قطعة', null, null, null); raise exception 'FAILED: an empty name was accepted';
  exception when check_violation then null; end;
  begin perform public.save_freezer_item(null, 'x', 1, 'قطعة', null, foreign_rid, null); raise exception 'FAILED: a recipe of another household was linked';
  exception when sqlstate 'P0001' then null; end;
  begin perform public.use_freezer_item(item2, 0); raise exception 'FAILED: using nothing was accepted';
  exception when sqlstate 'P0001' then null; end;
  begin perform public.use_freezer_item(gen_random_uuid()); raise exception 'FAILED: an unknown item was used';
  exception when sqlstate 'P0001' then null; end;
  begin
    insert into public.freezer_items (household_id, name, quantity) values (hh, 'direct', 1);
    raise exception 'FAILED: a direct write to the table was allowed';
  exception when sqlstate '42501' then null;
  end;
  reset role;

  -- a recipe in the trash is not linked; deleting a linked recipe keeps the item
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  item := public.save_freezer_item(null, 'معجنات', 20, 'قطعة', null, rid, null);
  perform public.trash_recipe(rid);
  begin perform public.save_freezer_item(null, 'y', 1, 'قطعة', null, rid, null); raise exception 'FAILED: a trashed recipe was linked';
  exception when sqlstate 'P0001' then null; end;
  reset role;
  delete from public.recipes where id = rid;
  select count(*) into n from public.freezer_items where id = item and recipe_id is null;
  if n <> 1 then raise exception 'FAILED: deleting the recipe should keep the item and clear its link'; end if;

  -- an editor changes it, a reader only reads, a stranger sees nothing and changes nothing
  perform set_config('request.jwt.claims', json_build_object('sub', editor_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.use_freezer_item(item2);
  perform public.remove_freezer_item(item);
  select count(*) into n from public.freezer_items;
  if n <> 1 then raise exception 'FAILED: the editor should have left 1 item, got %', n; end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', viewer_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.freezer_items;
  if n <> 1 then raise exception 'FAILED: a reader should see the item'; end if;
  begin perform public.save_freezer_item(null, 'z', 1, 'قطعة', null, null, null); raise exception 'FAILED: a reader added an item';
  exception when sqlstate '42501' then null; end;
  begin perform public.use_freezer_item(item2); raise exception 'FAILED: a reader used an item';
  exception when sqlstate '42501' then null; end;
  begin perform public.remove_freezer_item(item2); raise exception 'FAILED: a reader removed an item';
  exception when sqlstate '42501' then null; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', stranger_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.freezer_items;
  if n <> 0 then raise exception 'FAILED: a stranger saw % items', n; end if;
  begin perform public.save_freezer_item(null, 'z', 1, 'قطعة', null, null, null); raise exception 'FAILED: a stranger added an item';
  exception when sqlstate '42501' then null; end;
  reset role;

  -- another household's owner cannot touch this household's items
  perform set_config('request.jwt.claims', json_build_object('sub', other_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.use_freezer_item(item2); raise exception 'FAILED: another household used an item';
  exception when sqlstate 'P0001' then null; end;
  perform public.remove_freezer_item(item2);
  reset role;
  select count(*) into n from public.freezer_items where id = item2;
  if n <> 1 then raise exception 'FAILED: another household removed an item'; end if;

  raise notice 'FREEZER PASSED';
end $t$;
