// Sign-in by email link, and the signed-in person's household role.

import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { keepRecipesForOffline } from './library/api'
import { looksOffline, readThrough, setCacheOwner } from './offline/readThrough'
import { appHome } from './router'
import { Button, Card } from './ui'

export type Role = 'owner' | 'editor' | 'viewer'

export interface Auth {
  ready: boolean
  session: Session | null
  role: Role | null
}

export function useAuth(): Auth {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [role, setRole] = useState<Role | null>(null)

  // The offline copy on this device belongs to whoever is signed in, so the app learns who that is
  // (or that no one is) before showing anything that reads data.
  useEffect(() => {
    const settle = async (next: Session | null) => {
      await setCacheOwner(next?.user.id ?? null)
      setSession(next)
      setReady(true)
    }
    supabase.auth.getSession().then(({ data }) => settle(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, next) => void settle(next))
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id
  useEffect(() => {
    if (!userId) {
      setRole(null)
      return
    }
    // The owner's household is created on first sign-in. (Adding the sister as a viewer of it comes
    // in Phase 3.)
    readThrough<Role | null>('role', async () => {
      const ensured = await supabase.rpc('ensure_own_household')
      if (ensured.error && looksOffline(ensured.error.message)) throw new Error(ensured.error.message)
      const { data, error } = await supabase.from('household_members').select('role').eq('user_id', userId).order('created_at').limit(1).maybeSingle()
      if (error) throw new Error(error.message)
      return (data?.role as Role | undefined) ?? null
    }).then(
      (found) => {
        setRole(found)
        if (navigator.onLine) keepRecipesForOffline().catch(() => undefined)
      },
      () => setRole(null),
    )
  }, [userId])

  return { ready, session, role }
}

export const canEdit = (role: Role | null) => role === 'owner' || role === 'editor'

export function SignIn() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const send = async () => {
    setState('sending')
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: appHome() } })
    setState(error ? 'error' : 'sent')
  }
  return (
    <Card title="تسجيل الدخول">
      <div className="flex flex-col gap-3">
        <input
          type="email"
          dir="ltr"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          className="min-h-11 rounded-xl border border-line bg-bg px-3"
        />
        <Button onClick={send} disabled={!email || state === 'sending'}>
          أرسل رابط الدخول
        </Button>
        {state === 'sent' && (
          <p className="text-sm text-muted">أُرسل رابط الدخول إلى البريد. افتحه في المتصفح نفسه الذي ستستخدم فيه التطبيق.</p>
        )}
        {state === 'error' && <p className="text-sm text-red-600">تعذّر إرسال الرابط. حاول بعد قليل.</p>}
      </div>
    </Card>
  )
}
