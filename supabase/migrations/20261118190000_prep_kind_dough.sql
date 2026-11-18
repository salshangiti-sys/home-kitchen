-- A new kind of prep task: «العجينة» (dough). The two tables that hold a kind and the two functions that
-- check one learn the new value; nothing else changes.

alter table public.recipe_prep_templates drop constraint recipe_prep_templates_kind_check;
alter table public.recipe_prep_templates add constraint recipe_prep_templates_kind_check
  check (kind in ('defrost', 'wash_chop', 'marinade', 'dough', 'sauce', 'garnish', 'other'));

alter table public.prep_tasks drop constraint prep_tasks_kind_check;
alter table public.prep_tasks add constraint prep_tasks_kind_check
  check (kind in ('defrost', 'wash_chop', 'marinade', 'dough', 'sauce', 'garnish', 'other'));

-- save_prep_template and add_prep_task check the kind in their first lines: the same functions, with the
-- new value in that list (their definitions are read, edited and run again, so nothing else is retyped).
do $$
declare
  def text;
begin
  for def in
    select pg_get_functiondef(p.oid)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('save_prep_template', 'add_prep_task')
  loop
    execute replace(def, '''garnish'', ''other''', '''garnish'', ''dough'', ''other''');
  end loop;
end $$;
