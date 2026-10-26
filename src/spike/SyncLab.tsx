// Phase 0 sync lab: sign in, connect Microsoft, create the test notebook, and edit/sync test
// recipes against it. A testing tool for the OneNote spike, not the recipe library.

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { callFunction, supabase } from '../lib/supabase'
import { SignIn } from '../auth'
import { SAMPLE_SECTIONS, sectionsToText, textToSections, type SectionsText } from './sectionsText'
import type { RecipeSections } from '../../supabase/functions/_shared/onenote/sections.ts'

interface Recipe {
  id: string
  title: string
  sections: RecipeSections
  version: number
}

interface Link {
  recipe_id: string
  page_id: string | null
  web_url: string | null
  client_url: string | null
  sync_status: string
  last_synced_at: string | null
  last_error: string | null
  parse_method: string | null
  next_retry_at: string | null
}

interface Conflict {
  id: string
  recipe_id: string
  section_key: string
  local: unknown
  remote: unknown
}

interface SyncOutcome {
  status: string
  created: boolean
  pushed: string[]
  pulled: string[]
  conflicts: string[]
  needsRepair: string[]
  error: string | null
}

const STATUS_LABELS: Record<string, string> = {
  synced: 'متزامنة',
  pending: 'بانتظار المزامنة',
  failed: 'فشلت المزامنة',
  conflict: 'تعارض يحتاج قرارًا',
  remote_deleted: 'الصفحة محذوفة في OneNote',
  needs_reconnect: 'يلزم إعادة ربط Microsoft',
  needs_review: 'موقوفة: الصفحة تحتاج مراجعة في OneNote',
}

const KEY_LABELS: Record<string, string> = {
  title: 'العنوان',
  src: 'المصدر',
  ing: 'المقادير',
  steps: 'الطريقة',
  notes: 'ملاحظاتي',
}

const MS_RETURN_MESSAGES: Record<string, string> = {
  connected: 'تم ربط حساب Microsoft.',
  cancelled: 'أُلغي الربط من صفحة Microsoft.',
  expired: 'انتهت مهلة الربط، حاول مرة أخرى.',
  error: 'تعذّر إكمال الربط. حاول مرة أخرى.',
}

const keys = (list: string[]) => list.map((key) => KEY_LABELS[key] ?? key).join('، ')

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function Button({ children, onClick, disabled, kind = 'primary' }: { children: ReactNode; onClick: () => void; disabled?: boolean; kind?: 'primary' | 'plain' }) {
  const look = kind === 'primary' ? 'bg-accent text-on-accent' : 'border border-line text-ink'
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`min-h-11 rounded-xl px-4 text-sm font-medium disabled:opacity-50 ${look}`}>
      {children}
    </button>
  )
}

function describeOutcome(outcome: SyncOutcome): string {
  const parts = [STATUS_LABELS[outcome.status] ?? outcome.status]
  if (outcome.created) parts.push('أُنشئت الصفحة في OneNote')
  else {
    if (outcome.pushed.length) parts.push(`أُرسل إلى OneNote: ${keys(outcome.pushed)}`)
    if (outcome.pulled.length) parts.push(`أُخذ من OneNote: ${keys(outcome.pulled)}`)
  }
  if (outcome.conflicts.length) parts.push(`تعارض في: ${keys(outcome.conflicts)}`)
  if (outcome.needsRepair.length) parts.push(`أقسام قُرئت ولم يكتبها التطبيق (قوائم OneNote أو جداول أو صور، أو فقدت علامتها): ${keys(outcome.needsRepair)}`)
  if (outcome.error) parts.push(outcome.error)
  return parts.join(' · ')
}

