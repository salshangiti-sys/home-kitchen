// «مراجعة»: all recipes in one list with their tags, ingredients, prep tasks and food groups, and the
// recipes that are still missing something. Tags and prep tasks are changed right here and
// saved at once; the ingredients come from the OneNote page, so they are changed there.

import { tintFor } from '../tints'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { href } from '../router'
import { Badge, Button, Card, LinkButton, Notice } from '../ui'
import { addPageAsRecipe, checkNotebook, listUnlinked, loadLibrary, refreshFromPage, timeAgo, type CheckSummary, type UnlinkedPage } from '../library/onenote'
import { sectionsOf } from '../library/sections'
import { loadRecipe, saveRecipe, setFlagStatus } from '../library/api'
import { autofillRecipe } from './apply'
import type { Autofill } from './autofill'
import { removeTemplate, saveTemplate, type TemplateInput } from '../prep/api'
import { PrepEditor, TagsEditor } from './editors'
import { PROBLEM_LABELS, buildOverview, filterRows, loadOverview, problemCounts, type OverviewData, type OverviewRow, type Problem } from './overview'

export interface Pending {
  pages: UnlinkedPage[]
  checkedAt: string | null // when the notebook was last looked at
}

export interface OverviewApi {
  loadOverview: typeof loadOverview
  loadPending: () => Promise<Pending>
  approve: (pageId: string) => Promise<{ recipeId: string; filled: Autofill | null }> // makes the recipe, and fills in a starting set
  approveRecipes: (flagIds: string[]) => Promise<void> // she has reviewed these recipes
  checkNow: () => Promise<CheckSummary>
  refreshFromOneNote: (recipeId: string) => Promise<{ status: 'ok' | 'missing' | 'error'; error: string | null }> // reads the recipe's page now
  setTags: (recipeId: string, tags: string[]) => Promise<void>
  saveTask: (recipeId: string, id: string | null, task: TemplateInput) => Promise<string> // the task's id
  removeTask: (id: string) => Promise<void>
}
const real: OverviewApi = {
  loadOverview,
  loadPending: async () => {
    const [pages, library] = await Promise.all([listUnlinked(), loadLibrary()])
    return { pages, checkedAt: library?.last_checked_at ?? null }
  },
  approve: async (pageId) => {
    const { recipeId } = await addPageAsRecipe(pageId)
    // the starting tags, tasks and groups are a help: the recipe exists even if filling them in fails
    const filled = await autofillRecipe(recipeId).catch(() => null)
    return { recipeId, filled }
  },
  approveRecipes: async (flagIds) => {
    for (const id of flagIds) await setFlagStatus(id, 'reviewed')
  },
  checkNow: checkNotebook,
  refreshFromOneNote: refreshFromPage,
  setTags: async (recipeId, tags) => {
    const loaded = await loadRecipe(recipeId)
    if (!loaded) throw new Error('الوصفة غير موجودة.')
    await saveRecipe({ ...loaded.doc, tags: { ...(loaded.doc.tags ?? {}), custom: tags } }, loaded.version)
  },
  saveTask: (recipeId, id, task) => saveTemplate(id, recipeId, task),
  removeTask: removeTemplate,
}

// Tells the menu how many pages wait for approval, so its tab can show the number.
export const PENDING_EVENT = 'pending-pages'
const announce = (count: number) => window.dispatchEvent(new CustomEvent(PENDING_EVENT, { detail: count }))

// The most recipes read from OneNote in one go: each read takes about ten seconds.
const MAX_REFRESH = 8

const tinted = (name: string, active: boolean) => `min-h-9 shrink-0 rounded-full px-3 text-sm font-medium ${active ? 'bg-accent text-on-accent' : tintFor(name)}`
const chip = (active: boolean) => `min-h-9 shrink-0 rounded-full border px-3 text-sm ${active ? 'border-accent bg-accent text-on-accent' : 'border-line text-ink'}`

interface RowActions {
  onApprove: (flagIds: string[]) => void
  onTags: (tags: string[]) => void
  onSaveTask: (id: string, task: TemplateInput) => void
  onRemoveTask: (id: string) => void
  onAddTask: (task: TemplateInput) => void
  onRefresh: () => void
}

