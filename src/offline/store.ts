// A small key-value store in the browser (IndexedDB) for the copy of the recipes kept for reading
// with no signal. Everything here is best effort: where IndexedDB is unavailable (private
// browsing, blocked site data) reads return nothing and writes are skipped, and the app works
// online exactly as before.

export interface KV {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  clear(): Promise<void>
}

const DB = 'hk-offline'
const STORE = 'kv'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const db = await open()
    return await new Promise<T>((resolve, reject) => {
      const request = work(db.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    }).finally(() => db.close())
  } catch {
    return undefined
  }
}

export const idbStore: KV = {
  get: <T>(key: string) => run<T>('readonly', (s) => s.get(key) as IDBRequest<T>),
  set: async (key, value) => void (await run('readwrite', (s) => s.put(value, key))),
  clear: async () => void (await run('readwrite', (s) => s.clear())),
}

export function memoryStore(): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  return {
    data,
    get: async <T>(key: string) => data.get(key) as T | undefined,
    set: async (key, value) => void data.set(key, value),
    clear: async () => data.clear(),
  }
}
