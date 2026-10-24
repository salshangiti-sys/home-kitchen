import { useEffect, useState } from 'react'
import { applyTheme, loadPreference, resolveTheme, savePreference, type ThemePreference } from './theme'

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'حسب الجهاز' },
  { value: 'light', label: 'فاتح' },
  { value: 'dark', label: 'داكن' },
]

// Lines that mix Arabic, English words and both digit systems, to check bidi and font coverage.
const SAMPLE_LINES = [
  'سلطة mixed leaves مع صوص الليمون',
  '2 كوب طحين + ½ ملعقة صغيرة baking powder',
  'الأرقام الغربية: 0123456789',
  'الأرقام في المصدر: ٠١٢٣٤٥٦٧٨٩',
]

const WEIGHTS = [
  { className: 'font-normal', label: 'عادي 400' },
  { className: 'font-medium', label: 'متوسط 500' },
  { className: 'font-semibold', label: 'شبه عريض 600' },
  { className: 'font-bold', label: 'عريض 700' },
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
          <h2 className="mb-2 text-lg font-semibold">المرحلة 0: هيكل التطبيق</h2>
          <p className="leading-relaxed text-muted">
            هذه الصفحة للتحقق من الخط واتجاه الكتابة والوضعين الفاتح والداكن فقط. لا توجد وصفات أو بيانات أو مزامنة بعد.
          </p>
        </section>

        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="mb-3 text-lg font-semibold">عينة النصوص المختلطة</h2>
          <ul className="flex list-disc flex-col gap-2 ps-5">
            {SAMPLE_LINES.map((line) => (
              <li key={line} dir="auto" className="leading-relaxed">
                {line}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="mb-3 text-lg font-semibold">أوزان الخط</h2>
          <div className="flex flex-col gap-2">
            {WEIGHTS.map((weight) => (
              <p key={weight.label} className={`text-lg ${weight.className}`}>
                {weight.label}: مقادير الكبسة والصوص · IBM Plex Sans Arabic
              </p>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
