// The recipe notebook in OneNote: which notebook the app reads, pages found there that are not in
// the app yet (added or linked one at a time, by choice), and recipes whose page is gone.
// The app reads pages and creates new ones; it never changes or deletes a page.

import { useCallback, useEffect, useState } from 'react'
import { appHome, href, navigate } from '../router'
import { Button, Card, LinkButton, Notice } from '../ui'
import { listRecipes, type RecipeSummary } from './api'
import {
  addPageAsRecipe,
  checkNotebook,
  connectMicrosoft,
  connectPlace,
  linkImportedRecipes,
  linkPageToRecipe,
  listMissing,
  libraryLabel,
  listPlaces,
  listUnlinked,
  loadLibrary,
  msConnection,
  RECIPE_PLACE,
  timeAgo,
  type LibraryInfo,
  type MissingPage,
  type Place,
  type UnlinkedPage,
} from './onenote'

const MS_RETURN: Record<string, string> = {
  connected: 'تم ربط حساب Microsoft.',
  cancelled: 'أُلغي ربط حساب Microsoft.',
  expired: 'انتهت مهلة الربط. حاولي مرة أخرى.',
  error: 'تعذّر ربط حساب Microsoft. حاولي مرة أخرى.',
}

interface State {
  connection: { status: string; display_name: string | null } | null
  library: LibraryInfo | null
  unlinked: UnlinkedPage[]
  missing: MissingPage[]
  recipes: RecipeSummary[]
}

