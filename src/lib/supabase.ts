import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

if (!url || !key) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set (see .env.example)')
}

export const supabase = createClient(url, key)

export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    // An HTTP error carries the function's { error, code } body as a Response; a network failure
    // carries the underlying fetch error instead, so only read a body when there is one.
    const context = (error as { context?: unknown }).context
    const detail = context instanceof Response ? await context.json().catch(() => null) : null
    const cause = context instanceof Error ? ` (${context.message})` : ''
    throw Object.assign(new Error(detail?.error ?? `${error.message}${cause}`), { code: detail?.code as string | undefined })
  }
  return data as T
}
