// One recipe in the shape of schema/recipe.schema.json. The import, the editor, the database
// functions (recipe_doc / save_recipe), the OneNote reader and the export all use this shape.

export type RecipeStatus = 'complete' | 'partial' | 'link_only' | 'note_only'
export type Platform = 'tiktok' | 'youtube' | 'instagram' | 'snapchat' | 'web' | 'other'

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'dessert', 'drink', 'side'] as const
export type MealType = (typeof MEAL_TYPES)[number]

export interface IngredientItem {
  text: string
  quantity?: number | null
  unit?: string | null
  item?: string | null
  note?: string | null
}

export interface IngredientGroup {
  name: string | null
  items: IngredientItem[]
}

export interface RecipeDoc {
  id: string
  title: string
  language?: string
  status: RecipeStatus
  category: { notebook?: string; section_group?: string | null; section: string; section_en?: string | null }
  sources: Array<{ url: string; platform?: Platform; label?: string | null }>
  ingredient_groups: IngredientGroup[]
  steps: Array<{ order: number; text: string }>
  notes: string[]
  tags?: { meal_types?: MealType[]; kid_friendly?: boolean | null; lunchbox?: boolean | null; custom?: string[] }
  servings?: number | null
  prep_time_min?: number | null
  cook_time_min?: number | null
  media?: Array<{ type?: 'image' | 'video_embed' | 'file'; description?: string | null }>
  onenote: { notebook?: string; section?: string; page_id?: string | null; created?: string | null }
  flags?: string[]
  raw_text: string
}

// The link's platform, from its address.
export function platformOf(url: string): Platform {
  let host = ''
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return 'other'
  }
  if (host.includes('tiktok')) return 'tiktok'
  if (host.includes('youtube') || host === 'youtu.be') return 'youtube'
  if (host.includes('instagram')) return 'instagram'
  if (host.includes('snapchat')) return 'snapchat'
  return 'web'
}
