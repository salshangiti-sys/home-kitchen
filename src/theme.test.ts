import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadPreference, resolveTheme, savePreference } from './theme'

describe('resolveTheme', () => {
  it('follows the device when the preference is system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('keeps a fixed choice regardless of the device', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('theme preference storage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('round-trips a saved preference', () => {
    savePreference('dark')
    expect(loadPreference()).toBe('dark')
  })

  it('ignores unknown stored values', () => {
    localStorage.setItem('hk-theme', 'purple')
    expect(loadPreference()).toBe('system')
  })

  it('falls back to system when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(loadPreference()).toBe('system')
  })
})
