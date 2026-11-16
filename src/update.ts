// Tells the person when a newer version of the app has been published, so an installed copy that is
// still open does not keep showing the old screens. The page is fetched again from the network (never
// from the saved copy) now and then, and when the app comes back to the front; if the main file it
// names is not the one running, a newer version is waiting.

import { useEffect, useState } from 'react'

const BUNDLE = /assets\/index-[A-Za-z0-9_-]+\.js/

// The name of the app's main file in a page (it changes with every published version).
export const bundleIn = (text: string): string | null => text.match(BUNDLE)?.[0] ?? null

// The main file this page is running, or null when it cannot be told (e.g. in development).
export function runningBundle(doc: Document = document): string | null {
  const script = doc.querySelector('script[type="module"][src*="assets/index-"]')
  return script ? bundleIn(script.getAttribute('src') ?? '') : null
}

const EVERY_MS = 10 * 60 * 1000

export function useUpdateAvailable(enabled: boolean = import.meta.env.PROD, home: string = import.meta.env.BASE_URL): boolean {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let stopped = false
    const check = async () => {
      try {
        const mine = runningBundle()
        if (!mine) return
        const response = await fetch(home, { cache: 'no-store' })
        if (!response.ok) return
        const latest = bundleIn(await response.text())
        if (!stopped && latest && latest !== mine) setAvailable(true)
      } catch {
        // offline or slow: try again later
      }
    }
    const onShow = () => {
      if (document.visibilityState === 'visible') void check()
    }
    void check()
    const timer = window.setInterval(check, EVERY_MS)
    document.addEventListener('visibilitychange', onShow)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onShow)
    }
  }, [enabled, home])
  return available
}

// Loads the new version: the saved copy is asked to update first, then the page is reloaded.
export async function updateNow(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration()
    await registration?.update()
  } catch {
    // the reload below is what matters
  }
  window.location.reload()
}
