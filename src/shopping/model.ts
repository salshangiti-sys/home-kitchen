// The shopping list of a plan week, worked out (pure, tested) from the meals in the plan, the ingredient
// lines of their recipes, and what the person has marked: bought / "I have it" / added by hand / kept at
// home for every week.
//
// The list is always worked out again from the plan, so changing the plan never loses a tick: marks are
// kept by the item's NAME (see catalog.ts), not by the recipe line. The lines are never changed, and no
// quantities are added together here: each item shows the lines it came from, exactly as written.
// (Adding quantities waits for the person to confirm them, see docs/06-phase2-plan.md.)

import { normalizeAr } from '../library/normalize'
import type { Op } from '../offline/outbox'
import { AISLE_LABELS, AISLE_ORDER, type Aisle } from './dictionary'
import { identify, identifyAll } from './catalog'
import { sumQuantities, type Quantity, type Unit } from './quantity'

export type MarkStatus = 'needed' | 'have' | 'bought'

export interface Mark {
  key: string
  label: string | null
  status: MarkStatus
  is_manual: boolean
}

export interface PantryItem {
  key: string
  label: string
}

export interface MealIn {
  recipe_id: string | null
  title: string
  status: 'planned' | 'cooked' | 'skipped'
}

export interface RecipeLines {
  title: string
  lines: string[]
}

export interface Source {
  line: string
  recipe: string
}

// A confirmed quantity of one recipe line, for the shopping item it counts for.
export interface Confirmation {
  recipe_id: string
  line: string
  item_key: string
  quantity: number
  unit: Unit
}

// One line an item came from. `read` is what the parser read from it (a suggestion, never added up);
// `confirmed` is what the person confirmed (the only thing that is added up). `times` is how many
// planned meals use the recipe this week (a recipe cooked twice needs its lines twice).
export interface ItemSource extends Source {
  recipeId: string
  times: number
  read: Quantity | null
  confirmed: Quantity | null
}

export interface Item {
  key: string
  label: string
  aisle: Aisle
  sources: ItemSource[]
  totals: Quantity[] // the confirmed quantities added up (by compatible unit); empty when none is confirmed
  unconfirmed: number // lines of this item whose quantity is not confirmed (shown as written)
  status: MarkStatus
  pantry: boolean // kept at home for every week
  manual: boolean // added by hand
}

export interface AisleGroup {
  aisle: Exclude<Aisle, 'none'>
  label: string
  items: Item[]
}

export interface ShoppingList {
  toBuy: AisleGroup[]
  done: Item[] // bought, or already at home
  sentences: Source[] // lines that read like a method sentence, not an ingredient (shown apart)
  noIngredients: string[] // planned recipes with no ingredient lines yet
  freeText: string[] // meals written as text, with no recipe
  pantryAll: PantryItem[] // everything kept at home, in the week's items or not
  meals: number
}

// What is cooked this week: planned meals only (a cooked meal was shopped for, a skipped one is not made).
export const isCounted = (meal: MealIn) => meal.status === 'planned'

// The recipes of the counted meals, each once (the ones whose ingredient lines the list needs).
export function plannedRecipes(meals: MealIn[]): Array<{ id: string; title: string }> {
  const seen = new Map<string, string>()
  for (const meal of meals) if (isCounted(meal) && meal.recipe_id && !seen.has(meal.recipe_id)) seen.set(meal.recipe_id, meal.title)
  return [...seen].map(([id, title]) => ({ id, title }))
}

const byName = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, 'ar')

// The key a hand-written item is kept under: the same one an ingredient line of that name gets.
export const keyOf = (label: string) => identify(label).key || normalizeAr(label)

