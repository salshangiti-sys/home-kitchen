// Reads that fall back to the last saved copy when there is no connection.
//
// Each signed-in person has their own copy; signing out deletes it. A copy is used only when the
// failure looks like a missing connection, never to hide a real error (permissions, a bad
// request), and never for writes.

import { idbStore, type KV } from './store'

let store: KV = idbStore
let owner: string | null = null
let decided = false

export const useStore = (kv: KV) => {
  store = kv
  decided = false
}

// Says whose copy this is, once the app knows who is signed in (never before: an unknown person is
// not the same as nobody). The store remembers its owner, so a copy left on the device by someone
// who signed out, or whose session ended, is deleted as soon as it is not the current person's.
export async function setCacheOwner(userId: string | null): Promise<void> {
  if (decided && owner === userId) return
  decided = true
  owner = userId
  const remembered = await store.get<string>('owner')
  if (remembered === (userId ?? undefined)) return
  await store.clear()
  if (userId) await store.set('owner', userId)
}

const key = (name: string) => `${owner}:${name}`

// Network failures seen by the browser's fetch (and supabase-js, which wraps it).
export function looksOffline(error?: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /failed to fetch|networkerror|network request failed|load failed|internet connection|offline/i.test(message)
}

interface Saved<T> {
  savedAt: string
  value: T
}

export async function save<T>(name: string, value: T): Promise<void> {
  if (owner) await store.set(key(name), { savedAt: new Date().toISOString(), value } satisfies Saved<T>)
}

export async function saved<T>(name: string): Promise<T | undefined> {
  if (!owner) return undefined
  return (await store.get<Saved<T>>(key(name)))?.value
}

// Runs `load`; on success keeps the result for later, on a missing connection returns the last
// kept result (or `fallback()`, e.g. a copy built from another saved item) if there is one.
export async function readThrough<T>(name: string, load: () => Promise<T>, fallback?: () => Promise<T | undefined>): Promise<T> {
  try {
    const value = await load()
    void save(name, value)
    return value
  } catch (error) {
    if (looksOffline(error)) {
      const copy = (await saved<T>(name)) ?? (await fallback?.())
      if (copy !== undefined) return copy
    }
    throw error
  }
}
