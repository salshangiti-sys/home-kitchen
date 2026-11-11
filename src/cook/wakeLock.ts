// Keeps the screen from turning off while cooking, using the browser's Screen Wake Lock API.
// The browser drops the lock whenever the page is hidden, so it is asked for again when the page
// comes back. Where the device has no such feature, the caller is told and nothing else happens.

export type WakeState = 'on' | 'off' | 'unsupported'

interface Sentinel {
  release(): Promise<void>
  addEventListener(type: 'release', listener: () => void): void
}

export interface WakeNavigator {
  wakeLock?: { request(type: 'screen'): Promise<Sentinel> }
}

type WakeDocument = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>

export function keepScreenAwake(
  onChange: (state: WakeState) => void,
  nav: WakeNavigator = navigator as WakeNavigator,
  doc: WakeDocument = document,
): { release(): void } {
  const api = nav.wakeLock
  if (!api) {
    onChange('unsupported')
    return { release() {} }
  }

  let sentinel: Sentinel | null = null
  let stopped = false

  const acquire = async () => {
    if (stopped || doc.visibilityState !== 'visible') return
    try {
      const lock = await api.request('screen')
      if (stopped) {
        void lock.release()
        return
      }
      sentinel = lock
      onChange('on')
      lock.addEventListener('release', () => {
        if (!stopped) onChange('off')
      })
    } catch {
      onChange('off') // refused (low battery, power saving, a hidden page)
    }
  }

  const onVisible = () => {
    if (doc.visibilityState === 'visible') void acquire()
  }
  doc.addEventListener('visibilitychange', onVisible)
  void acquire()

  return {
    release() {
      stopped = true
      doc.removeEventListener('visibilitychange', onVisible)
      void sentinel?.release()
    },
  }
}
