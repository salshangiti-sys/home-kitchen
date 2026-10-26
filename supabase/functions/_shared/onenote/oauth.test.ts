import { describe, expect, it, vi } from 'vitest'
import { ReconnectRequiredError } from './engine.ts'
import { authorizeUrl, exchangeCode, pkceChallenge, refreshTokens } from './oauth.ts'

const CONFIG = { clientId: 'client-1', clientSecret: 'not-a-real-secret', redirectUri: 'https://x.supabase.co/functions/v1/ms-oauth-callback' }

describe('Microsoft OAuth helpers', () => {
  it('computes the RFC 7636 example PKCE challenge', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('builds an authorize URL for personal accounts with PKCE and offline access', () => {
    const url = new URL(authorizeUrl(CONFIG, 'state-1', 'challenge-1'))
    expect(url.origin + url.pathname).toBe('https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toBe('offline_access User.Read Notes.ReadWrite Files.ReadWrite.AppFolder')
    expect(url.searchParams.get('redirect_uri')).toBe(CONFIG.redirectUri)
    expect(url.searchParams.get('response_mode')).toBe('form_post')
  })

  it('exchanges a code and returns the new tokens', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 3599, scope: 'Notes.ReadWrite' }), { status: 200 }),
    )
    const tokens = await exchangeCode(CONFIG, 'code-1', 'verifier-1', fetchMock as unknown as typeof fetch)
    expect(tokens).toEqual({ accessToken: 'a', refreshToken: 'r', expiresIn: 3599, scope: 'Notes.ReadWrite' })
    const body = new URLSearchParams((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code_verifier')).toBe('verifier-1')
  })

  it('turns a revoked refresh token into a reconnect request', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }))
    await expect(refreshTokens(CONFIG, 'old', fetchMock as unknown as typeof fetch)).rejects.toBeInstanceOf(ReconnectRequiredError)
  })
})
