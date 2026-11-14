import { useEffect, useState } from 'react'
import { canEdit, SignIn, useAuth } from './auth'
import NowPage from './prep/NowPage'
import PrintPage from './print/PrintPage'
import PlanPage from './plan/PlanPage'
import RestorePage from './library/RestorePage'
import ImportPage from './library/ImportPage'
import LibraryPage from './library/LibraryPage'
import CookMode from './cook/CookMode'
import { backupState, loadBackupRuns, needsAttention, type BackupState } from './library/backupStatus'
import { checkIfDue, loadLibrary } from './library/onenote'
import { InstallHint, OfflineNotice, OutboxNotice } from './offline/Status'
import { useFlushWhenOnline } from './offline/useOutbox'
import { Notice } from './ui'
import OneNotePage from './library/OneNotePage'
import TrashPage from './library/TrashPage'
import RecipeEditor from './library/RecipeEditor'
import RecipePage from './library/RecipePage'
import { href, useRoute, type Route } from './router'
import { applyTheme, loadPreference, resolveTheme, savePreference, type ThemePreference } from './theme'

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'حسب الجهاز' },
  { value: 'light', label: 'فاتح' },
  { value: 'dark', label: 'داكن' },
]

// The Microsoft sign-in returns to /?ms=…#/onenote (the OneNote page); without a page, go there.
if (new URLSearchParams(window.location.search).has('ms') && !window.location.hash) window.location.hash = href.onenote

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

// For the owner: a notice when the nightly backup is failing or has stopped.
function useBackupAlert(enabled: boolean): BackupState | null {
  const [state, setState] = useState<BackupState | null>(null)
  useEffect(() => {
    if (!enabled) return
    loadBackupRuns(5).then((runs) => setState(backupState(runs)), () => undefined)
  }, [enabled])
  return state && needsAttention(state) ? state : null
}

const NAV: Array<{ label: string; to: string; match: Route['name'][]; editorsOnly?: boolean }> = [
  { label: 'الوصفات', to: href.library, match: ['library', 'recipe'] },
  { label: 'الخطة', to: href.plan(), match: ['plan'] },
  { label: 'الآن', to: href.now, match: ['now'] },
  { label: 'وصفة جديدة', to: href.new, match: ['new'], editorsOnly: true },
  { label: 'استيراد', to: href.import, match: ['import'], editorsOnly: true },
  { label: 'OneNote', to: href.onenote, match: ['onenote'], editorsOnly: true },
]

export default function App() {
  const [pref, choosePref] = useThemePreference()
  const route = useRoute()
  const auth = useAuth()
  const editor = canEdit(auth.role)
  // Cook mode shows only the recipe: no title bar, menu or reminders.
  const cooking = route.name === 'cook'
  useNotebookCheck(auth.session != null && editor)
  const backupAlert = useBackupAlert(auth.session != null && editor)
  useFlushWhenOnline(auth.ready && auth.session != null)

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-5 px-4 py-5 print:max-w-none print:px-0 print:py-0">
      {!cooking && <header className="flex flex-wrap items-center justify-between gap-3 print:hidden">
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
      </header>}

      {auth.session && !cooking && (
        <nav aria-label="الأقسام الرئيسية" className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 print:hidden">
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
        {auth.session && <div className="flex flex-col gap-3 print:hidden"><OfflineNotice /><OutboxNotice /></div>}
        {backupAlert && !cooking && (
          <div className="print:hidden">
            <Notice tone="error">
              النسخ الاحتياطي الليلي يحتاج انتباهك. <a href={href.onenote} className="underline">افتحي صفحة OneNote</a> لترين السبب.
            </Notice>
          </div>
        )}
        {!auth.ready ? null : !auth.session ? <SignIn /> : <Screen route={route} editor={editor} userId={auth.session.user.id} />}
        {auth.session && !cooking && <div className="print:hidden"><InstallHint /></div>}
      </main>
    </div>
  )
}

function Screen({ route, editor, userId }: { route: Route; editor: boolean; userId: string }) {
  switch (route.name) {
    case 'library':
      return <LibraryPage canEdit={editor} />
    case 'recipe':
      return <RecipePage key={route.id} id={route.id} canEdit={editor} userId={userId} startLogging={route.logging === true} />
    case 'edit':
      return editor ? <RecipeEditor key={route.id} id={route.id} /> : <RecipePage id={route.id} canEdit={false} userId={userId} />
    case 'new':
      return editor ? <RecipeEditor key="new" id={null} /> : <LibraryPage canEdit={false} />
    case 'import':
      return editor ? <ImportPage /> : <LibraryPage canEdit={false} />
    case 'cook':
      return <CookMode key={route.id} id={route.id} />
    case 'now':
      return <NowPage canEdit={editor} />
    case 'print':
      return <PrintPage week={route.week} withTasks={route.tasks} />
    case 'plan':
      return <PlanPage canEdit={editor} week={route.week} />
    case 'restore':
      return editor ? <RestorePage /> : <LibraryPage canEdit={false} />
    case 'trash':
      return editor ? <TrashPage /> : <LibraryPage canEdit={false} />
    case 'onenote':
      return editor ? <OneNotePage /> : <LibraryPage canEdit={false} />
  }
}