function RecipeEditor({
  recipe,
  link,
  conflicts,
  onChanged,
}: {
  recipe: Recipe
  link: Link | undefined
  conflicts: Conflict[]
  onChanged: () => Promise<void>
}) {
  const [title, setTitle] = useState(recipe.title)
  const [text, setText] = useState<SectionsText>(() => sectionsToText(recipe.sections))
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setTitle(recipe.title)
    setText(sectionsToText(recipe.sections))
  }, [recipe])

  const run = async (work: () => Promise<string>) => {
    setBusy(true)
    setMessage(null)
    try {
      setMessage(await work())
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      await onChanged()
      setBusy(false)
    }
  }

  const save = () =>
    run(async () => {
      const { data, error } = await supabase
        .from('spike_recipes')
        .update({ title, sections: textToSections(text), version: recipe.version + 1, updated_at: new Date().toISOString() })
        .eq('id', recipe.id)
        .eq('version', recipe.version)
        .select('id')
      if (error) throw error
      if (!data.length) return 'لم يُحفظ: تغيّرت الوصفة من مكان آخر. أُعيد تحميلها.'
      return 'تم الحفظ في التطبيق. لم تُزامن مع OneNote بعد.'
    })

  const sync = () => run(async () => describeOutcome(await callFunction<SyncOutcome>('onenote-sync', { action: 'sync', recipeId: recipe.id })))

  const resolve = (key: string, choice: 'local' | 'remote') =>
    run(async () => describeOutcome(await callFunction<SyncOutcome>('onenote-sync', { action: 'resolve', recipeId: recipe.id, key, choice })))

  const field = (key: keyof SectionsText, rows: number, hint: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{KEY_LABELS[key]}</span>
      <textarea
        dir="auto"
        rows={rows}
        value={text[key]}
        onChange={(e) => setText({ ...text, [key]: e.target.value })}
        className="rounded-xl border border-line bg-bg p-3 leading-relaxed"
      />
      <span className="text-xs text-muted">{hint}</span>
    </label>
  )

  return (
    <Card title={recipe.title}>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full border border-line px-3 py-1">{link ? (STATUS_LABELS[link.sync_status] ?? link.sync_status) : 'لم تُنشأ في OneNote بعد'}</span>
        {link?.last_synced_at && <span className="text-muted">آخر مزامنة: {new Date(link.last_synced_at).toLocaleString('ar-SA-u-nu-latn')}</span>}
        {link?.web_url && (
          <a href={link.web_url} target="_blank" rel="noreferrer" className="text-accent underline">
            افتح في OneNote (الويب)
          </a>
        )}
        {link?.client_url && (
          <a href={link.client_url} className="text-accent underline">
            افتح في تطبيق OneNote
          </a>
        )}
      </div>
      {link?.last_error && <p className="mb-3 text-sm text-red-600" dir="auto">{link.last_error}</p>}

      {conflicts.map((conflict) => (
        <div key={conflict.id} className="mb-4 rounded-xl border border-amber-500 p-3">
          <p className="mb-2 font-medium">تعارض في «{KEY_LABELS[conflict.section_key]}»: تغيّر في التطبيق وفي OneNote. لم يُستبدل أي منهما.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <pre dir="auto" className="whitespace-pre-wrap rounded-lg bg-bg p-2 text-sm">التطبيق:{'\n'}{JSON.stringify(conflict.local, null, 1)}</pre>
            <pre dir="auto" className="whitespace-pre-wrap rounded-lg bg-bg p-2 text-sm">OneNote:{'\n'}{JSON.stringify(conflict.remote, null, 1)}</pre>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button onClick={() => resolve(conflict.section_key, 'local')} disabled={busy}>أبقِ نسخة التطبيق</Button>
            <Button onClick={() => resolve(conflict.section_key, 'remote')} disabled={busy} kind="plain">أبقِ نسخة OneNote</Button>
          </div>
        </div>
      ))}

      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">العنوان</span>
          <input dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} className="min-h-11 rounded-xl border border-line bg-bg px-3" />
        </label>
        {field('src', 2, 'سطر لكل مصدر: «الاسم | الرابط» أو رابط فقط')}
        {field('ing', 6, 'سطر لكل مكوّن. سطر يبدأ بـ «## » يبدأ مجموعة فرعية مثل ## الصوص')}
        {field('steps', 5, 'سطر لكل خطوة')}
        {field('notes', 3, 'سطر لكل ملاحظة')}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={save} disabled={busy} kind="plain">احفظ «{recipe.title}» في التطبيق</Button>
        <Button onClick={sync} disabled={busy}>زامن «{recipe.title}» مع OneNote</Button>
      </div>
      {message && <p className="mt-3 text-sm" dir="auto">{message}</p>}
    </Card>
  )
}

