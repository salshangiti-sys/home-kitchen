// Checks a recipe against schema/recipe.schema.json (draft 2020-12), the contract shared by the
// OneNote export, the import, the editor and the app's own export.

import Ajv2020 from 'ajv/dist/2020'
import schema from '../../schema/recipe.schema.json'
import type { RecipeDoc } from './types'

const ajv = new Ajv2020({ allErrors: true, strict: false })
const check = ajv.compile<RecipeDoc>(schema)

export function isRecipeDoc(value: unknown): value is RecipeDoc {
  return check(value)
}

// Readable problems for one record, e.g. "/steps/0/order: must be integer".
export function recipeErrors(value: unknown): string[] {
  if (check(value)) return []
  return (check.errors ?? []).map((error) => {
    const extra = error.keyword === 'additionalProperties' ? ` (${String(error.params.additionalProperty)})` : ''
    const allowed = error.keyword === 'enum' ? ` (${(error.params.allowedValues as unknown[]).join(', ')})` : ''
    return `${error.instancePath || '/'}: ${error.message ?? error.keyword}${extra}${allowed}`
  })
}
