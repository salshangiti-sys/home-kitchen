// Request helpers shared by the Edge Functions (Deno only).

import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY')!

// Origins the app runs on. The OAuth flow only returns to these, and CORS only allows these.
export const APP_ORIGINS = (Deno.env.get('APP_ORIGINS') ?? 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
export const APP_URL = Deno.env.get('APP_URL') ?? APP_ORIGINS[0]

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string = 'error',
  ) {
    super(message)
  }
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  return {
    'Access-Control-Allow-Origin': APP_ORIGINS.includes(origin) ? origin : APP_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json; charset=utf-8' },
  })
}

export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function requireUser(req: Request): Promise<{ user: User; userClient: SupabaseClient }> {
  const authorization = req.headers.get('Authorization')
  if (!authorization) throw new HttpError(401, 'sign in required', 'unauthenticated')
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await userClient.auth.getUser()
  if (error || !data.user) throw new HttpError(401, 'sign in required', 'unauthenticated')
  return { user: data.user, userClient }
}

export function oauthConfig() {
  return {
    clientId: Deno.env.get('MS_CLIENT_ID') ?? 'f891e6b1-97d8-4453-a7ec-e98d2c25de42',
    clientSecret: Deno.env.get('MS_CLIENT_SECRET') ?? '',
    redirectUri: `${SUPABASE_URL}/functions/v1/ms-oauth-callback`,
  }
}
