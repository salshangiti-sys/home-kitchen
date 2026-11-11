// Checks one recipe against schema/recipe.schema.json (draft 2020-12), as the app's own import
// does. The validator class is passed in because Deno and Node load Ajv differently.

import { recipeSchema } from './recipeSchema.ts'
import type { RecipeCheck } from './backup.ts'

interface Validate {
  (value: unknown): boolean
  errors?: Array<{ instancePath?: string; message?: string; keyword: string }> | null
}

export function recipeChecker(Ajv: new (options: object) => { compile(schema: object): Validate }): RecipeCheck {
  const validate = new Ajv({ allErrors: true, strict: false }).compile(recipeSchema)
  return (doc) => (validate(doc) ? [] : (validate.errors ?? []).map((error) => `${error.instancePath || '/'}: ${error.message ?? error.keyword}`))
}
