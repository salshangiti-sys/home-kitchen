-- The restore rehearsal. Runs in CI on a throw-away database made from the migrations, and is the
-- same drill that was done by hand: build a household full of data, take the backup the nightly job
-- takes, WIPE the household, restore it from the file (as if the file came from a lost project whose
-- owner had another account), and require every part of the backup to come back identical.
--
-- It also fails when the backup gains a part that the restore does not cover, when the restore is not
-- repeatable (a second run must add nothing), when a dry run changes anything, when a restore
-- overwrites a recipe that was edited since, and when a non-owner or a bad file is accepted.
--
-- Everything happens in one household of its own, in one transaction (a DO block). Passing prints
-- RESTORE REHEARSAL PASSED; any failure raises an error, so `psql -v ON_ERROR_STOP=1` exits non-zero.

do $t$
declare
  owner_id uuid := gen_random_uuid();
  viewer_id uuid := gen_random_uuid();
  old_owner uuid := gen_random_uuid();
  hh uuid;
  doc1 jsonb := '{"title":"سلطة تجربة","status":"complete","category":{"section":"سلطات","section_en":"Salads"},"sources":[{"url":"https://example.test/v","platform":"web"}],"ingredient_groups":[{"name":null,"items":[{"text":"خس"},{"text":"زيت زيتون"}]}],"steps":[{"order":1,"text":"قطّعي"}],"notes":["باردة"],"tags":{"meal_types":["lunch"],"kid_friendly":true,"custom":["سريعة"]},"onenote":{},"raw_text":"x","flags":["quantities_missing"]}';
  sat date := date '2026-11-14';
  a text; b text; c text; fid uuid; lunch uuid; dinner uuid; p1 uuid; p2 uuid; m1 uuid; m2 uuid; t1 uuid; t2 uuid;
  b1 jsonb; b2 jsonb; b3 jsonb; exported jsonb; file_a jsonb; file_b jsonb; res jsonb; res2 jsonb;
  part text; key text; n int; log text := '';
  -- the parts the restore brings back, and the parts it leaves out on purpose
  restored text[] := array['recipes','deleted_recipes','favorites','flags','versions','onenote_pages','cook_log','food_groups','plan_settings','people','meal_slots','week_plans','planned_meals','slot_food_groups','prep_templates','prep_tasks'];
  left_out text[] := array['household','members','onenote_library','photos'];
