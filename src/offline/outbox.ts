// Changes made with no connection, kept on the device and sent when the connection is back.
//
// Only small, safe-to-repeat changes go through here (ticking a task, later ticking a shopping item):
// each is "set this item to this state", so the last change to an item wins and sending it twice does
// no harm. A change is never shown as sent before the server has accepted it: until then it stays in
// the queue and the screens say "لم تُرسل بعد".
//
// - A change that fails because there is no connection stays queued, with the ones after it (order is
//   kept), and is tried again when the connection returns.
// - A change the server refuses (the task was removed, no permission) is taken out of the queue and
//   written to a list of failures that the person sees and dismisses. Nothing is dropped silently.
// - The queue belongs to the signed-in person's copy on this device (see readThrough.ts) and is deleted
//   with it when someone else signs in.

import { looksOffline, save, saved } from './readThrough'

export interface Op {
  id: string
  key: string // one pending change per key: a newer change to the same item replaces the older one
  kind: string
  args: Record<string, unknown>
  at: string // when the person made the change
}

export interface Failure {
  id: string
  label: string
  message: string
  at: string
}

type Handler = (args: Record<string, unknown>) => Promise<unknown>
const handlers = new Map<string, { run: Handler; label: string }>()

// Says how to send one kind of change (and what to call it when it fails).
export const registerHandler = (kind: string, label: string, run: Handler) => void handlers.set(kind, { run, label })

export type OutboxEvent = 'queued' | 'flushed' | 'failed'
const listeners = new Set<(event: OutboxEvent) => void>()
export const subscribe = (listener: (event: OutboxEvent) => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
const emit = (event: OutboxEvent) => listeners.forEach((listener) => listener(event))

// One change to the queue at a time, so two quick ticks cannot overwrite each other.
let chain: Promise<unknown> = Promise.resolve()
const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
  const next = chain.then(work, work)
  chain = next.catch(() => undefined)
  return next
}

export const pending = async (): Promise<Op[]> => (await saved<Op[]>('outbox')) ?? []
export const failures = async (): Promise<Failure[]> => (await saved<Failure[]>('outbox-failures')) ?? []

export const enqueue = (kind: string, key: string, args: Record<string, unknown>, at = new Date().toISOString()): Promise<void> =>
  exclusive(async () => {
    const ops = (await pending()).filter((op) => op.key !== key)
    ops.push({ id: crypto.randomUUID(), key, kind, args, at })
    await save('outbox', ops)
    emit('queued')
  })

export const dismissFailure = (id: string): Promise<void> =>
  exclusive(async () => {
    await save('outbox-failures', (await failures()).filter((f) => f.id !== id))
    emit('failed')
  })

export interface FlushResult {
  sent: number
  failed: number
  left: number
}

// Sends the queued changes in order. Stops at the first one that fails for lack of a connection.
export const flush = (): Promise<FlushResult> =>
  exclusive(async () => {
    let ops = await pending()
    const result: FlushResult = { sent: 0, failed: 0, left: ops.length }
    while (ops.length) {
      const op = ops[0]
      const handler = handlers.get(op.kind)
      try {
        if (!handler) throw new Error(`unknown change: ${op.kind}`)
        await handler.run(op.args)
        result.sent += 1
      } catch (error) {
        if (looksOffline(error)) break
        const message = error instanceof Error ? error.message : String(error)
        await save('outbox-failures', [...(await failures()), { id: op.id, label: handler?.label ?? op.kind, message, at: op.at } satisfies Failure])
        result.failed += 1
      }
      ops = ops.slice(1)
      await save('outbox', ops)
      result.left = ops.length
    }
    if (result.sent) emit('flushed')
    if (result.failed) emit('failed')
    return result
  })
