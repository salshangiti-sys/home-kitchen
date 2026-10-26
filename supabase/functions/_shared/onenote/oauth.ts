// Microsoft sign-in for personal accounts (the "consumers" authority), authorization code flow
// with PKCE, run from the server as a confidential client so refresh tokens last 90 days and
// renew on every use. Web Crypto only, so it runs the same in Deno and in Node tests.

import { ReconnectRequiredError } from './errors.ts'

export const AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0'
export const SCOPES = ['offline_access', 'User.Read', 'Notes.ReadWrite', 'Files.ReadWrite.AppFolder']

export interface OAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export interface TokenSet {
  accessToken: string
  refreshToken: string
  expiresIn: number
  scope: string
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function randomToken(byteLength = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)))
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

export function authorizeUrl(config: Pick<OAuthConfig, 'clientId' | 'redirectUri'>, state: string, challenge: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    // The code comes back in a POST body, not the URL, so it never lands in request logs.
    response_mode: 'form_post',
    scope: SCOPES.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  })
  return `${AUTHORITY}/authorize?${params}`
}

async function tokenRequest(config: OAuthConfig, grant: Record<string, string>, fetchImpl: typeof fetch): Promise<TokenSet> {
  const response = await fetchImpl(`${AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      scope: SCOPES.join(' '),
      ...grant,
    }),
  })
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    const code = String(body.error ?? response.status)
    // invalid_grant: the refresh token expired or was revoked; only signing in again fixes it.
    if (code === 'invalid_grant' || code === 'interaction_required') {
      throw new ReconnectRequiredError(`Microsoft sign-in is needed again (${code})`)
    }
    throw new Error(`Microsoft token request failed: ${code}`)
  }
  return {
    accessToken: String(body.access_token),
    refreshToken: String(body.refresh_token),
    expiresIn: Number(body.expires_in ?? 3600),
    scope: String(body.scope ?? ''),
  }
}

export function exchangeCode(config: OAuthConfig, code: string, verifier: string, fetchImpl: typeof fetch = fetch) {
  return tokenRequest(config, { grant_type: 'authorization_code', code, code_verifier: verifier }, fetchImpl)
}

export function refreshTokens(config: OAuthConfig, refreshToken: string, fetchImpl: typeof fetch = fetch) {
  return tokenRequest(config, { grant_type: 'refresh_token', refresh_token: refreshToken }, fetchImpl)
}