begin
  insert into auth.users (id) values (owner_id), (viewer_id);
  insert into public.households (name) values ('بيت الاختبار') returning id into hh;
  insert into public.household_members (household_id, user_id, role) values (hh, owner_id, 'owner'), (hh, viewer_id, 'viewer');

  -- ---- build the household ----
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.plan_defaults();
  perform public.set_week_start(6);
  select id into lunch from public.meal_slots where name = 'غداء';
  select id into dinner from public.meal_slots where name = 'عشاء';

  a := public.save_recipe(doc1, null, 'app') ->> 'id';
  b := public.save_recipe(doc1 || '{"title":"شوربة تجربة","category":{"section":"شوربات","section_en":"Soups"},"flags":[]}', null, 'app') ->> 'id';
  c := public.save_recipe(doc1 || '{"title":"حلى للحذف","category":{"section":"حلى","section_en":"Dessert"}}', null, 'app') ->> 'id';
  perform public.save_recipe(public.recipe_doc(b) || '{"title":"شوربة عُدّلت"}', 1, 'app');   -- a second version
  perform public.trash_recipe(c);
  perform public.set_recipe_food_groups(a, array['protein','carbs']);

  insert into public.user_favorites (user_id, recipe_id) values (owner_id, a), (owner_id, b);
  select f.id into fid from public.recipe_flags f where f.recipe_id = a limit 1;
  perform public.set_flag_status(fid, 'reviewed');
  perform public.add_cook_entry(gen_random_uuid(), a, date '2026-11-10', 5, 'ممتازة');
  perform public.add_cook_entry(gen_random_uuid(), b, date '2026-11-08', null, null);

  p1 := public.save_person(null, 'سارة', 'adult', array['فول سوداني'], null);
  p2 := public.save_person(null, 'أحمد', 'child', array['حليب'], 'ملاحظة');
  m1 := (public.add_planned_meal(sat + 2, lunch, a, null, 4, array[p1, p2])).id;
  m2 := (public.add_planned_meal(sat + 3, dinner, b, null, 3, null)).id;
  perform public.add_planned_meal(sat + 2, lunch, null, 'أرز أبيض', 2, array[p2]);
  perform public.add_planned_meal(sat + 10, dinner, a, null, null, null);
  perform public.update_planned_meal(m1, 6, array[p1], 'cooked');
  perform public.set_slot_food_groups(sat + 2, lunch, array['vegetables'], array['carbs']);
  perform public.save_slot(null, 'تحلية', null);

  t1 := public.save_prep_template(null, a, 'defrost', 'night_before', null, 'أخرجي الدجاج');
  t2 := public.save_prep_template(null, b, 'wash_chop', 'at_time', time '16:30', 'قطّعي الخضار');
  perform public.generate_prep_tasks(sat + 2);
  perform public.set_task_done((select id from public.prep_tasks where planned_meal_id = m1 and template_id = t1), true);
  perform public.update_prep_task((select id from public.prep_tasks where planned_meal_id = m2 and template_id = t2), sat + 3, 'at_time', time '17:00', 'معدّلة');
  perform public.add_prep_task(sat + 2, 'morning', null, 'other', 'مهمة يدوية', m1);
  perform public.add_prep_task(sat + 4, 'morning', null, 'other', 'مهمة بلا وجبة', null);
  perform public.dismiss_prep_task((select id from public.prep_tasks where planned_meal_id = m1 and kind = 'other' limit 1));
  reset role;

  -- a second member's own entries
  perform set_config('request.jwt.claims', json_build_object('sub', viewer_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.add_cook_entry(gen_random_uuid(), a, date '2026-11-09', 3, 'من فرد آخر');
  insert into public.user_favorites (user_id, recipe_id) values (viewer_id, a);
  reset role;
  insert into public.recipe_pages (recipe_id, page_id, notebook_id, section_name, web_url) values (a, 'page-A', 'nb1', 'سلطات', 'https://example.test/x');

  -- ---- the backup ----
  b1 := public.backup_bundle(hh);

  -- the owner's own "download everything" gives the very same data as the nightly backup; others are refused
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  exported := public.export_backup();
  reset role;
  if exported is distinct from b1 then
    raise exception 'FAILED: export_backup() does not give the same data as backup_bundle()';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', viewer_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.export_backup();
    raise exception 'FAILED: a non-owner exported the backup';
  exception when sqlstate '42501' then null;
  end;
  reset role;
  for key in select jsonb_object_keys(b1) loop
    if not (key = any (restored) or key = any (left_out)) then
      raise exception 'FAILED: the backup has a part "%" that the restore test does not know. Cover it in restore_from_backup and add it to this test.', key;
    end if;
  end loop;
  foreach part in array restored loop
    -- a part is a list (or, for plan_settings, one object); it must hold something
    n := case jsonb_typeof(b1 -> part) when 'array' then jsonb_array_length(b1 -> part) when 'object' then 1 else 0 end;
    if n = 0 then
      raise exception 'FAILED: the rehearsal data does not fill the backup part "%" (the test would prove nothing)', part;
    end if;
    log := log || part || '=' || n || ' ';
  end loop;

  file_a := jsonb_build_object('format', 'home-kitchen-backup', 'version', 1, 'created_at', now()) || b1;
  -- as if the file came from a lost project whose owner had another account
  file_b := replace(file_a::text, owner_id::text, old_owner::text)::jsonb;

  -- ---- THE LOSS: everything of the household is gone ----
  delete from public.week_plans where household_id = hh;
  delete from public.meal_slots where household_id = hh;
  delete from public.people where household_id = hh;
  delete from public.plan_settings where household_id = hh;
  delete from public.prep_tasks where household_id = hh;
  delete from public.recipes where household_id = hh;
  b2 := public.backup_bundle(hh);
  foreach part in array restored loop
    n := case jsonb_typeof(b2 -> part) when 'array' then jsonb_array_length(b2 -> part) when 'object' then 1 else 0 end;
    if n <> 0 then
      raise exception 'FAILED: the wipe left something in "%" (so the rehearsal would not prove a rebuild)', part;
    end if;
  end loop;

  -- ---- the restore is refused to a non-owner and for a bad file ----
  perform set_config('request.jwt.claims', json_build_object('sub', viewer_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.restore_from_backup(file_b, true);
    raise exception 'FAILED: a non-owner was allowed to restore';
  exception when sqlstate '42501' then null;
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.restore_from_backup('{"format":"other"}', true);
    raise exception 'FAILED: a file of another format was accepted';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
  end;

  -- ---- a dry run changes nothing ----
  res := public.restore_from_backup(file_b, true);
  select count(*) into n from public.recipes where household_id = hh;
  if n <> 0 then raise exception 'FAILED: the dry run saved % recipes', n; end if;
  if coalesce((res ->> 'recipes_created')::int, 0) < 2 then raise exception 'FAILED: the dry run did not report the recipes it would add: %', res; end if;

  -- ---- the real restore, then again ----
  res := public.restore_from_backup(file_b, false);
  if jsonb_array_length(coalesce(res -> 'errors', '[]'::jsonb)) <> 0 then raise exception 'FAILED: the restore reported errors: %', res; end if;
  res2 := public.restore_from_backup(file_b, false);
  reset role;
  b3 := public.backup_bundle(hh);

  foreach part in array restored loop
    if (b1 -> part) is distinct from (b3 -> part) then
      raise exception 'FAILED: part "%" is not identical after the restore. before: % | after: %', part, left((b1 -> part)::text, 600), left((b3 -> part)::text, 600);
    end if;
  end loop;
  -- repeating the restore adds nothing
  for key in select jsonb_object_keys(res2) loop
    if key ~ '(_created|_added)$' and (res2 ->> key)::int <> 0 then
      raise exception 'FAILED: restoring the same file again added something (%): %', key, res2;
    end if;
  end loop;

  -- ---- a recipe edited after the restore is never overwritten by restoring again ----
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.save_recipe(public.recipe_doc(a) || '{"title":"عدّلتها بعد الاستعادة"}', null, 'app');
  perform public.restore_from_backup(file_a, false);
  if (select title from public.recipes where id = a) <> 'عدّلتها بعد الاستعادة' then
    raise exception 'FAILED: a restore overwrote a recipe that had been edited';
  end if;
  reset role;

  log := 'parts restored identically: ' || log;
  raise notice 'RESTORE REHEARSAL PASSED: %', log;
end $t$;
