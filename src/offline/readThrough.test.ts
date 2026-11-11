import { beforeEach, describe, expect, it } from 'vitest'
import { explain, looksOffline, OFFLINE_MESSAGE, OFFLINE_NO_COPY, readThrough, save, saved, setCacheOwner, useStore } from './readThrough'
import { memoryStore } from './store'

let kv: ReturnType<typeof memoryStore>

beforeEach(async () => {
  kv = memoryStore()
  useStore(kv)
  await setCacheOwner(null)
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
})

const offline = () => Promise.reject(new TypeError('Failed to fetch'))

describe('reads with a saved copy', () => {
  it('keeps what it loads, and returns it when the connection is gone', async () => {
    await setCacheOwner('u1')
    expect(await readThrough('list', async () => ['a', 'b'])).toEqual(['a', 'b'])
    expect(await readThrough('list', offline)).toEqual(['a', 'b'])
  })

  it('never hides a real error behind an old copy', async () => {
    await setCacheOwner('u1')
    await readThrough('list', async () => ['a'])
    await expect(readThrough('list', () => Promise.reject(new Error('permission denied')))).rejects.toThrow('permission denied')
  })

  it('has nothing to fall back on the first time offline, and says so', async () => {
    await setCacheOwner('u1')
    await expect(readThrough('list', offline)).rejects.toThrow(OFFLINE_NO_COPY)
  })

  it('uses a copy built from other saved items when the item itself was never opened', async () => {
    await setCacheOwner('u1')
    expect(await readThrough('recipe:a', offline, async () => 'from the list')).toBe('from the list')
  })

  it('explains a missing connection in words, and leaves other errors alone', () => {
    expect(explain(new TypeError('Failed to fetch')).message).toBe(OFFLINE_MESSAGE)
    expect(explain(new Error('permission denied')).message).toBe('permission denied')
  })

  it('treats a device that reports no connection as offline', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    expect(looksOffline(new Error('anything'))).toBe(true)
  })
})

describe('whose copy it is', () => {
  it('saves nothing and returns nothing without a signed-in person', async () => {
    await save('list', ['a'])
    expect(await saved('list')).toBeUndefined()
    expect(kv.data.size).toBe(0)
  })

  it('deletes a copy left by someone else when the app opens signed out or as another person', async () => {
    await setCacheOwner('u1')
    await save('list', ['a'])
    useStore(kv) // a fresh page load: the app has not decided who is signed in yet
    await setCacheOwner(null)
    expect(kv.data.size).toBe(0)

    await setCacheOwner('u1')
    await save('list', ['a'])
    useStore(kv)
    await setCacheOwner('u2')
    expect(await saved('list')).toBeUndefined()
  })

  it('deletes the copy on sign-out and when someone else signs in', async () => {
    await setCacheOwner('u1')
    await save('list', ['a'])
    await setCacheOwner('u2')
    expect(await saved('list')).toBeUndefined()
    await save('list', ['b'])
    await setCacheOwner(null)
    expect(kv.data.size).toBe(0)
  })

  it('keeps the copy when the same person is set again (a page reload)', async () => {
    await setCacheOwner('u1')
    await save('list', ['a'])
    useStore(kv) // a reload
    await setCacheOwner('u1')
    expect(await saved('list')).toEqual(['a'])
  })
})
