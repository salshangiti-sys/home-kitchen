import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clampSize, clampStep, clearProgress, DEFAULT_SIZE, loadProgress, loadSize, saveProgress, saveSize } from './cookState'
import { keepScreenAwake, type WakeNavigator, type WakeState } from './wakeLock'

beforeEach(() => localStorage.clear())

describe('cooking progress', () => {
  it('keeps the step in range', () => {
    expect(clampStep(-3, 5)).toBe(0)
    expect(clampStep(9, 5)).toBe(4)
    expect(clampStep(2.6, 5)).toBe(3)
    expect(clampStep(1, 0)).toBe(0)
  })

  it('remembers the step, ticked ingredients and view for each recipe', () => {
    saveProgress('salads-007', { step: 2, checked: ['0:1', '1:0'], view: 'steps' })
    expect(loadProgress('salads-007', 5)).toEqual({ step: 2, checked: ['0:1', '1:0'], view: 'steps' })
    expect(loadProgress('other-001', 5)).toBeNull()
    clearProgress('salads-007')
    expect(loadProgress('salads-007', 5)).toBeNull()
  })

  it('copes with a step that is past the end now (the recipe got shorter) and with bad data', () => {
    saveProgress('a-001', { step: 9, checked: [], view: 'steps' })
    expect(loadProgress('a-001', 3)?.step).toBe(2)
    localStorage.setItem('hk-cook:b-001', '{not json')
    expect(loadProgress('b-001', 3)).toBeNull()
    localStorage.setItem('hk-cook:c-001', JSON.stringify({ step: 'x', checked: [1, '0:0'], view: 'nonsense' }))
    expect(loadProgress('c-001', 3)).toEqual({ step: 0, checked: ['0:0'], view: 'steps' })
  })

  it('remembers the text size, within the available sizes', () => {
    expect(loadSize()).toBe(DEFAULT_SIZE)
    saveSize(3)
    expect(loadSize()).toBe(3)
    expect(clampSize(10)).toBe(3)
    expect(clampSize(-1)).toBe(0)
  })

  it('does not fail when storage is blocked', () => {
    const blocked = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(loadProgress('a-001', 3)).toBeNull()
    expect(loadSize()).toBe(DEFAULT_SIZE)
    expect(() => saveProgress('a-001', { step: 1, checked: [], view: 'steps' })).not.toThrow()
    expect(() => saveSize(2)).not.toThrow()
    blocked.mockRestore()
    vi.restoreAllMocks()
  })
})

describe('keeping the screen awake', () => {
  function fakeDevice(visible = true) {
    const listeners = new Set<() => void>()
    const doc = {
      visibilityState: (visible ? 'visible' : 'hidden') as DocumentVisibilityState,
      addEventListener: (_type: string, fn: () => void) => void listeners.add(fn),
      removeEventListener: (_type: string, fn: () => void) => void listeners.delete(fn),
    }
    const locks: Array<{ released: boolean; fireRelease(): void; release(): Promise<void> }> = []
    const nav: WakeNavigator = {
      wakeLock: {
        request: async () => {
          let onRelease: () => void = () => {}
          const lock = {
            released: false,
            fireRelease: () => onRelease(),
            release: async () => {
              lock.released = true
            },
            addEventListener: (_t: 'release', fn: () => void) => {
              onRelease = fn
            },
          }
          locks.push(lock)
          return lock
        },
      },
    }
    const show = (state: DocumentVisibilityState) => {
      doc.visibilityState = state
      listeners.forEach((fn) => fn())
    }
    return { nav, doc: doc as never, locks, show, listeners }
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('asks for the lock, asks again when the page comes back, and lets go when done', async () => {
    const device = fakeDevice()
    const states: WakeState[] = []
    const awake = keepScreenAwake((s) => states.push(s), device.nav, device.doc)
    await settle()
    expect(states).toEqual(['on'])

    // The browser drops the lock when the page is hidden; coming back asks for a new one.
    device.locks[0].fireRelease()
    device.show('hidden')
    device.show('visible')
    await settle()
    expect(states).toEqual(['on', 'off', 'on'])
    expect(device.locks).toHaveLength(2)

    awake.release()
    expect(device.locks[1].released).toBe(true)
    expect(device.listeners.size).toBe(0)
  })

  it('does not ask while the page is hidden', async () => {
    const device = fakeDevice(false)
    keepScreenAwake(() => {}, device.nav, device.doc)
    await settle()
    expect(device.locks).toHaveLength(0)
  })

  it('says so when the device cannot do it, and when it refuses', async () => {
    const none: WakeState[] = []
    keepScreenAwake((s) => none.push(s), {}, fakeDevice().doc)
    expect(none).toEqual(['unsupported'])

    const refused: WakeState[] = []
    keepScreenAwake((s) => refused.push(s), { wakeLock: { request: async () => Promise.reject(new Error('NotAllowedError')) } }, fakeDevice().doc)
    await settle()
    expect(refused).toEqual(['off'])
  })

  it('releases a lock that arrives after it was already stopped', async () => {
    const device = fakeDevice()
    const awake = keepScreenAwake(() => {}, device.nav, device.doc)
    awake.release() // before the request settles
    await settle()
    expect(device.locks[0].released).toBe(true)
  })
})