function Row({ row, open, busy, error, actions }: { row: OverviewRow; open: boolean; busy: boolean; error: string | null; actions: RowActions }) {
  return (
    <details open={open} className="bg-surface p-3 rounded-3xl shadow-sm ring-1 ring-line">
      <summary className="flex cursor-pointer flex-col gap-1.5">
        <span dir="auto" className="font-semibold">{row.title}</span>
        <span className="flex flex-wrap gap-1.5">
          {row.tags.map((tag) => (
            <Badge key={tag} tone="accent">{tag}</Badge>
          ))}
          {row.problems.map((p) => (
            <Badge key={p} tone="warn">{PROBLEM_LABELS[p]}</Badge>
          ))}
        </span>
      </summary>
      <div className="mt-3 flex flex-col gap-4 text-sm">
        {error && <Notice tone="error">{error}</Notice>}
        <section aria-label="الوسوم">
          <h4 className="mb-1 font-semibold">الوسوم</h4>
          <TagsEditor tags={row.tags} busy={busy} onChange={actions.onTags} />
        </section>
        <section aria-label="التجهيزات">
          <h4 className="mb-1 font-semibold">التجهيزات</h4>
          <PrepEditor items={row.prep} busy={busy} onSave={actions.onSaveTask} onRemove={actions.onRemoveTask} onAdd={actions.onAddTask} />
          {row.uncut.length > 0 && <p className="mt-1 text-amber-800 dark:text-amber-300">بلا طريقة تقطيع: {row.uncut.join('، ')}. اكتبيها في نص التجهيز، مثل «بصل (مفروم ناعم)».</p>}
        </section>
        <section aria-label="المقادير">
          <h4 className="font-semibold">المقادير{row.ingredientsFromApp ? ' (المؤكَّدة في التطبيق)' : ''}</h4>
          {row.ingredients.length === 0 ? (
            <p className="text-muted">لا مقادير.</p>
          ) : (
            <ul className="mt-1 flex list-disc flex-col gap-0.5 ps-5 marker:text-muted">
              {row.ingredients.map((line, i) => (
                <li key={i} dir="auto">{line}</li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-muted">
            {row.ingredientsFromApp ? (
              <>تُعدَّل من شاشة <a href={href.ingredients} className="underline">المقادير</a>.</>
            ) : (
              'تُعدَّل في صفحة الوصفة في OneNote (لا يغيّر التطبيق صفحاتكِ)، ثم اضغطي «اقرئيها من OneNote الآن» لتظهر هنا.'
            )}
          </p>
        </section>
        <div className="flex flex-wrap gap-2">
          {row.awaiting.length > 0 && (
            <Button disabled={busy} onClick={() => actions.onApprove(row.awaiting)}>
              اعتمدي
            </Button>
          )}
          {row.pageUrl && !row.ingredientsFromApp && <LinkButton external href={row.pageUrl}>عدّلي المقادير في OneNote ↗</LinkButton>}
          <Button kind="plain" disabled={busy} onClick={actions.onRefresh}>اقرئيها من OneNote الآن</Button>
          <LinkButton href={href.recipe(row.id)}>افتحي الوصفة</LinkButton>
        </div>
      </div>
    </details>
  )
}

export default function OverviewPage({ api = real }: { canEdit?: boolean; api?: OverviewApi }) {
  const [data, setData] = useState<OverviewData | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<{ text: string; recipeId?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [section, setSection] = useState<string | null>(null)
  const [problem, setProblem] = useState<Problem | 'approved' | null>(null)
  const [tag, setTag] = useState<string | null>(null)
  const [openAll, setOpenAll] = useState(false)
  const [confirmingAll, setConfirmingAll] = useState(false)
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const [overview, waiting] = await Promise.all([api.loadOverview(), api.loadPending().catch(() => null)])
      setData(overview)
      setPending(waiting)
      if (waiting) announce(waiting.pages.length)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  // One change inside a row: saved at once, and the list is patched in place so the open rows stay open.
  const edit = async (recipeId: string, work: () => Promise<void>, patch: (d: OverviewData) => OverviewData) => {
    setBusy(true)
    setRowError(null)
    try {
      await work()
      setData((d) => (d ? patch(d) : d))
    } catch (e) {
      setRowError({ id: recipeId, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  const act = async (work: () => Promise<{ text: string; recipeId?: string }>) => {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      setNote(await work())
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const rows = useMemo(() => (data ? buildOverview(data) : []), [data])
  // the section and tag counts are of the list she is working on, so they match what a tap shows
  const inList = useMemo(() => rows.filter((r) => (problem === 'approved' ? r.approved : !r.approved)), [rows, problem])
  const sections = useMemo(() => sectionsOf(inList), [inList])
  const counts = useMemo(() => problemCounts(rows), [rows])
  const tags = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of inList) for (const t of r.tags) map.set(t, (map.get(t) ?? 0) + 1)
    return [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ar'))
  }, [inList])
  const shown = useMemo(() => filterRows(rows, { query, section, problem, tag }), [rows, query, section, problem, tag])
  const waitingShown = useMemo(() => shown.filter((r) => r.awaiting.length > 0), [shown])

  if (!data) return error ? <Notice tone="error">{error}</Notice> : <p className="text-muted">جارٍ التحميل…</p>

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-2xl font-bold">مراجعة الوصفات</h2>
        <p className="mt-1 text-sm text-muted">الوسوم والمقادير والتجهيزات لكل وصفة في مكان واحد. للقراءة فقط: افتحي الوصفة لتعديلها.</p>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {note && (
        <Notice>
          {note.text}
          {note.recipeId && (
            <>
              {' '}
              <a href={href.recipe(note.recipeId)} className="underline">افتحي الوصفة</a>
            </>
          )}
        </Notice>
      )}

      <Card title={`صفحات جديدة من OneNote تنتظر اعتمادكِ (${pending?.pages.length ?? 0})`}>
        <p className="mb-3 text-sm text-muted">
          صفحة جديدة تكتبينها في OneNote لا تدخل الوصفات وحدها: تظهر هنا، فتعتمدينها فتنتقل إلى «الوصفات». يفحص التطبيق الدفتر وحده كل 3 ساعات وهو مفتوح.
        </p>
        {pending && pending.pages.length > 0 && (
          <ul className="mb-3 flex flex-col divide-y divide-line">
            {pending.pages.map((page) => (
              <li key={page.page_id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span dir="auto" className="font-medium">{page.title || 'بدون عنوان'}</span>
                  <span dir="auto" className="text-sm text-muted">{page.section_name}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        const { recipeId, filled } = await api.approve(page.page_id)
                        const name = `«${page.title || 'بدون عنوان'}»`
                        const start = filled && (filled.tags.length || filled.groups.length || filled.prep.length)
                        return {
                          text: `اعتُمدت ${name} وانتقلت إلى الوصفات.${start ? ' ملأتُ لها وسومًا وتجهيزات وعناصر غذائية مبدئية، وهي تنتظر اعتمادكِ أو تعديلكِ في القائمة أدناه.' : ' لم أجد في صفحتها ما أبني عليه وسومًا أو تجهيزات.'}`,
                          recipeId,
                        }
                      })
                    }
                  >
                    اعتمدي كوصفة
                  </Button>
                  {page.web_url && <LinkButton external href={page.web_url}>افتحي في OneNote ↗</LinkButton>}
                </div>
              </li>
            ))}
          </ul>
        )}
        {pending && pending.pages.length === 0 && <p className="mb-3 text-sm">لا صفحات جديدة تنتظر.</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            kind="plain"
            disabled={busy}
            onClick={() =>
              act(async () => {
                const s = await api.checkNow()
                return { text: `فُحصت ${s.pages} صفحة. صفحات جديدة تنتظر: ${s.unlinked}. قُرئت ${s.refreshed} وصفة وتغيّرت ${s.changed}.` }
              })
            }
          >
            {busy ? 'جارٍ… (قد تأخذ دقيقة أو دقيقتين)' : 'افحصي OneNote الآن'}
          </Button>
          <span className="text-sm text-muted">آخر فحص: {timeAgo(pending?.checkedAt ?? null)}</span>
        </div>
      </Card>

      <input
        type="search"
        dir="auto"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="ابحثي باسم الوصفة أو وسمها…"
        aria-label="بحث"
        className="min-h-12 rounded-2xl border border-line bg-surface px-4 text-base"
      />

      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="ما ينقص">
        <button type="button" className={chip(problem === null)} onClick={() => setProblem(null)}>
          المتبقية ({rows.filter((r) => !r.approved).length})
        </button>
        {counts
          .filter(([, n]) => n > 0)
          .map(([p, n]) => (
            <button key={p} type="button" className={chip(problem === p)} onClick={() => setProblem(problem === p ? null : p)}>
              {PROBLEM_LABELS[p]} ({n})
            </button>
          ))}
        {rows.some((r) => r.approved) && (
          <button type="button" className={chip(problem === 'approved')} onClick={() => setProblem(problem === 'approved' ? null : 'approved')}>
            اعتمدتُها ({rows.filter((r) => r.approved).length})
          </button>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="الأقسام">
        <button type="button" className={chip(section === null)} onClick={() => setSection(null)}>
          كل الأقسام
        </button>
        {sections.map(([name, n]) => (
          <button key={name} type="button" dir="auto" className={tinted(name, section === name)} onClick={() => setSection(section === name ? null : name)}>
            {name} ({n})
          </button>
        ))}
      </div>

      {tags.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="الوسوم">
          {tags.map(([name, n]) => (
            <button key={name} type="button" dir="auto" className={tinted(name, tag === name)} onClick={() => setTag(tag === name ? null : name)}>
              {name} ({n})
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 text-sm text-muted">
        <span>{shown.length} وصفة</span>
        <button type="button" className="underline" onClick={() => setOpenAll((v) => !v)}>
          {openAll ? 'اطوي الكل' : 'افتحي الكل'}
        </button>
      </div>

      {shown.length > 0 && shown.length <= MAX_REFRESH && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Button
            kind="plain"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                let ok = 0
                for (const row of shown) {
                  const outcome = await api.refreshFromOneNote(row.id)
                  if (outcome.status === 'ok') ok += 1
                }
                return { text: `قُرئت ${ok} من ${shown.length} وصفة من OneNote.` }
              })
            }
          >
            {busy ? 'جارٍ القراءة… (نحو 10 ثوانٍ لكل وصفة)' : `اقرئي الظاهرة من OneNote (${shown.length})`}
          </Button>
        </div>
      )}

      {problem === 'awaiting' && waitingShown.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 bg-surface p-3 text-sm rounded-3xl shadow-sm ring-1 ring-line">
          {confirmingAll ? (
            <>
              <span>تعتمدين {waitingShown.length} وصفة كما هي. تأكدي أنكِ راجعتِها.</span>
              <Button
                disabled={busy}
                onClick={() => {
                  setConfirmingAll(false)
                  void act(async () => {
                    await api.approveRecipes(waitingShown.flatMap((r) => r.awaiting))
                    return { text: `اعتُمدت ${waitingShown.length} وصفة.` }
                  })
                }}
              >
                نعم، اعتمدي الكل
              </Button>
              <Button kind="plain" onClick={() => setConfirmingAll(false)}>إلغاء</Button>
            </>
          ) : (
            <Button kind="plain" disabled={busy} onClick={() => setConfirmingAll(true)}>
              اعتمدي كل الظاهرة ({waitingShown.length})
            </Button>
          )}
        </div>
      )}

      {shown.length === 0 ? (
        <Notice>لا وصفات بهذه الاختيارات.</Notice>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((row) => (
            <Row
              key={`${row.id}:${openAll}`}
              row={row}
              open={openAll}
              busy={busy}
              error={rowError?.id === row.id ? rowError.text : null}
              actions={{
                onRefresh: () =>
                  void act(async () => {
                    const outcome = await api.refreshFromOneNote(row.id)
                    return { text: outcome.status === 'ok' ? `قُرئت «${row.title}» من OneNote.` : `تعذّرت قراءة «${row.title}» من OneNote: ${outcome.error ?? ''}` }
                  }),
                onApprove: (flagIds) =>
                  void act(async () => {
                    await api.approveRecipes(flagIds)
                    return { text: `اعتُمدت «${row.title}».` }
                  }),
                onTags: (tags) =>
                  void edit(row.id, () => api.setTags(row.id, tags), (d) => ({ ...d, recipes: d.recipes.map((r) => (r.id === row.id ? { ...r, custom_tags: tags } : r)) })),
                onSaveTask: (id, task) =>
                  void edit(
                    row.id,
                    async () => void (await api.saveTask(row.id, id, task)),
                    (d) => ({ ...d, templates: d.templates.map((t) => (t.id === id ? { ...t, kind: task.kind, timing: task.timing, at_time: task.atTime, body: task.body } : t)) }),
                  ),
                onRemoveTask: (id) => void edit(row.id, () => api.removeTask(id), (d) => ({ ...d, templates: d.templates.filter((t) => t.id !== id) })),
                onAddTask: (task) => {
                  let newId = ''
                  void edit(
                    row.id,
                    async () => {
                      newId = await api.saveTask(row.id, null, task)
                    },
                    (d) => ({
                      ...d,
                      templates: [
                        ...d.templates,
                        { id: newId, recipe_id: row.id, kind: task.kind, timing: task.timing, at_time: null, body: task.body, position: Math.max(0, ...d.templates.filter((t) => t.recipe_id === row.id).map((t) => t.position)) + 1 },
                      ],
                    }),
                  )
                },
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