export default function SyncLab() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [householdId, setHouseholdId] = useState<string | null>(null)
  const [connection, setConnection] = useState<{ status: string; display_name: string | null } | null>(null)
  const [notebook, setNotebook] = useState<{ notebook_name: string } | null>(null)
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [links, setLinks] = useState<Link[]>([])
  const [conflicts, setConflicts] = useState<Conflict[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ms = params.get('ms')
    if (ms) {
      setNotice(MS_RETURN_MESSAGES[ms] ?? null)
      params.delete('ms')
      window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`)
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  const load = useCallback(async () => {
    const [conn, nb, rec, lnk, con] = await Promise.all([
      supabase.from('ms_connections').select('status,display_name').maybeSingle(),
      supabase.from('onenote_allowed_notebooks').select('notebook_name').limit(1).maybeSingle(),
      supabase.from('spike_recipes').select('id,title,sections,version').order('created_at'),
      supabase.from('onenote_links').select('recipe_id,page_id,web_url,client_url,sync_status,last_synced_at,last_error,parse_method,next_retry_at'),
      supabase.from('sync_conflicts').select('id,recipe_id,section_key,local,remote').is('resolved_at', null),
    ])
    setConnection(conn.data)
    setNotebook(nb.data)
    setRecipes((rec.data ?? []) as Recipe[])
    setLinks((lnk.data ?? []) as Link[])
    setConflicts((con.data ?? []) as Conflict[])
  }, [])

  useEffect(() => {
    if (!session) return
    supabase.rpc('ensure_own_household').then(({ data }) => {
      setHouseholdId(data as string)
      void load()
    })
  }, [session, load])

  const act = async (work: () => Promise<void>) => {
    setBusy(true)
    setNotice(null)
    try {
      await work()
    } catch (error) {
      setNotice((error as Error).message)
    } finally {
      await load()
      setBusy(false)
    }
  }

  if (!ready) return null
  if (!session) return <SignIn />

  const connectMicrosoft = () =>
    act(async () => {
      const { url } = await callFunction<{ url: string }>('ms-oauth-start', { returnTo: `${window.location.origin}/` })
      window.location.assign(url)
    })

  const setupNotebook = () =>
    act(async () => {
      const result = await callFunction<{ notebookName: string }>('onenote-sync', { action: 'setup-test-notebook' })
      setNotice(`الدفتر التجريبي جاهز: ${result.notebookName}`)
    })

  const runRtlProbe = () =>
    act(async () => {
      const result = await callFunction<{ pages: Array<{ title: string }> }>('onenote-sync', { action: 'rtl-probe' })
      setNotice(`أُنشئت صفحات الاختبار في «تجربة 1»: ${result.pages.map((page) => page.title).join('، ')}`)
    })

  const runPatchProbe = () =>
    act(async () => {
      type Trial = { name: string; ok: boolean; status: number | null; error: string | null; mismatched: string[]; requests: string[][] }
      const result = await callFunction<{ trials: Trial[] }>('onenote-sync', { action: 'patch-probe' })
      const lines = result.trials.map((t, i) => {
        const request = t.ok ? `قُبل (${t.requests.length} طلبات)` : `رُفض (${t.status ?? '-'}) ${t.error ?? ''}`
        const verdict = t.mismatched.length ? `الصفحة غير مطابقة: ${t.mismatched.join('، ')}` : 'الصفحة مطابقة'
        return `${i + 1}. ${t.name}\n   ${request} — ${verdict}`
      })
      setNotice(`نتيجة اختبار التعديل (صفحة جديدة في «تجربة 1»):\n${lines.join('\n')}`)
    })

  // One at a time, to stay well inside OneNote's request limits.
  const syncAll = () =>
    act(async () => {
      const lines: string[] = []
      for (const recipe of recipes) {
        const outcome = await callFunction<SyncOutcome>('onenote-sync', { action: 'sync', recipeId: recipe.id })
        lines.push(`«${recipe.title}»: ${describeOutcome(outcome)}`)
      }
      setNotice(lines.join('\n'))
    })

  const addRecipe = () =>
    act(async () => {
      const id = `test-${Date.now().toString(36)}`
      const { error } = await supabase
        .from('spike_recipes')
        .insert({ id, household_id: householdId, title: `وصفة تجريبية ${recipes.length + 1}`, sections: SAMPLE_SECTIONS })
      if (error) throw error
    })

  return (
    <div className="flex flex-col gap-6">
      {notice && <p className="whitespace-pre-line rounded-xl border border-line bg-surface p-3 text-sm" dir="auto">{notice}</p>}

      <Card title="الخطوة 1: حساب Microsoft">
        <p className="mb-3 text-sm text-muted">
          {connection
            ? connection.status === 'connected'
              ? `مرتبط${connection.display_name ? ` (${connection.display_name})` : ''}.`
              : 'الربط انتهى أو أُلغي. يلزم الربط من جديد.'
            : 'غير مرتبط بعد.'}
        </p>
        <Button onClick={connectMicrosoft} disabled={busy} kind={connection?.status === 'connected' ? 'plain' : 'primary'}>
          {connection ? 'أعد ربط Microsoft' : 'اربط حساب Microsoft'}
        </Button>
      </Card>

      <Card title="الخطوة 2: الدفتر التجريبي">
        <p className="mb-3 text-sm text-muted">
          {notebook ? `الكتابة مسموحة في «${notebook.notebook_name}» فقط.` : 'لا يوجد دفتر مسموح بعد. لن يكتب التطبيق في أي دفتر آخر.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={setupNotebook} disabled={busy || connection?.status !== 'connected'} kind={notebook ? 'plain' : 'primary'}>
            {notebook ? 'تحقق من الدفتر التجريبي' : 'أنشئ الدفتر التجريبي'}
          </Button>
          {notebook && (
            <Button onClick={runRtlProbe} disabled={busy} kind="plain">
              اختبار اتجاه النص
            </Button>
          )}
          {notebook && (
            <Button onClick={runPatchProbe} disabled={busy} kind="plain">
              اختبار التعديل
            </Button>
          )}
        </div>
      </Card>

      <Card title="الخطوة 3: وصفات التجربة">
        <div className="flex flex-wrap gap-2">
          <Button onClick={syncAll} disabled={busy || !recipes.length || !notebook}>
            زامن كل وصفات التجربة ({recipes.length})
          </Button>
          <Button onClick={addRecipe} disabled={busy || !householdId} kind="plain">
            أضف وصفة تجريبية
          </Button>
        </div>
      </Card>

      {recipes.map((recipe) => (
        <RecipeEditor
          key={recipe.id}
          recipe={recipe}
          link={links.find((l) => l.recipe_id === recipe.id)}
          conflicts={conflicts.filter((c) => c.recipe_id === recipe.id)}
          onChanged={load}
        />
      ))}

      <p className="text-center text-sm text-muted">
        <button type="button" className="underline" onClick={() => supabase.auth.signOut()}>
          تسجيل الخروج
        </button>
      </p>
    </div>
  )
}
