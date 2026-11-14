// What the screens show about the queue of changes waiting to be sent, and the trigger that sends them
// when the connection returns (and when the app opens).

import { useCallback, useEffect, useState } from 'react'
import { dismissFailure, failures, flush, pending, subscribe, type Failure } from './outbox'

export interface OutboxState {
  waiting: number
  failures: Failure[]
}

export function useOutbox(): OutboxState & { sendNow: () => Promise<unknown>; dismiss: (id: string) => Promise<void> } {
  const [state, setState] = useState<OutboxState>({ waiting: 0, failures: [] })
  const refresh = useCallback(async () => setState({ waiting: (await pending()).length, failures: await failures() }), [])

  useEffect(() => {
    void refresh()
    return subscribe(() => void refresh())
  }, [refresh])

  return { ...state, sendNow: () => flush().then(refresh), dismiss: dismissFailure }
}

// Sends what is waiting when the app opens signed in, and every time the connection comes back.
export function useFlushWhenOnline(signedIn: boolean) {
  useEffect(() => {
    if (!signedIn) return
    const run = () => void flush().catch(() => undefined)
    run()
    window.addEventListener('online', run)
    return () => window.removeEventListener('online', run)
  }, [signedIn])
}