export function buildShoppingList(input: { meals: MealIn[]; recipes: Record<string, RecipeLines>; marks: Mark[]; pantry: PantryItem[]; confirmations?: Confirmation[] }): ShoppingList {
  const confirmed = new Map((input.confirmations ?? []).map((c) => [`${c.recipe_id}\u0000${c.line}\u0000${c.item_key}`, c]))
  const times = new Map<string, number>()
  const marks = new Map(input.marks.map((m) => [m.key, m]))
  const pantryKeys = new Set(input.pantry.map((p) => p.key))
  const counted = input.meals.filter(isCounted)
  for (const meal of counted) if (meal.recipe_id) times.set(meal.recipe_id, (times.get(meal.recipe_id) ?? 0) + 1)

  const items = new Map<string, Item>()
  const sentences: Source[] = []
  const noIngredients: string[] = []
  const freeText: string[] = []
  const seenRecipes = new Set<string>()

  for (const meal of counted) {
    if (!meal.recipe_id) {
      freeText.push(meal.title)
      continue
    }
    if (seenRecipes.has(meal.recipe_id)) continue // the same recipe twice in a week: its lines once
    seenRecipes.add(meal.recipe_id)
    const recipe = input.recipes[meal.recipe_id]
    const lines = recipe?.lines.map((l) => l.trim()).filter(Boolean) ?? []
    if (lines.length === 0) {
      noIngredients.push(meal.title)
      continue
    }
    for (const line of lines) {
      const found = identifyAll(line)
      if (found.length === 1 && found[0].sentence) {
        sentences.push({ line, recipe: meal.title })
        continue
      }
      for (const id of found) {
        if (id.aisle === 'none' || !id.key) continue // water and the like: not bought
        const item = items.get(id.key) ?? { key: id.key, label: id.label, aisle: id.aisle, sources: [], totals: [], unconfirmed: 0, status: 'needed' as MarkStatus, pantry: false, manual: false }
        const sure = confirmed.get(`${meal.recipe_id}\u0000${line}\u0000${id.key}`)
        item.sources.push({
          line,
          recipe: meal.title,
          recipeId: meal.recipe_id,
          times: times.get(meal.recipe_id) ?? 1,
          read: id.parsed.quantity !== null ? { quantity: id.parsed.quantity, unit: id.parsed.unit } : null,
          confirmed: sure ? { quantity: Number(sure.quantity), unit: sure.unit } : null,
        })
        items.set(id.key, item)
      }
    }
  }

  // items written by hand (they may also be in the recipes: then it is one item)
  for (const mark of input.marks) {
    if (!mark.is_manual) continue
    const existing = items.get(mark.key)
    if (existing) existing.manual = true
    else items.set(mark.key, { key: mark.key, label: mark.label ?? mark.key, aisle: identify(mark.label ?? mark.key).aisle, sources: [], totals: [], unconfirmed: 0, status: 'needed', pantry: false, manual: true })
  }

  for (const item of items.values()) {
    item.totals = sumQuantities(item.sources.flatMap((s) => (s.confirmed ? [{ quantity: s.confirmed.quantity * s.times, unit: s.confirmed.unit }] : [])))
    item.unconfirmed = item.sources.filter((s) => !s.confirmed).length
    const mark = marks.get(item.key)
    item.pantry = pantryKeys.has(item.key)
    item.status = mark ? mark.status : item.pantry ? 'have' : 'needed'
  }

  const all = [...items.values()].filter((item) => item.aisle !== 'none')
  const toBuy: AisleGroup[] = AISLE_ORDER.map((aisle) => ({ aisle, label: AISLE_LABELS[aisle], items: all.filter((i) => i.status === 'needed' && i.aisle === aisle).sort(byName) })).filter((g) => g.items.length > 0)

  return {
    toBuy,
    done: all.filter((i) => i.status !== 'needed').sort((a, b) => Number(a.status === 'bought') - Number(b.status === 'bought') || byName(a, b)),
    sentences,
    noIngredients,
    freeText,
    pantryAll: [...input.pantry].sort(byName),
    meals: counted.length,
  }
}

// ---- changes waiting in the outbox (made with no connection) ----

export const MARK_KIND = 'shopping_mark'
export const ADD_KIND = 'shopping_add'
export const CLEAR_KIND = 'shopping_clear'
export const PANTRY_KIND = 'shopping_pantry'

// One waiting change per item and week (the last one wins).
export const markKey = (week: string, key: string) => `shopping:${week}:${key}`
export const pantryKey = (key: string) => `shopping-pantry:${key}`

// The marks and the pantry as the person last left them on this device: changes that have not reached
// the server yet are put on top of what was read. `waiting` holds the item keys that still wait.
export function overlayMarks(marks: Mark[], pantry: PantryItem[], ops: Op[], week: string): { marks: Mark[]; pantry: PantryItem[]; waiting: Set<string> } {
  const byKey = new Map(marks.map((m) => [m.key, m]))
  const home = new Map(pantry.map((p) => [p.key, p]))
  const waiting = new Set<string>()
  for (const op of ops) {
    const key = String(op.args.key ?? '')
    if (op.kind === PANTRY_KIND) {
      if (op.args.on === true) home.set(key, { key, label: String(op.args.label ?? key) })
      else home.delete(key)
      waiting.add(key)
      continue
    }
    if (op.args.week !== week) continue
    if (op.kind === MARK_KIND) {
      const old = byKey.get(key)
      byKey.set(key, { key, label: old?.label ?? null, is_manual: old?.is_manual ?? false, status: op.args.status as MarkStatus })
      waiting.add(key)
    } else if (op.kind === ADD_KIND) {
      byKey.set(key, { key, label: String(op.args.label ?? key), is_manual: true, status: 'needed' })
      waiting.add(key)
    } else if (op.kind === CLEAR_KIND) {
      byKey.delete(key)
      waiting.add(key)
    }
  }
  return { marks: [...byKey.values()], pantry: [...home.values()], waiting }
}

// ---- confirmed quantities waiting in the outbox ----

export const CONFIRM_KIND = 'quantity_confirm'
export const UNCONFIRM_KIND = 'quantity_unconfirm'
export const confirmKey = (recipe: string, line: string, item: string) => `qty:${recipe}\u0000${line}\u0000${item}`

// The confirmations as the person last left them on this device (waiting changes on top of what was read).
export function overlayConfirmations(confirmations: Confirmation[], ops: Op[]): { confirmations: Confirmation[]; waiting: Set<string> } {
  const byKey = new Map(confirmations.map((c) => [`${c.recipe_id}\u0000${c.line}\u0000${c.item_key}`, c]))
  const waiting = new Set<string>()
  for (const op of ops) {
    if (op.kind !== CONFIRM_KIND && op.kind !== UNCONFIRM_KIND) continue
    const recipe = String(op.args.recipe ?? '')
    const line = String(op.args.line ?? '')
    const item = String(op.args.key ?? '')
    const key = `${recipe}\u0000${line}\u0000${item}`
    if (op.kind === CONFIRM_KIND) byKey.set(key, { recipe_id: recipe, line, item_key: item, quantity: Number(op.args.quantity), unit: (op.args.unit as Unit) ?? null })
    else byKey.delete(key)
    waiting.add(key)
  }
  return { confirmations: [...byKey.values()], waiting }
}
