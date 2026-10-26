import { useEffect, useState } from 'react'
import { canEdit, SignIn, useAuth } from './auth'
import ImportPage from './library/ImportPage'
import LibraryPage from './library/LibraryPage'
import { checkIfDue, loadLibrary } from './library/onenote'
import OneNotePage from './library/OneNotePage'
import RecipeEditor from './library/RecipeEditor'
import RecipePage from './library/RecipePage'
import { href, useRoute, type Route } from './router'
import SyncLab from './spike/SyncLab'
import { applyTheme, loadPreference, resolveTheme, savePreference, type ThemePreference } from './theme'

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'حسب الجهاز' },
  { value: 'light', label: 'فاتح' },
  { value: 'dark', label: 'داكن' },
]

// The Microsoft sign-in returns to /?ms=… (the lab) or /?ms=…#/onenote (the OneNote page).
if (new URLSearchParams(window.location.search).has('ms') && !window.location.hash) window.location.hash = href.lab

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

// While the app is open, look in the recipe notebook for new and changed pages every few hours.
function useNotebookCheck(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const run = () => loadLibrary().then(checkIfDue, () => undefined)
    run()
    const timer = window.setInterval(run, 15 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [enabled])
}

const NAV: Array<{ label: string; to: string; match: Route['name'][]; editorsOnly?: boolean }> = [
  { label: 'الوصفات', to: href.library, match: ['library', 'recipe'] },
  { label: 'وصفة جديدة', to: href.new, match: ['new'], editorsOnly: true },
  { label: 'استيراد', to: href.import, match: ['import'], editorsOnly: true },
  { label: 'OneNote', to: href.onenote, match: ['onenote', 'lab'], editorsOnly: true },
]

export default function App() {
  const [pref, choosePref] = useThemePreference()
  const route = useRoute()
  const auth = useAuth()
  const editor = canEdit(auth.role)
  useNotebookCheck(auth.session != null && editor)

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-5 px-4 py-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <a href={href.library}>
          <h1 className="text-2xl font-bold">مطبخ البيت</h1>
        </a>
        <div role="radiogroup" aria-label="المظهر" className="flex rounded-xl border border-line bg-surface p-1">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={pref === option.value}
              onClick={() => choosePref(option.value)}
              className={`min-h-9 rounded-lg px-3 text-sm font-medium transition-colors ${
                pref === option.value ? 'bg-accent text-on-accent' : 'text-muted hover:text-ink'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      {auth.session && (
        <nav aria-label="الأقسام الرئيسية" className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4">
          {NAV.filter((item) => editor || !item.editorsOnly).map((item) => {
            const active = item.match.includes(route.name) || (route.name === 'edit' && item.to === href.library)
            return (
              <a
                key={item.to}
                href={item.to}
                aria-current={active ? 'page' : undefined}
                className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium ${active ? 'border-accent text-ink' : 'border-transparent text-muted'}`}
              >
                {item.label}
              </a>
            )
          })}
        </nav>
      )}

      <main className="flex flex-col gap-6 pb-10">
        {!auth.ready ? null : !auth.session ? <SignIn /> : <Screen route={route} editor={editor} userId={auth.session.user.id} />}
      </main>
    </div>
  )
}

function Screen({ route, editor, userId }: { route: Route; editor: boolean; userId: string }) {
  switch (route.name) {
    case 'library':
      return <LibraryPage canEdit={editor} />
    case 'recipe':
      return <RecipePage key={route.id} id={route.id} canEdit={editor} userId={userId} />
    case 'edit':
      return editor ? <RecipeEditor key={route.id} id={route.id} /> : <RecipePage id={route.id} canEdit={false} userId={userId} />
    case 'new':
      return editor ? <RecipeEditor key="new" id={null} /> : <LibraryPage canEdit={false} />
    case 'import':
      return editor ? <ImportPage /> : <LibraryPage canEdit={false} />
    case 'onenote':
      return editor ? <OneNotePage /> : <LibraryPage canEdit={false} />
    case 'lab':
      return (
        <>
          <section className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="mb-2 text-lg font-semibold">مختبر مزامنة OneNote (المرحلة 0)</h2>
            <p className="leading-relaxed text-muted">
              أداة اختبار للمزامنة مع الدفتر التجريبي فقط. وصفاته منفصلة عن مكتبة الوصفات، ولا يقرأ ولا يكتب في دفتر الوصفات الحقيقي.
            </p>
          </section>
          <SyncLab />
        </>
      )
  }
}
