// The side menu: one button in the title bar opens a list of every section, with the theme choice at its end.

import { useEffect, useRef } from 'react'
import type { ThemePreference } from './theme'

export interface MenuItem {
  label: string
  hint: string
  to: string
  icon: string
  active: boolean
  badge?: number
}

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'حسب الجهاز' },
  { value: 'light', label: 'فاتح' },
  { value: 'dark', label: 'داكن' },
]

export default function Menu({
  open,
  items,
  pref,
  onTheme,
  onClose,
}: {
  open: boolean
  items: MenuItem[]
  pref: ThemePreference
  onTheme: (next: ThemePreference) => void
  onClose: () => void
}) {
  const first = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    if (!open) return
    first.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 print:hidden">
      <div data-testid="menu-backdrop" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-label="القائمة" className="absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col gap-4 overflow-y-auto bg-surface p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <span className="text-lg font-bold text-accent">مطبخ البيت</span>
          <button type="button" aria-label="إغلاق القائمة" onClick={onClose} className="grid size-10 place-items-center rounded-full text-xl text-muted">
            ×
          </button>
        </div>
        <nav aria-label="الأقسام الرئيسية" className="flex flex-col gap-1">
          {items.map((item, index) => (
            <a
              key={item.to}
              ref={index === 0 ? first : undefined}
              href={item.to}
              onClick={onClose}
              aria-current={item.active ? 'page' : undefined}
              className={`flex min-h-14 items-center gap-3 rounded-2xl px-3 py-1.5 text-base font-medium ${item.active ? 'bg-accent-soft text-accent' : 'text-ink'}`}
            >
              <span aria-hidden className="text-xl">{item.icon}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span>{item.label}</span>
                <span className="text-xs font-normal text-muted">{item.hint}</span>
              </span>
              {item.badge ? <span className="grid min-w-6 place-items-center rounded-full bg-accent px-2 text-xs font-medium text-on-accent">{item.badge}</span> : null}
            </a>
          ))}
        </nav>
        <div role="radiogroup" aria-label="المظهر" className="mt-auto flex rounded-2xl bg-bg p-1">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={pref === option.value}
              onClick={() => onTheme(option.value)}
              className={`min-h-10 flex-1 rounded-xl px-2 text-sm font-medium transition-colors ${pref === option.value ? 'bg-accent text-on-accent' : 'text-muted'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </aside>
    </div>
  )
}
