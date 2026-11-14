-- Confirmed quantities (public.quantity_confirmations and its functions): who can read and change them,
-- and the rules. Runs in CI after the migrations, in one household of its own.

do $t$
declare
  owner_id uuid := gen_random_uuid();
  editor_id uuid := gen_random_uuid();
  viewer_id uuid := gen_random_uuid();
  stranger_id uuid := gen_random_uuid();
  hh uuid;
  rid text;
  doc jsonb := '{"title":"x","status":"note_only","category":{"section":"s"},"sources":[],"ingredient_groups":[],"steps":[],"notes":[],"tags":{},"onenote":{},"raw_text":"x","flags":[]}';
  n int;
begin
  insert into auth.users (id) values (owner_id), (editor_id), (viewer_id), (stranger_id);
  insert into public.households (name) values ('بيت الاختبار') returning id into hh;
  insert into public.household_members (household_id, user_id, role) values (hh, owner_id, 'owner'), (hh, editor_id, 'editor'), (hh, viewer_id, 'viewer');
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  rid := public.save_recipe(doc, null, 'app') ->> 'id';

  perform public.confirm_quantity(rid, '٣ فصوص ثوم', 'ثوم', 3, 'clove');
  perform public.confirm_quantity(rid, '٣ فصوص ثوم', 'ثوم', 4, 'clove');         -- again: one row, the new quantity
  perform public.confirm_quantity(rid, '٢ بصلة', 'بصل', 2, null);                 -- a plain count has no unit
  perform public.confirm_quantity(rid, 'ملح، كمون ١ م ص', 'كمون', 1, 'tsp');     -- a line that lists several items: one per item
  select count(*) into n from public.quantity_confirmations;
  if n <> 3 then raise exception 'FAILED: expected 3 confirmations, got %', n; end if;
  if (select quantity from public.quantity_confirmations where item_key = 'ثوم') <> 4 then raise exception 'FAILED: a confirmation is updated, not duplicated'; end if;

  begin perform public.confirm_quantity(rid, 'x', 'x', 0, 'g'); raise exception 'FAILED: a zero quantity was accepted';
  exception when check_violation then null; end;
  begin perform public.confirm_quantity(rid, 'x', 'x', -2, 'g'); raise exception 'FAILED: a negative quantity was accepted';
  exception when check_violation then null; end;
  begin perform public.confirm_quantity(rid, 'x', 'x', 2, 'bucket'); raise exception 'FAILED: an unknown unit was accepted';
  exception when check_violation then null; end;
  begin perform public.confirm_quantity('no-such-recipe', 'x', 'x', 2, 'g'); raise exception 'FAILED: an unknown recipe was accepted';
  exception when others then if sqlerrm like 'FAILED%' then raise; end if; end;
  begin
    insert into public.quantity_confirmations (household_id, recipe_id, line, item_key, quantity) values (hh, rid, 'y', 'y', 1);
    raise exception 'FAILED: a direct write to the table was allowed';
  exception when sqlstate '42501' then null;
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', editor_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.unconfirm_quantity(rid, '٢ بصلة', 'بصل');
  select count(*) into n from public.quantity_confirmations;
  if n <> 2 then raise exception 'FAILED: unconfirm removes the confirmation (got % left)', n; end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', viewer_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.quantity_confirmations;
  if n <> 2 then raise exception 'FAILED: a reader should see the confirmations'; end if;
  begin perform public.confirm_quantity(rid, 'z', 'z', 1, 'g'); raise exception 'FAILED: a reader confirmed a quantity';
  exception when sqlstate '42501' then null; end;
  begin perform public.unconfirm_quantity(rid, '٣ فصوص ثوم', 'ثوم'); raise exception 'FAILED: a reader removed a confirmation';
  exception when sqlstate '42501' then null; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', stranger_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.quantity_confirmations;
  if n <> 0 then raise exception 'FAILED: a stranger saw % confirmations', n; end if;
  begin perform public.confirm_quantity(rid, 'z', 'z', 1, 'g'); raise exception 'FAILED: a stranger confirmed a quantity';
  exception when sqlstate '42501' then null; end;
  reset role;

  -- a confirmation goes with its recipe
  delete from public.recipes where id = rid;
  select count(*) into n from public.quantity_confirmations where household_id = hh; -- (as the database owner this sees every household's, left by other tests)
  if n <> 0 then raise exception 'FAILED: confirmations outlived their recipe'; end if;

  raise notice 'QUANTITY CONFIRMATIONS PASSED';
end $t$;
