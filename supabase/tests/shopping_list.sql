-- The shopping list's stored part (marks and pantry): who can read and write, and the rules. Runs in CI
-- after the migrations, in one household of its own. Any failure raises an error.

do $t$
declare
  owner_id uuid := gen_random_uuid();
  editor_id uuid := gen_random_uuid();
  viewer_id uuid := gen_random_uuid();
  stranger_id uuid := gen_random_uuid();
  hh uuid;
  wk date := date '2026-11-14';
  n int;
begin
  insert into auth.users (id) values (owner_id), (editor_id), (viewer_id), (stranger_id);
  insert into public.households (name) values ('بيت الاختبار') returning id into hh;
  insert into public.household_members (household_id, user_id, role) values (hh, owner_id, 'owner'), (hh, editor_id, 'editor'), (hh, viewer_id, 'viewer');

  -- an owner marks, adds, keeps at home
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_shopping_mark(wk, 'ثوم', 'bought');
  perform public.set_shopping_mark(wk, 'ثوم', 'needed');           -- the same item again: one row, new status
  perform public.set_shopping_mark(wk, 'ملح', 'have');
  perform public.add_shopping_item(wk, 'حفاضات', 'حفاضات');
  perform public.set_pantry_item('زيت', 'زيت', true);
  perform public.set_pantry_item('زيت', 'زيت', true);               -- twice: one row
  perform public.set_pantry_item('سكر', 'سكر', true);
  perform public.set_pantry_item('سكر', 'سكر', false);              -- and removed
  select count(*) into n from public.shopping_marks;
  if n <> 3 then raise exception 'FAILED: expected 3 marks, got %', n; end if;
  if (select status from public.shopping_marks where key = 'ثوم') <> 'needed' then raise exception 'FAILED: a mark is updated, not duplicated'; end if;
  if not (select is_manual and label = 'حفاضات' and status = 'needed' from public.shopping_marks where key = 'حفاضات') then raise exception 'FAILED: a manual item is manual, with its label'; end if;
  select count(*) into n from public.pantry_items;
  if n <> 1 then raise exception 'FAILED: expected 1 pantry item, got %', n; end if;

  -- a manual item that is added again stays manual and goes back to "to buy"
  perform public.set_shopping_mark(wk, 'حفاضات', 'bought');
  perform public.add_shopping_item(wk, 'حفاضات', 'حفاضات مقاس 3');
  if not (select is_manual and label = 'حفاضات' and status = 'needed' from public.shopping_marks where key = 'حفاضات') then raise exception 'FAILED: re-adding a manual item'; end if;

  -- bad input
  begin perform public.set_shopping_mark(wk, 'ثوم', 'maybe'); raise exception 'FAILED: bad status accepted';
  exception when others then if sqlerrm like 'FAILED%' then raise; end if; end;
  begin perform public.set_shopping_mark(wk, '   ', 'needed'); raise exception 'FAILED: an empty name was accepted';
  exception when check_violation then null; end;
  begin perform public.set_shopping_mark(date '1990-01-01', 'ثوم', 'needed'); raise exception 'FAILED: a week out of range was accepted';
  exception when check_violation then null; end;
  begin perform public.add_shopping_item(wk, 'x', ''); raise exception 'FAILED: a manual item without a name was accepted';
  exception when check_violation then null; end;
  begin
    insert into public.shopping_marks (household_id, week_start, key) values (hh, wk, 'direct');
    raise exception 'FAILED: a direct write to the table was allowed';
  exception when sqlstate '42501' then null;
  end;
  reset role;

  -- the week is its own: the same item in another week is another mark
  perform set_config('request.jwt.claims', json_build_object('sub', editor_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_shopping_mark(wk + 7, 'ثوم', 'bought');
  select count(*) into n from public.shopping_marks where key = 'ثوم';
  if n <> 2 then raise exception 'FAILED: marks are per week'; end if;
  perform public.clear_shopping_mark(wk + 7, 'ثوم');
  perform public.clear_shopping_mark(wk, 'حفاضات');                 -- a manual item is removed
  select count(*) into n from public.shopping_marks;
  if n <> 2 then raise exception 'FAILED: clear removes the mark (got % left)', n; end if;
  reset role;

  -- a reader sees everything and changes nothing
  perform set_config('request.jwt.claims', json_build_object('sub', viewer_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.shopping_marks;
  if n <> 2 then raise exception 'FAILED: a reader should see the marks'; end if;
  select count(*) into n from public.pantry_items;
  if n <> 1 then raise exception 'FAILED: a reader should see the pantry'; end if;
  begin perform public.set_shopping_mark(wk, 'ثوم', 'bought'); raise exception 'FAILED: a reader marked an item';
  exception when sqlstate '42501' then null; end;
  begin perform public.add_shopping_item(wk, 'x', 'x'); raise exception 'FAILED: a reader added an item';
  exception when sqlstate '42501' then null; end;
  begin perform public.clear_shopping_mark(wk, 'ثوم'); raise exception 'FAILED: a reader cleared a mark';
  exception when sqlstate '42501' then null; end;
  begin perform public.set_pantry_item('x', 'x', true); raise exception 'FAILED: a reader changed the pantry';
  exception when sqlstate '42501' then null; end;
  reset role;

  -- a stranger sees nothing and changes nothing
  perform set_config('request.jwt.claims', json_build_object('sub', stranger_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.shopping_marks;
  if n <> 0 then raise exception 'FAILED: a stranger saw % marks', n; end if;
  begin perform public.set_shopping_mark(wk, 'ثوم', 'bought'); raise exception 'FAILED: a stranger marked an item';
  exception when sqlstate '42501' then null; end;
  reset role;

  raise notice 'SHOPPING LIST PASSED';
end $t$;
