import { useEffect, useState } from 'react'
import SyncLab from './spike/SyncLab'
import { applyTheme, loadPreference, resolveTheme, savePreference, type ThemePreference } from './theme'

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'حسب الجهاز' },
  { value: 'light', label: 'فاتح' },
  { value: 'dark', label: 'داكن' },
]

function useThemePreference() {
  const [pref, setPref] = useState<ThemePreference>(loadPreference)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => applyTheme(resolveTheme(pref, media.matches))
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [pref])

  const choose = (next: ThemePreference) => {
    savePreference(next)
    setPref(next)
  }

  return [pref, choose] as const
}

export default function App() {
  const [pref, choosePref] = useThemePreference()

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">مطبخ البيت</h1>
        <div role="radiogroup" aria-label="المظهر" className="flex rounded-xl border border-line bg-surface p-1">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={pref === option.value}
              onClick={() => choosePref(option.value)}
              className={`min-h-11 rounded-lg px-4 text-sm font-medium transition-colors ${
                pref === option.value ? 'bg-accent text-on-accent' : 'text-muted hover:text-ink'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <main className="flex flex-col gap-6">
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="mb-2 text-lg font-semibold">المرحلة 0: مختبر مزامنة OneNote</h2>
          <p className="leading-relaxed text-muted">
            أداة اختبار للمزامنة مع الدفتر التجريبي فقط. ليست مكتبة الوصفات، ولا تقرأ ولا تكتب في دفتر الوصفات الحقيقي.
          </p>
        </section>

        <SyncLab />
      </main>
    </div>
  )
}
