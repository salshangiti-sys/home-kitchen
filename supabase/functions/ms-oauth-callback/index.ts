// Microsoft sends the browser here after sign-in. Deployed without JWT verification because the
// browser arrives from Microsoft; the one-time state from ms-oauth-start identifies the user instead.
// The code arrives as a form POST (response_mode=form_post), so it is never part of a logged URL.
// Exchanges the code, keeps the refresh token in Vault, and sends the browser back to the app.

import { APP_ORIGINS, adminClient, oauthConfig } from '../_shared/server/http.ts'
import { exchangeCode } from '../_shared/onenote/oauth.ts'

function back(returnTo: string, result: string): Response {
  const url = new URL(returnTo)
  url.searchParams.set('ms', result)
  // 303: after a POST, the browser follows with a GET.
  return Response.redirect(url.toString(), 303)
}

// The response fields from Microsoft: in the POST body (form_post), or in the query string for a
// request started before the switch to form_post.
async function responseParams(req: Request): Promise<URLSearchParams> {
  if (req.method !== 'POST') return new URL(req.url).searchParams
  const form = await req.formData()
  return new URLSearchParams([...form.entries()].map(([key, value]) => [key, String(value)]))
}

Deno.serve(async (req) => {
  const params = await responseParams(req)
  const state = params.get('state') ?? ''
  const admin = adminClient()

  const { data: saved } = await admin.from('oauth_states').select('user_id,code_verifier,return_to,expires_at').eq('state', state).maybeSingle()
  // The state is single-use whatever happens next.
  if (saved) await admin.from('oauth_states').delete().eq('state', state)
  if (!saved || new Date(saved.expires_at).getTime() < Date.now()) return back(APP_ORIGINS[0], 'expired')
  if (params.get('error')) return back(saved.return_to, 'cancelled')

  try {
    const config = oauthConfig()
    const tokens = await exchangeCode(config, params.get('code') ?? '', saved.code_verifier)

    const me = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,displayName', {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    }).then((r) => (r.ok ? r.json() : { id: null, displayName: null }))

    const { error: upsertError } = await admin.from('ms_connections').upsert(
      {
        user_id: saved.user_id,
        ms_user_id: me.id,
        display_name: me.displayName,
        scopes: tokens.scope,
        status: 'connected',
        last_error: null,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
    if (upsertError) throw new Error(upsertError.message)

    const { error: storeError } = await admin.rpc('ms_store_refresh_token', { p_user_id: saved.user_id, p_token: tokens.refreshToken })
    if (storeError) throw new Error(storeError.message)

    return back(saved.return_to, 'connected')
  } catch (error) {
    console.error('ms-oauth-callback failed', (error as Error).message)
    return back(saved.return_to, 'error')
  }
})