export default function OneNotePage() {
  const [state, setState] = useState<State | null>(null)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [placeId, setPlaceId] = useState<string | null>(null)
  const [changing, setChanging] = useState(false)
  const [places, setPlaces] = useState<Place[] | null>(null)

  const load = useCallback(async () => {
    const [connection, library, unlinked, missing, { recipes }] = await Promise.all([msConnection(), loadLibrary(), listUnlinked(), listMissing(), listRecipes()])
    setState({ connection, library, unlinked, missing, recipes })
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ms = params.get('ms')
    if (ms) {
      setNotice({ text: MS_RETURN[ms] ?? ms, error: ms !== 'connected' })
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`)
    }
    load().catch((e: Error) => setNotice({ text: e.message, error: true }))
  }, [load])

  // When choosing, list the account's notebooks and section groups, «الطبخ» first.
  const choosing = state?.connection?.status === 'connected' && (!state.library || changing)
  useEffect(() => {
    if (!choosing || places !== null) return
    setPlaces([])
    listPlaces().then(
      (list) => {
        const preferred = (place: Place) => (place.label.split(' › ').at(-1) === RECIPE_PLACE ? 0 : 1)
        const sorted = [...list].sort((a, b) => preferred(a) - preferred(b) || a.label.localeCompare(b.label, 'ar'))
        setPlaces(sorted)
        setPlaceId((current) => current ?? (sorted[0] && preferred(sorted[0]) === 0 ? sorted[0].id : null))
      },
      (e: Error) => setNotice({ text: e.message, error: true }),
    )
  }, [choosing, places])

  const act = async (work: () => Promise<string | void>) => {
    setBusy(true)
    setNotice(null)
    try {
      const text = await work()
      if (text) setNotice({ text })
    } catch (e) {
      setNotice({ text: (e as Error).message, error: true })
    } finally {
      await load().catch(() => undefined)
      setBusy(false)
    }
  }

  if (!state) return notice ? <Notice tone="error">{notice.text}</Notice> : <p className="text-muted">جارٍ التحميل…</p>
  const { connection, library, unlinked, missing, recipes } = state
  const connected = connection?.status === 'connected'

  const link = () =>
    act(async () => {
      const linked = await connectPlace(placeId!)
      setChanging(false)
      const summary = await checkNotebook()
      return `رُبط «${linked.label}» (${linked.sections} قسم). وُجدت ${summary.pages} صفحة، منها ${summary.unlinked} ليست في التطبيق بعد.`
    })

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-2xl font-bold">OneNote</h2>
      <p className="leading-relaxed text-muted">
        تكتبين الوصفات في OneNote، والتطبيق يقرأ صفحاتها ولا يعدّلها ولا يحذفها أبدًا. يستطيع التطبيق إنشاء صفحة جديدة بالقالب عند إضافة وصفة، مرة واحدة فقط. الوسوم والمفضلة والتخطيط تبقى في التطبيق.
      </p>
      {notice && <Notice tone={notice.error ? 'error' : 'plain'}>{notice.text}</Notice>}

      <Card title="حساب Microsoft">
        {connected ? (
          <p>مربوط{connection.display_name ? ` (${connection.display_name})` : ''}.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <p>{connection?.status === 'needs_reconnect' ? 'انتهى ربط الحساب أو أُلغي. اربطيه من جديد ليقرأ التطبيق دفترك.' : 'اربطي حساب Microsoft الذي فيه دفتر الوصفات.'}</p>
            <div>
              <Button disabled={busy} onClick={() => act(() => connectMicrosoft(`${appHome()}${href.onenote}`))}>اربطي حساب Microsoft</Button>
            </div>
          </div>
        )}
      </Card>

      {connected && (
        <Card
          title="مكان الوصفات"
          actions={library && !changing ? <Button kind="plain" disabled={busy} onClick={() => setChanging(true)}>مكان آخر</Button> : undefined}
        >
          {library && !changing ? (
            <div className="flex flex-col gap-3">
              <p>
                مكان الوصفات: <strong dir="auto">{libraryLabel(library)}</strong> · {library.sections.length} قسم
              </p>
              <p className="text-sm text-muted">آخر فحص: {timeAgo(library.last_checked_at)}. يفحص التطبيق مكان الوصفات وحده كل بضع ساعات، ويقرأ الوصفة من جديد كلما فتحتِها.</p>
              {library.last_error && <Notice tone="error">آخر فحص لم يكتمل: {library.last_error}</Notice>}
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      const s = await checkNotebook()
                      return `فُحصت ${s.pages} صفحة. ليست في التطبيق: ${s.unlinked}. صفحات لم تعد موجودة: ${s.missing.length}. قُرئت ${s.refreshed} وصفة وتغيّرت ${s.changed}.`
                    })
                  }
                >
                  {busy ? 'جارٍ…' : 'افحصي الآن'}
                </Button>
                <Button
                  kind="plain"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      const r = await linkImportedRecipes()
                      return `رُبطت ${r.linked} وصفة مستوردة بصفحتها.${r.missing ? ` ${r.missing} لم تُعثر صفحتها.` : ''}${r.remaining ? ' بقيت وصفات أخرى، اضغطي مرة ثانية.' : ''}`
                    })
                  }
                >
                  اربطي الوصفات المستوردة بصفحاتها
                </Button>
              </div>
            </div>
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                link()
              }}
            >
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">أين وصفاتك في OneNote؟</legend>
                {!places?.length ? (
                  <p className="text-sm text-muted">جارٍ جلب الدفاتر…</p>
                ) : (
                  <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
                    {places.map((place) => (
                      <label key={place.id} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 ${place.id === placeId ? 'border-accent' : 'border-line'}`}>
                        <input type="radio" name="hk-place" className="accent-[var(--accent)]" checked={place.id === placeId} onChange={() => setPlaceId(place.id)} />
                        <span dir="auto">{place.label}</span>
                        <span className="ms-auto text-xs text-muted">{place.kind === 'notebook' ? 'دفتر' : 'مجموعة أقسام'}</span>
                      </label>
                    ))}
                  </div>
                )}
                <span className="text-xs text-muted">الربط يقرأ فقط: لا يُضاف شيء للتطبيق ولا يتغير شيء في OneNote. للتجربة اختاري «وصفات - تجربة».</span>
              </fieldset>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy || !placeId}>{busy ? 'جارٍ الربط…' : 'اربطي'}</Button>
                {library && <Button kind="plain" onClick={() => setChanging(false)}>إلغاء</Button>}
              </div>
            </form>
          )}
        </Card>
      )}

      {library && unlinked.length > 0 && (
        <Card title={`صفحات ليست في التطبيق (${unlinked.length})`}>
          <p className="mb-3 text-sm text-muted">أضيفي الصفحة كوصفة جديدة، أو اربطيها بوصفة موجودة إن كانت صفحتها نُقلت. لا يُضاف شيء وحده.</p>
          <ul className="flex flex-col divide-y divide-line">
            {unlinked.map((page) => (
              <UnlinkedRow key={page.page_id} page={page} recipes={recipes} busy={busy} act={act} />
            ))}
          </ul>
        </Card>
      )}

      {missing.length > 0 && (
        <Card title={`وصفات لم تعد صفحتها في الدفتر (${missing.length})`}>
          <p className="mb-3 text-sm text-muted">الوصفة باقية في التطبيق. إن نقلتِ الصفحة لقسم آخر ستظهر في «صفحات ليست في التطبيق»، فاربطيها بالوصفة من هناك.</p>
          <ul className="flex flex-col gap-2">
            {missing.map((m) => (
              <li key={m.recipe_id}>
                <a dir="auto" href={href.recipe(m.recipe_id)} className="text-accent underline">{m.title}</a>
                {m.section_name && <span className="text-sm text-muted"> · كانت في {m.section_name}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="text-sm text-muted">
        <a href={href.lab} className="underline">مختبر المزامنة (المرحلة 0)</a> للتجارب على الدفتر التجريبي فقط.
      </p>
    </div>
  )
}

function UnlinkedRow({ page, recipes, busy, act }: { page: UnlinkedPage; recipes: RecipeSummary[]; busy: boolean; act: (work: () => Promise<string | void>) => Promise<void> }) {
  const [linking, setLinking] = useState(false)
  const [target, setTarget] = useState('')

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span dir="auto" className="font-medium">{page.title || 'بدون عنوان'}</span>
        <span className="text-sm text-muted">{page.section_name}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy}
          onClick={() =>
            act(async () => {
              const { recipeId } = await addPageAsRecipe(page.page_id)
              navigate(href.recipe(recipeId))
            })
          }
        >
          أضيفيها كوصفة
        </Button>
        <Button kind="plain" disabled={busy} onClick={() => setLinking(!linking)}>اربطيها بوصفة موجودة</Button>
        {page.web_url && <LinkButton external href={page.web_url}>افتحي في OneNote ↗</LinkButton>}
      </div>
      {linking && (
        <div className="flex flex-wrap gap-2">
          <select value={target} onChange={(e) => setTarget(e.target.value)} className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3">
            <option value="">اختاري الوصفة…</option>
            {recipes.map((r) => (
              <option key={r.id} value={r.id}>{r.title} · {r.section}</option>
            ))}
          </select>
          <Button
            disabled={busy || !target}
            onClick={() =>
              act(async () => {
                const outcome = await linkPageToRecipe(page.page_id, target)
                return outcome.status === 'ok' ? 'رُبطت الصفحة بالوصفة وقُرئت.' : `رُبطت الصفحة لكن تعذّرت قراءتها: ${outcome.error}`
              })
            }
          >
            اربطي
          </Button>
        </div>
      )}
    </li>
  )
}
