// Writes a recipe's starting tags, food groups and prep tasks (see autofill.ts) through the same
// database functions the app's own screens use, so the same rules and history apply.

import { loadRecipe } from '../library/api'
import { bulkTag } from '../library/bulkTag'
import { setFoodGroups } from '../nutrition/api'
import { saveTemplate } from '../prep/api'
import { usableIngredients } from '../ingredients/api'
import { autofillFor, type Autofill } from './autofill'

export interface ApplyDeps {
  loadRecipe: typeof loadRecipe
  bulkTag: typeof bulkTag
  setFoodGroups: typeof setFoodGroups
  saveTemplate: typeof saveTemplate
}
const real: ApplyDeps = { loadRecipe, bulkTag, setFoodGroups, saveTemplate }

// What was written, or null when the recipe could not be read.
export async function autofillRecipe(recipeId: string, deps: ApplyDeps = real): Promise<Autofill | null> {
  const loaded = await deps.loadRecipe(recipeId)
  if (!loaded) return null
  const { doc } = loaded
  const lines = usableIngredients(doc.ingredient_groups.flatMap((g) => g.items.map((i) => i.text)), []).lines
  const text = [...doc.steps.map((s) => s.text), ...doc.notes].join('\n')
  const fill = autofillFor({ title: doc.title, lines, text })
  if (fill.tags.length) await deps.bulkTag([recipeId], { custom: { add: fill.tags.slice(0, 10) } }, false)
  if (fill.groups.length) await deps.setFoodGroups(recipeId, fill.groups)
  for (const task of fill.prep) await deps.saveTemplate(null, recipeId, task)
  return fill
}
