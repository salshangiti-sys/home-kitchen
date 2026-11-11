// Cooking progress: which step you are on, which ingredients you have ticked off, and the text
// size. Kept on the device so a reload or a phone call does not lose your place. Storage can be
// unavailable (private browsing), so every read and write is allowed to fail.

export const SIZES = ['text-2xl', 'text-3xl', 'text-4xl', 'text-5xl'] as const
export const DEFAULT_SIZE = 1

export const clampSize = (size: number) => Math.min(SIZES.length - 1, Math.max(0, Math.round(size)))
export const clampStep = (step: number, count: number) => (Number.isFinite(step) ? Math.min(Math.max(0, count - 1), Math.max(0, Math.round(step))) : 0)

export type CookView = 'ingredients' | 'steps' | 'notes'

export interface Progress {
  step: number
  checked: string[] // "group:item" of ticked ingredients
  view: CookView
}

const progressKey = (recipeId: string) => `hk-cook:${recipeId}`
const SIZE_KEY = 'hk-cook-size'

export const ingredientKey = (group: number, item: number) => `${group}:${item}`

export function loadProgress(recipeId: string, steps: number): Progress | null {
  try {
    const raw = localStorage.getItem(progressKey(recipeId))
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<Progress>
    const view: CookView = value.view === 'ingredients' || value.view === 'notes' ? value.view : 'steps'
    return {
      step: clampStep(Number(value.step ?? 0), steps),
      checked: Array.isArray(value.checked) ? value.checked.filter((k): k is string => typeof k === 'string') : [],
      view,
    }
  } catch {
    return null
  }
}

export function saveProgress(recipeId: string, progress: Progress): void {
  try {
    localStorage.setItem(progressKey(recipeId), JSON.stringify(progress))
  } catch {
    // progress is kept for this visit only
  }
}

export function clearProgress(recipeId: string): void {
  try {
    localStorage.removeItem(progressKey(recipeId))
  } catch {
    // nothing to clear
  }
}

export function loadSize(): number {
  try {
    const value = localStorage.getItem(SIZE_KEY)
    return value === null ? DEFAULT_SIZE : clampSize(Number(value))
  } catch {
    return DEFAULT_SIZE
  }
}

export function saveSize(size: number): void {
  try {
    localStorage.setItem(SIZE_KEY, String(clampSize(size)))
  } catch {
    // the size still applies for this visit
  }
}
