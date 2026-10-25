-- New recipes in a section without an English name got an id like "001" instead of
-- "recipe-001": save_recipe passed an empty prefix. The id helper now falls back to "recipe".

create or replace function private.next_recipe_id(prefix text)
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  with p as (select coalesce(nullif(btrim(prefix, '-'), ''), 'recipe') as prefix)
  select p.prefix || '-' || lpad((coalesce(max(substring(r.id from '-(\d+)$')::integer), 0) + 1)::text, 3, '0')
  from p left join public.recipes r on r.id ~ ('^' || p.prefix || '-\d+$')
  group by p.prefix;
$$;
