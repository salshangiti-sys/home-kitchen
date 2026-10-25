// Access tokens for Microsoft Graph, renewed from the refresh token kept in Supabase Vault.
// Each renewal returns a new refresh token, which replaces the stored one.

import type { SupabaseClient } from '@supabase/supabase-js'
import { ReconnectRequiredError } from '../onenote/errors.ts'
import { refreshTokens, type OAuthConfig } from '../onenote/oauth.ts'

export function accessTokenProvider(admin: SupabaseClient, userId: string, config: OAuthConfig) {
  let cached: { token: string; expiresAt: number } | null = null

  return async (forceRefresh: boolean): Promise<string> => {
    if (!forceRefresh && cached && cached.expiresAt > Date.now() + 60_000) return cached.token

    const { data: refreshToken, error } = await admin.rpc('ms_read_refresh_token', { p_user_id: userId })
    if (error) throw new Error(`could not read the Microsoft connection: ${error.message}`)
    if (!refreshToken) throw new ReconnectRequiredError('Microsoft account is not connected')

    try {
      const tokens = await refreshTokens(config, refreshToken as string)
      const stored = await admin.rpc('ms_store_refresh_token', { p_user_id: userId, p_token: tokens.refreshToken })
      if (stored.error) throw new Error(`could not save the renewed token: ${stored.error.message}`)
      cached = { token: tokens.accessToken, expiresAt: Date.now() + tokens.expiresIn * 1000 }
      return cached.token
    } catch (error) {
      if (error instanceof ReconnectRequiredError) {
        await admin
          .from('ms_connections')
          .update({ status: 'needs_reconnect', last_error: error.message, updated_at: new Date().toISOString() })
          .eq('user_id', userId)
      }
      throw error
    }
  }
}
