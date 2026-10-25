// Starts connecting the signed-in user's Microsoft account: saves a one-time state with a PKCE
// verifier and returns the Microsoft sign-in URL for the app to open.

import { APP_ORIGINS, HttpError, adminClient, corsHeaders, json, oauthConfig, requireUser } from '../_shared/server/http.ts'
import { authorizeUrl, pkceChallenge, randomToken } from '../_shared/onenote/oauth.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(req) })
  try {
    const { user } = await requireUser(req)
    const { returnTo } = (await req.json().catch(() => ({}))) as { returnTo?: string }
    const target = returnTo && APP_ORIGINS.some((origin) => returnTo === origin || returnTo.startsWith(`${origin}/`)) ? returnTo : APP_ORIGINS[0]

    const state = randomToken()
    const verifier = randomToken(48)
    const { error } = await adminClient()
      .from('oauth_states')
      .insert({ state, user_id: user.id, code_verifier: verifier, return_to: target, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() })
    if (error) throw new Error(`could not start sign-in: ${error.message}`)

    return json(req, { url: authorizeUrl(oauthConfig(), state, await pkceChallenge(verifier)) })
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    return json(req, { error: (error as Error).message }, status)
  }
})
