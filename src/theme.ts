export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'hk-theme'

export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (pref === 'system') return systemPrefersDark ? 'dark' : 'light'
  return pref
}

// Storage can be unavailable (private browsing, blocked site data), so reads and writes never throw.
export function loadPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (value === 'light' || value === 'dark' || value === 'system') return value
  } catch {
    // fall through to the default
  }
  return 'system'
}

export function savePreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, pref)
  } catch {
    // the choice still applies for this visit
  }
}

export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme
}
