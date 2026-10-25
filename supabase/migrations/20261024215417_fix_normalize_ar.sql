-- Fix normalize_ar: ة and ى were mapped the wrong way round (ة→ي, ى→ه). The right mapping is
-- ة→ه and ى→ي. Stored search text is recomputed from each recipe's own text.

create or replace function public.normalize_ar(input text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(regexp_replace(
    lower(translate(
      regexp_replace(coalesce(input, ''), '[ً-ٰٟـ‌-‏‪-‮⁦-⁩]', '', 'g'),
      'أإآٱةى٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
      'ااااهي01234567890123456789'
    )),
    '\s+', ' ', 'g'
  ));
$$;

update public.recipes r set search_norm = public.normalize_ar(concat_ws(' ',
  r.title, r.section, r.section_en,
  (select string_agg(i.text, ' ') from public.recipe_ingredients i where i.recipe_id = r.id),
  (select string_agg(g.name, ' ') from public.ingredient_groups g where g.recipe_id = r.id),
  (select string_agg(st.text, ' ') from public.recipe_steps st where st.recipe_id = r.id),
  (select string_agg(n.text, ' ') from public.recipe_notes n where n.recipe_id = r.id),
  array_to_string(r.custom_tags, ' ')
));
