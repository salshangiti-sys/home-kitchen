-- What she teaches the ingredient dictionary (public.ingredient_aliases and its functions): who can read
-- and change it, and the rules. Runs in CI after the migrations, in one household of its own.

do $t$
declare
  owner_id uuid := gen_random_uuid();
  editor_id uuid := gen_random_uuid();
  viewer_id uuid := gen_random_uuid();
  stranger_id uuid := gen_random_uuid();
  hh uuid;
  n int;
begin
  insert into auth.users (id) values (owner_id), (editor_id), (viewer_id), (stranger_id);
  insert into public.households (name) values ('بيت الاختبار') returning id into hh;
  insert into public.household_members (household_id, user_id, role) values (hh, owner_id, 'owner'), (hh, editor_id, 'editor'), (hh, viewer_id, 'viewer');

  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_ingredient_alias('فلفل هالبينو', 'فلفل حار', 'produce');
  perform public.set_ingredient_alias('فلفل هالبينو', 'فلفل أخضر', 'produce');      -- again: one row, the new target
  perform public.set_ingredient_alias('زعتر اخضر', null, 'spices');                  -- an item of its own
  perform public.set_ingredient_alias('  برغل  ', '   ', 'pantry');                   -- spaces are trimmed, an empty target means "of its own"
  select count(*) into n from public.ingredient_aliases;
  if n <> 3 then raise exception 'FAILED: expected 3 aliases, got %', n; end if;
  if (select target from public.ingredient_aliases where name_key = 'فلفل هالبينو') <> 'فلفل أخضر' then raise exception 'FAILED: an alias is updated, not duplicated'; end if;
  if (select target from public.ingredient_aliases where name_key = 'برغل') is not null then raise exception 'FAILED: an empty target should be none'; end if;

  begin perform public.set_ingredient_alias('x', 'y', 'garage'); raise exception 'FAILED: an unknown aisle was accepted';
  exception when check_violation then null; end;
  begin perform public.set_ingredient_alias('   ', 'y', 'pantry'); raise exception 'FAILED: an empty name was accepted';
  exception when check_violation then null; end;
  begin perform public.set_ingredient_alias('x', 'y', 'none'); raise exception 'FAILED: the "none" aisle was accepted';
  exception when check_violation then null; end;
  begin
    insert into public.ingredient_aliases (household_id, name_key, aisle) values (hh, 'direct', 'other');
    raise exception 'FAILED: a direct write to the table was allowed';
  exception when sqlstate '42501' then null;
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', editor_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.remove_ingredient_alias('برغل');
  select count(*) into n from public.ingredient_aliases;
  if n <> 2 then raise exception 'FAILED: remove deletes the alias (got % left)', n; end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', viewer_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.ingredient_aliases;
  if n <> 2 then raise exception 'FAILED: a reader should see the aliases'; end if;
  begin perform public.set_ingredient_alias('z', null, 'other'); raise exception 'FAILED: a reader taught the dictionary';
  exception when sqlstate '42501' then null; end;
  begin perform public.remove_ingredient_alias('زعتر اخضر'); raise exception 'FAILED: a reader removed an alias';
  exception when sqlstate '42501' then null; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', stranger_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.ingredient_aliases;
  if n <> 0 then raise exception 'FAILED: a stranger saw % aliases', n; end if;
  begin perform public.set_ingredient_alias('z', null, 'other'); raise exception 'FAILED: a stranger taught the dictionary';
  exception when sqlstate '42501' then null; end;
  reset role;

  raise notice 'INGREDIENT ALIASES PASSED';
end $t$;
