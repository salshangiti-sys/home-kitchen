import { useEffect, useState } from 'react'
import { canEdit, SignIn, useAuth } from './auth'
import NowPage from './prep/NowPage'
import PrintPage from './print/PrintPage'
import ReviewPage from './ingredients/ReviewPage'
import FreezerPage from './freezer/FreezerPage'
import OverviewPage, { PENDING_EVENT } from './review/OverviewPage'
import { updateNow, useUpdateAvailable } from './update'
import ShoppingPage from './shopping/ShoppingPage'
import DictionaryPage from './shopping/DictionaryPage'
import { LessonsProvider } from './shopping/LessonsContext'
import PlanPage from './plan/PlanPage'
import RestorePage from './library/RestorePage'
import ImportPage from './library/ImportPage'
import LibraryPage from './library/LibraryPage'
import CookMode from './cook/CookMode'
import { backupState, loadBackupRuns, needsAttention, type BackupState } from './library/backupStatus'
import { checkIfDue, listUnlinked, loadLibrary } from './library/onenote'
import { InstallHint, OfflineNotice, OutboxNotice } from './offline/Status'
import { useFlushWhenOnline } from './offline/useOutbox'
import { Notice } from './ui'
import OneNotePage from './library/OneNotePage'
import TrashPage from './library/TrashPage'
import RecipeEditor from './library/RecipeEditor'
import RecipePage from './library/RecipePage'
import { href, useRoute, type Route } from './router'
import { applyTheme, loadPreference, resolveTheme, savePreference, type ThemePreference } from './theme'
import Menu, { type MenuItem } from './Menu'

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

// How many new OneNote pages wait for approval (shown on the «مراجعة» tab). Read now and every few
// minutes, and updated at once when the review page approves one or checks the notebook.
function usePendingPages(enabled: boolean): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!enabled) return
    const read = () => listUnlinked().then((pages) => setCount(pages.length), () => undefined)
    const onEvent = (e: Event) => setCount(Number((e as CustomEvent<number>).detail) || 0)
    read()
    const timer = window.setInterval(read, 5 * 60 * 1000)
    window.addEventListener(PENDING_EVENT, onEvent)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener(PENDING_EVENT, onEvent)
    }
  }, [enabled])
  return count
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

const NAV: Array<{ label: string; hint: string; icon: string; to: string; match: Route['name'][]; editorsOnly?: boolean }> = [
  { label: 'الوصفات', hint: 'كل وصفاتكِ: ابحثي وصفّي وافتحي الوصفة', icon: '📖', to: href.library, match: ['library', 'recipe'] },
  { label: 'الخطة', hint: 'خططي وجبات الأسبوع لكل فرد', icon: '🗓', to: href.plan(), match: ['plan'] },
  { label: 'الآن', hint: 'ما عليكِ اليوم: وجبات وتجهيزات وإذابة', icon: '⏰', to: href.now, match: ['now'] },
  { label: 'المقاضي', hint: 'قائمة الشراء من خطة الأسبوع', icon: '🛒', to: href.shopping(), match: ['shopping'] },
  { label: 'الفريزر', hint: 'ما عندكِ مجمّدًا وكميته', icon: '❄️', to: href.freezer, match: ['freezer'] },
  { label: 'المقادير', hint: 'راجعي مقادير الوصفات واعتمديها', icon: '🧂', to: href.ingredients, match: ['ingredients'], editorsOnly: true },
  { label: 'مراجعة', hint: 'راجعي الوسوم والتجهيزات واعتمدي الجديد', icon: '✅', to: href.overview, match: ['overview'], editorsOnly: true },
  { label: 'استيراد', hint: 'استوردي ملف وصفات دفعة واحدة', icon: '📥', to: href.import, match: ['import'], editorsOnly: true },
  { label: 'OneNote', hint: 'ربط دفتر OneNote وفحص الصفحات والنسخ الاحتياطي', icon: '📓', to: href.onenote, match: ['onenote'], editorsOnly: true },
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
  const waiting = usePendingPages(auth.session != null && editor)
  const updateAvailable = useUpdateAvailable()
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => setMenuOpen(false), [route])
  useFlushWhenOnline(auth.ready && auth.session != null)

  const items: MenuItem[] = NAV.filter((item) => editor || !item.editorsOnly).map((item) => ({
    label: item.label,
    hint: item.hint,
    to: item.to,
    icon: item.icon,
    active: item.match.includes(route.name) || (route.name === 'edit' && item.to === href.library),
    badge: item.to === href.overview ? waiting : undefined,
  }))
  const current = items.find((item) => item.active)

  return (
    <LessonsProvider signedIn={auth.ready && auth.session != null}>
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-5 px-4 py-5 print:max-w-none print:px-0 print:py-0">
      {updateAvailable && !cooking && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-accent bg-surface p-3 text-sm print:hidden">
          <span>يتوفر إصدار جديد من التطبيق.</span>
          <button type="button" onClick={() => void updateNow()} className="min-h-10 rounded-xl bg-accent px-4 font-medium text-on-accent">
            حدّثي الآن
          </button>
        </div>
      )}
      {!cooking && (
        <header className="flex items-center gap-3 print:hidden">
          {auth.session && (
            <button
              type="button"
              aria-label="القائمة"
              aria-haspopup="dialog"
              onClick={() => setMenuOpen(true)}
              className="relative grid size-11 shrink-0 place-items-center rounded-2xl bg-accent-soft text-xl text-accent"
            >
              <span aria-hidden>☰</span>
              {waiting > 0 && <span aria-label={`${waiting} تنتظر المراجعة`} className="absolute -end-1 -top-1 size-3 rounded-full border-2 border-bg bg-accent" />}
            </button>
          )}
          <a href={href.library} className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-bold text-accent">{auth.session && current ? current.label : 'مطبخ البيت'}</h1>
          </a>
        </header>
      )}
      {auth.session && !cooking && (
        <Menu open={menuOpen} items={items} pref={pref} onTheme={choosePref} onClose={() => setMenuOpen(false)} />
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
    </LessonsProvider>
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
    case 'dictionary':
      return <DictionaryPage canEdit={editor} />
    case 'shopping':
      return <ShoppingPage key={route.week ?? 'this'} canEdit={editor} week={route.week} />
    case 'ingredients':
      return <ReviewPage canEdit={editor} />
    case 'freezer':
      return <FreezerPage canEdit={editor} />
    case 'overview':
      return editor ? <OverviewPage /> : <LibraryPage canEdit={false} />
    case 'print':
      return <PrintPage week={route.week} withTasks={route.tasks} withShopping={route.shopping === true} />
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
