// Sign-in by email link, and the signed-in person's household role.

import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
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
    supabase.rpc('ensure_own_household').then(async () => {
      const { data } = await supabase.from('household_members').select('role').eq('user_id', userId).order('created_at').limit(1).maybeSingle()
      setRole((data?.role as Role | undefined) ?? null)
    })
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
