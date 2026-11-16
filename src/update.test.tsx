import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bundleIn, runningBundle, useUpdateAvailable } from './update'

const page = (hash: string) => `<!doctype html><html><head><script type="module" crossorigin src="/home-kitchen/assets/index-${hash}.js"></script></head><body></body></html>`

beforeEach(() => {
  document.head.innerHTML = '<script type="module" src="/home-kitchen/assets/index-OLD123.js"></script>'
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.head.innerHTML = ''
})

describe('which version is running and which is published', () => {
  it('reads the main file name from a page', () => {
    expect(bundleIn(page('AbC_-9'))).toBe('assets/index-AbC_-9.js')
    expect(bundleIn('<html></html>')).toBeNull()
    expect(runningBundle()).toBe('assets/index-OLD123.js')
  })
})

describe('the update notice', () => {
  it('appears when the published page names another main file', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(page('NEW456'))))
    const { result } = renderHook(() => useUpdateAvailable(true, '/home-kitchen/'))
    await waitFor(() => expect(result.current).toBe(true))
    expect(fetch).toHaveBeenCalledWith('/home-kitchen/', { cache: 'no-store' })
  })

  it('stays quiet when it is the same version, when offline, and when it is switched off', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(page('OLD123'))))
    const same = renderHook(() => useUpdateAvailable(true, '/home-kitchen/'))
    await act(async () => {})
    expect(same.result.current).toBe(false)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const offline = renderHook(() => useUpdateAvailable(true, '/home-kitchen/'))
    await act(async () => {})
    expect(offline.result.current).toBe(false)
    const off = vi.fn()
    vi.stubGlobal('fetch', off)
    renderHook(() => useUpdateAvailable(false))
    expect(off).not.toHaveBeenCalled()
  })

  it('looks again when the app comes back to the front', async () => {
    const answers = [page('OLD123'), page('NEW456')]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(answers.shift() ?? page('NEW456'))))
    const { result } = renderHook(() => useUpdateAvailable(true, '/home-kitchen/'))
    await act(async () => {})
    expect(result.current).toBe(false)
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => expect(result.current).toBe(true))
  })
})
