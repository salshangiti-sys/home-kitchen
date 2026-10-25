// Recipes for tests, shaped like records from the OneNote export.

import type { RecipeDoc } from './types'

export const SALAD: RecipeDoc = {
  id: 'salads-007',
  title: 'سلطة خضراء',
  language: 'ar',
  status: 'complete',
  category: { notebook: 'وصفات', section_group: null, section: 'سلطات', section_en: 'Salads' },
  sources: [{ url: 'https://www.tiktok.com/@cook/video/123', platform: 'tiktok', label: 'فيديو تيك توك' }],
  ingredient_groups: [
    { name: null, items: [{ text: '2 كوب mixed leaves', quantity: 2, unit: 'كوب', item: 'mixed leaves', note: null }, { text: 'خيار مقطع' }] },
    { name: 'الصوص', items: [{ text: 'ليمون' }, { text: 'زيت زيتون' }] },
  ],
  steps: [
    { order: 1, text: 'نغسل الخضار' },
    { order: 2, text: 'نخلط الصوص ونصبه' },
  ],
  notes: ['أزيد الليمون شوي'],
  tags: { meal_types: [], kid_friendly: null, lunchbox: null, custom: [] },
  servings: null,
  prep_time_min: null,
  cook_time_min: null,
  media: [{ type: 'image', description: null }],
  onenote: { notebook: 'وصفات', section: 'سلطات', page_id: '0-abc!1-XYZ', created: '2024-03-01T10:00:00+03:00' },
  flags: ['quantities_missing'],
  raw_text: 'سلطة خضراء\nالمصدر\nفيديو تيك توك\nالمقادير\n2 كوب mixed leaves\n...',
}

export const LINK_ONLY: RecipeDoc = {
  id: 'desserts-002',
  title: 'تشيز كيك',
  status: 'link_only',
  category: { section: 'حلويات' },
  sources: [{ url: 'https://youtu.be/abc' }],
  ingredient_groups: [],
  steps: [],
  notes: [],
  onenote: { notebook: 'وصفات', section: 'حلويات', page_id: null },
  flags: ['possible_duplicate:desserts-009'],
  raw_text: 'https://youtu.be/abc',
}
