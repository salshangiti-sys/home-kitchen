// @vitest-environment node
// Runs public/sw.js against an in-memory copy of the browser's cache and a pretend network.

import { beforeEach, describe, expect, it } from 'vitest'
import source from '../../public/sw.js?raw'

const SCOPE = 'https://example.github.io/home-kitchen/'

function pageHtml(js: string, css: string) {
  return `<!doctype html><html><head>
    <link rel="manifest" href="/home-kitchen/manifest.webmanifest" />
    <link rel="preload" href="/home-kitchen/fonts/ibm-plex-sans-arabic/Regular.woff2" as="font" />
    <script type="module" src="/home-kitchen/assets/${js}.js"></script>
    <link rel="stylesheet" href="/home-kitchen/assets/${css}.css" />
    <link rel="icon" href="/home-kitchen/icons/icon.svg" />
    <a href="https://elsewhere.example/assets/x.js">other site</a></head><body></body></html>`
}

class MemoryCache {
  entries = new Map<string, Response>()
  private url = (r: Request | string, ignoreSearch = false) => {
    const u = new URL(typeof r === 'string' ? r : r.url)
    if (ignoreSearch) u.search = ''
    return u.href
  }
  async match(r: Request | string, options?: { ignoreSearch?: boolean }) {
    const want = this.url(r, options?.ignoreSearch)
    for (const [key, value] of this.entries) if (this.url(key, options?.ignoreSearch) === want) return value.clone()
    return undefined
  }
  async put(r: Request | string, response: Response) {
    this.entries.set(this.url(r), response)
  }
  async add(r: string) {
    const response = await network(r)
    if (!response.ok) throw new Error('bad response')
    this.entries.set(this.url(r), response)
  }
  async keys() {
    return [...this.entries.keys()].map((key) => new Request(key))
  }
  async delete(r: Request | string) {
    return this.entries.delete(this.url(r))
  }
}

let site: Map<string, string>
let online: boolean
let cache: MemoryCache
let cacheNames: Map<string, MemoryCache>
const listeners = new Map<string, (event: unknown) => void>()

async function network(input: Request | string): Promise<Response> {
  if (!online) throw new TypeError('Failed to fetch')
  const url = new URL(typeof input === 'string' ? input : input.url)
  url.search = ''
  const body = site.get(url.href)
  return body === undefined ? new Response('not found', { status: 404 }) : new Response(body, { status: 200 })
}

function start() {
  listeners.clear()
  cacheNames = new Map()
  cache = new MemoryCache()
  cacheNames.set('hk-app-v1', cache)
  const caches = {
    open: async (name: string) => {
      if (!cacheNames.has(name)) cacheNames.set(name, new MemoryCache())
      return cacheNames.get(name)!
    },
    keys: async () => [...cacheNames.keys()],
    delete: async (name: string) => cacheNames.delete(name),
  }
  const self = {
    registration: { scope: SCOPE },
    addEventListener: (type: string, handler: (event: unknown) => void) => listeners.set(type, handler),
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  }
  new Function('self', 'caches', 'fetch', 'setTimeout', source)(self, caches, network, setTimeout)
}

async function lifecycle(type: 'install' | 'activate') {
  let work: Promise<unknown> = Promise.resolve()
  listeners.get(type)!({ waitUntil: (p: Promise<unknown>) => (work = p) })
  await work
}

async function request(url: string, mode: 'navigate' | 'cors' = 'cors', method = 'GET'): Promise<Response | 'passed through'> {
  let answer: Promise<Response> | undefined
  const req = { url, method, mode }
  listeners.get('fetch')!({ request: req, respondWith: (p: Promise<Response>) => (answer = p) })
  return answer ? answer : 'passed through'
}

const keysOf = async () => (await cache.keys()).map((r) => new URL(r.url).pathname).sort()

beforeEach(() => {
  online = true
  site = new Map([
    [SCOPE, pageHtml('index-AAA', 'index-AAA')],
    [`${SCOPE}assets/index-AAA.js`, 'js v1'],
    [`${SCOPE}assets/index-AAA.css`, 'css v1'],
    [`${SCOPE}fonts/ibm-plex-sans-arabic/Regular.woff2`, 'font'],
    [`${SCOPE}icons/icon.svg`, 'icon'],
    [`${SCOPE}manifest.webmanifest`, '{}'],
  ])
  start()
})

describe('the app opens with no signal', () => {
  it('saves the page and every file it uses when installed', async () => {
    await lifecycle('install')
    expect(await keysOf()).toEqual([
      '/home-kitchen/',
      '/home-kitchen/assets/index-AAA.css',
      '/home-kitchen/assets/index-AAA.js',
      '/home-kitchen/fonts/ibm-plex-sans-arabic/Regular.woff2',
      '/home-kitchen/icons/icon.svg',
      '/home-kitchen/manifest.webmanifest',
    ])
  })

  it('serves the saved page, even with a ?ms=… ending, and the saved files, when offline', async () => {
    await lifecycle('install')
    online = false
    const page = (await request(SCOPE, 'navigate')) as Response
    expect(await page.text()).toContain('index-AAA')
    const returned = (await request(`${SCOPE}?ms=connected`, 'navigate')) as Response
    expect(await returned.text()).toContain('index-AAA')
    const js = (await request(`${SCOPE}assets/index-AAA.js`)) as Response
    expect(await js.text()).toBe('js v1')
  })

  it('prefers the network for the page, so an update shows up, and saves the new files', async () => {
    await lifecycle('install')
    site.set(SCOPE, pageHtml('index-BBB', 'index-BBB'))
    site.set(`${SCOPE}assets/index-BBB.js`, 'js v2')
    site.set(`${SCOPE}assets/index-BBB.css`, 'css v2')
    const page = (await request(SCOPE, 'navigate')) as Response
    expect(await page.text()).toContain('index-BBB')
    await new Promise((resolve) => setTimeout(resolve, 20)) // saving files continues after the answer
    const kept = await keysOf()
    expect(kept).toContain('/home-kitchen/assets/index-BBB.js')
    // The old version's files are dropped so the cache does not grow with every release.
    expect(kept).not.toContain('/home-kitchen/assets/index-AAA.js')
    expect(kept).not.toContain('/home-kitchen/assets/index-AAA.css')
    expect(kept).toContain('/home-kitchen/fonts/ibm-plex-sans-arabic/Regular.woff2')
  })
})

describe('what it leaves alone', () => {
  it('ignores other sites, writes, and requests outside the app folder', async () => {
    await lifecycle('install')
    expect(await request('https://rknhlhrnncmfzkyyzgmd.supabase.co/rest/v1/recipes')).toBe('passed through')
    expect(await request(`${SCOPE}assets/index-AAA.js`, 'cors', 'POST')).toBe('passed through')
    expect(await request('https://example.github.io/other-project/assets/a.js')).toBe('passed through')
    expect(await request(`${SCOPE}something.json`)).toBe('passed through')
  })

  it('passes a missing file through as an error offline, never as a made-up answer', async () => {
    await lifecycle('install')
    online = false
    await expect(request(`${SCOPE}assets/never-saved.js`)).rejects.toThrow('Failed to fetch')
  })

  it('deletes caches of older versions on activate', async () => {
    cacheNames.set('hk-app-v0', new MemoryCache())
    await lifecycle('activate')
    expect([...cacheNames.keys()]).toEqual(['hk-app-v1'])
  })

  it('still installs, without saved files, when the site cannot be reached', async () => {
    online = false
    await expect(lifecycle('install')).resolves.toBeUndefined()
    expect(await keysOf()).toEqual([])
  })
})
