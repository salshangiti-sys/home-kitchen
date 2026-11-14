-- Links recipes to their OneNote pages by TITLE, using the pages the app has already listed
-- (onenote_unlinked_pages, filled by the notebook check). Owners and editors only.
--
-- Why not by page_id: the page ids in recipes.json come from another tool and are not the ids the
-- OneNote API gives (they never match), so the old "link imported recipes by page_id" would have
-- marked every recipe's page as missing.
--
-- A recipe and a page are linked only when they are the ONLY ones with that title (after the
-- Arabic normalising of the search: no diacritics, أ/إ/آ = ا, ة = ه, ى = ي, spaces collapsed).
-- Titles shared by several recipes or several pages are listed for a person to link by hand.
-- Nothing is guessed, and a dry run changes nothing. Trashed recipes and recipes that already have a
-- page are left out. The text of a recipe is not touched: it is read from the page when the recipe is
-- opened, as for every linked recipe.

create function public.link_pages_by_title(p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  hh uuid;
  nb text;
  pairs jsonb;
  n_pages int;
  n_recipes int;
  ambiguous jsonb;
begin
  select m.household_id into hh
  from public.household_members m
  where m.user_id = (select auth.uid()) and m.role in ('owner', 'editor')
  order by m.created_at
  limit 1;
  if hh is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select l.notebook_id into nb
  from public.onenote_library l
  where l.household_id = hh
  limit 1;
  if nb is null then
    raise exception 'no_library';
  end if;

  with pages_k as (
    select u.page_id, u.title, u.section_id, u.section_name, u.web_url,
           regexp_replace(public.normalize_ar(btrim(u.title)), '\s+', ' ', 'g') as k
    from public.onenote_unlinked_pages u
    where u.household_id = hh
  ), recipes_k as (
    select r.id, r.title,
           regexp_replace(public.normalize_ar(btrim(r.title)), '\s+', ' ', 'g') as k
    from public.recipes r
    where r.household_id = hh
      and r.deleted_at is null
      and not exists (select 1 from public.recipe_pages rp where rp.recipe_id = r.id)
  ), matched as (
    select r.id as recipe_id, r.title as recipe_title, p.page_id, p.title as page_title, p.section_id, p.section_name, p.web_url
    from recipes_k r
    join pages_k p on p.k = r.k
    where r.k <> ''
      and (select count(*) from recipes_k x where x.k = r.k) = 1
      and (select count(*) from pages_k x where x.k = p.k) = 1
  )
  select
    coalesce((select jsonb_agg(to_jsonb(matched) order by matched.section_name, matched.page_title) from matched), '[]'::jsonb),
    (select count(*) from pages_k p where not exists (select 1 from matched x where x.page_id = p.page_id)),
    (select count(*) from recipes_k r where not exists (select 1 from matched x where x.recipe_id = r.id)),
    -- titles that more than one recipe or more than one page share
    coalesce((
      select jsonb_agg(t order by t) from (
        select min(a.title) as t
        from (select k, title from recipes_k union all select k, title from pages_k) a
        where a.k <> ''
        group by a.k
        having (select count(*) from recipes_k x where x.k = a.k) > 1
            or (select count(*) from pages_k x where x.k = a.k) > 1
      ) s
    ), '[]'::jsonb)
  into pairs, n_pages, n_recipes, ambiguous;

  if not p_dry_run then
    insert into public.recipe_pages (recipe_id, page_id, notebook_id, section_id, section_name, page_title, web_url, client_url, created_by_app, read_status, last_read_at, last_error)
    select x.recipe_id, x.page_id, nb, x.section_id, x.section_name, x.page_title, x.web_url, null, false, 'ok', null, null
    from jsonb_to_recordset(pairs) as x(recipe_id text, page_id text, section_id text, section_name text, page_title text, web_url text);
    delete from public.onenote_unlinked_pages u
    where u.household_id = hh
      and u.page_id in (select x.page_id from jsonb_to_recordset(pairs) as x(page_id text));
  end if;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'linked', jsonb_array_length(pairs),
    'pairs', pairs,
    'pages_without_recipe', n_pages,
    'recipes_without_page', n_recipes,
    'ambiguous_titles', ambiguous
  );
end;
$$;

revoke all on function public.link_pages_by_title(boolean) from public, anon;
grant execute on function public.link_pages_by_title(boolean) to authenticated;
