import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dismissFailure, enqueue, failures, flush, pending, registerHandler, subscribe } from './outbox'
import { memoryStore } from './store'
import { setCacheOwner, useStore } from './readThrough'

const offline = () => new TypeError('Failed to fetch')

let sent: Array<Record<string, unknown>>
let behave: (args: Record<string, unknown>) => Promise<unknown>

beforeEach(async () => {
  useStore(memoryStore())
  await setCacheOwner(null)
  await setCacheOwner('u1')
  sent = []
  behave = async (args) => void sent.push(args)
  registerHandler('thing', 'تعليم شيء', (args) => behave(args))
})

afterEach(() => vi.restoreAllMocks())

describe('the outbox', () => {
  it('keeps changes in order, and a newer change to the same item replaces the older one', async () => {
    await enqueue('thing', 'thing:1', { id: '1', done: true })
    await enqueue('thing', 'thing:2', { id: '2', done: true })
    await enqueue('thing', 'thing:1', { id: '1', done: false })
    expect((await pending()).map((op) => op.args)).toEqual([
      { id: '2', done: true },
      { id: '1', done: false },
    ])
  })

  it('sends everything in order and empties the queue', async () => {
    await enqueue('thing', 'a', { n: 1 })
    await enqueue('thing', 'b', { n: 2 })
    const events: string[] = []
    const stop = subscribe((e) => events.push(e))
    const result = await flush()
    stop()
    expect(sent).toEqual([{ n: 1 }, { n: 2 }])
    expect(result).toEqual({ sent: 2, failed: 0, left: 0 })
    expect(await pending()).toEqual([])
    expect(events).toEqual(['flushed'])
  })

  it('stops at the first change that fails for lack of a connection and keeps it and the rest', async () => {
    await enqueue('thing', 'a', { n: 1 })
    await enqueue('thing', 'b', { n: 2 })
    await enqueue('thing', 'c', { n: 3 })
    behave = async (args) => {
      if (args.n === 2) throw offline()
      sent.push(args)
    }
    const result = await flush()
    expect(sent).toEqual([{ n: 1 }])
    expect(result).toEqual({ sent: 1, failed: 0, left: 2 })
    expect((await pending()).map((op) => op.args.n)).toEqual([2, 3])
    expect(await failures()).toEqual([])

    behave = async (args) => void sent.push(args) // the connection is back
    expect((await flush()).left).toBe(0)
    expect(sent.map((s) => s.n)).toEqual([1, 2, 3])
  })

  it('takes out a change the server refused and tells the person, without losing the ones after it', async () => {
    await enqueue('thing', 'a', { n: 1 })
    await enqueue('thing', 'b', { n: 2 })
    behave = async (args) => {
      if (args.n === 1) throw new Error('not allowed')
      sent.push(args)
    }
    const events: string[] = []
    const stop = subscribe((e) => events.push(e))
    const result = await flush()
    stop()
    expect(result).toEqual({ sent: 1, failed: 1, left: 0 })
    expect(sent).toEqual([{ n: 2 }])
    expect(await pending()).toEqual([])
    const list = await failures()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ label: 'تعليم شيء', message: 'not allowed' })
    expect(events).toEqual(['flushed', 'failed'])

    await dismissFailure(list[0].id)
    expect(await failures()).toEqual([])
  })

  it('reports an unknown kind of change as a failure instead of dropping it silently', async () => {
    await enqueue('mystery', 'm', {})
    const result = await flush()
    expect(result.failed).toBe(1)
    expect((await failures())[0].message).toMatch(/unknown change: mystery/)
  })

  it('treats a failure while the browser says it is offline as no connection', async () => {
    await enqueue('thing', 'a', { n: 1 })
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    behave = async () => {
      throw new Error('some error')
    }
    expect((await flush()).left).toBe(1)
    expect(await failures()).toEqual([])
  })

  it('does nothing and keeps nothing when nobody is signed in', async () => {
    await setCacheOwner(null)
    await enqueue('thing', 'a', { n: 1 })
    expect(await pending()).toEqual([])
    expect(await flush()).toEqual({ sent: 0, failed: 0, left: 0 })
  })

  it('belongs to the signed-in person: another person on the same device never sends it', async () => {
    await enqueue('thing', 'a', { n: 1 })
    await setCacheOwner('u2')
    expect(await pending()).toEqual([])
    expect((await flush()).sent).toBe(0)
    expect(sent).toEqual([])
  })

  it('two quick changes at once both reach the queue', async () => {
    await Promise.all([enqueue('thing', 'a', { n: 1 }), enqueue('thing', 'b', { n: 2 }), enqueue('thing', 'c', { n: 3 })])
    expect(await pending()).toHaveLength(3)
  })
})
