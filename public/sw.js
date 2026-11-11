// Service worker: keeps the app's own files so the app opens with no signal. It handles only
// GET requests to this site's folder; nothing from Supabase or OneNote passes through it, and no
// sign-in data is stored here. (Recipes for offline reading are kept by the app itself, in
// IndexedDB, per signed-in person; see src/offline.)
//
// - Page (index.html): network first, with a 4 second limit, then the saved copy. Every
//   successful load also saves the files that page uses (/assets/*, fonts, icons).
// - Files under /assets/ and /fonts/ and /icons/: saved copy first (their names carry a hash, so a
//   saved file is never out of date), fetched and saved when missing.
// - Older /assets/ files no longer used by the latest page are deleted, so the cache stays small.

const CACHE = 'hk-app-v1'
const SCOPE = new URL(self.registration.scope)
const PAGE = SCOPE.href // the folder itself: the app is one page (hash routes)
const PAGE_TIMEOUT_MS = 4000
const STATIC = /\/(assets|fonts|icons)\//

// The files a page refers to, as absolute URLs inside this folder.
function filesIn(html) {
  const found = new Set()
  for (const [, url] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    const abs = new URL(url, SCOPE)
    if (abs.origin === SCOPE.origin && abs.pathname.startsWith(SCOPE.pathname) && (STATIC.test(abs.pathname) || abs.pathname.endsWith('manifest.webmanifest'))) {
      found.add(abs.href)
    }
  }
  return found
}

async function saveSiteFiles(html) {
  const cache = await caches.open(CACHE)
  const wanted = filesIn(html)
  await Promise.all([...wanted].map((url) => cache.match(url).then((hit) => hit || cache.add(url).catch(() => undefined))))
  // Forget old hashed files that this page no longer uses.
  for (const request of await cache.keys()) {
    if (new URL(request.url).pathname.includes('/assets/') && !wanted.has(request.url)) await cache.delete(request)
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const response = await fetch(PAGE, { cache: 'reload' })
      const cache = await caches.open(CACHE)
      await cache.put(PAGE, response.clone())
      await saveSiteFiles(await response.text())
      await self.skipWaiting()
    })().catch(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name)
      await self.clients.claim()
    })(),
  )
})

async function page(request) {
  const cache = await caches.open(CACHE)
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), PAGE_TIMEOUT_MS)),
    ])
    if (response.ok) {
      cache.put(PAGE, response.clone())
      response.clone().text().then(saveSiteFiles).catch(() => undefined)
    }
    return response
  } catch (error) {
    const saved = await cache.match(PAGE, { ignoreSearch: true })
    if (saved) return saved
    throw error
  }
}

async function file(request) {
  const cache = await caches.open(CACHE)
  const saved = await cache.match(request)
  if (saved) return saved
  const response = await fetch(request)
  if (response.ok) cache.put(request, response.clone())
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return
  if (request.mode === 'navigate') event.respondWith(page(request))
  else if (STATIC.test(url.pathname)) event.respondWith(file(request))
})
