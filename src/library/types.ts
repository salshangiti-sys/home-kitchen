// Recipe types (shared with the server functions) and their Arabic labels.

import type { MealType, RecipeStatus } from '../../supabase/functions/_shared/onenote/recipeDoc.ts'

export * from '../../supabase/functions/_shared/onenote/recipeDoc.ts'

export const STATUS_LABELS: Record<RecipeStatus, string> = {
  complete: 'كاملة',
  partial: 'ناقصة',
  link_only: 'رابط فقط',
  note_only: 'ملاحظة',
}

export const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: 'فطور',
  lunch: 'غداء',
  dinner: 'عشاء',
  snack: 'سناك',
  dessert: 'حلى',
  drink: 'مشروب',
  side: 'طبق جانبي',
}
