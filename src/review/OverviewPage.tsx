// «مراجعة»: all recipes in one list with their tags, ingredients, prep tasks and food groups, and the
// recipes that are still missing something. For reading and checking; to change a recipe, open it.

import { useEffect, useMemo, useState } from 'react'
import { href } from '../router'
import { Badge, LinkButton, Notice } from '../ui'
import { sectionsOf } from '../library/sections'
import { FOOD_GROUP_LABELS } from '../nutrition/api'
import { PROBLEM_LABELS, buildOverview, filterRows, loadOverview, problemCounts, type OverviewData, type OverviewRow, type Problem } from './overview'

export interface OverviewApi {
  loadOverview: typeof loadOverview
}
const real: OverviewApi = { loadOverview }

const chip = (active: boolean) => `min-h-9 shrink-0 rounded-full border px-3 text-sm ${active ? 'border-accent bg-accent text-on-accent' : 'border-line text-ink'}`

function Row({ row, open }: { row: OverviewRow; open: boolean }) {
  return (
    <details open={open} className="rounded-2xl border border-line bg-surface p-3">
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
      <div className="mt-3 flex flex-col gap-3 text-sm">
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
        </section>
        <section aria-label="التجهيزات">
          <h4 className="font-semibold">التجهيزات</h4>
          {row.prep.length === 0 ? (
            <p className="text-muted">لا تجهيزات.</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-1">
              {row.prep.map((item, i) => (
                <li key={i} dir="auto">
                  <span className="text-muted">{item.label}: </span>
                  {item.body}
                </li>
              ))}
            </ul>
          )}
          {row.uncut.length > 0 && <p className="mt-1 text-amber-800 dark:text-amber-300">بلا طريقة تقطيع: {row.uncut.join('، ')}</p>}
        </section>
        <section aria-label="العناصر الغذائية">
          <h4 className="font-semibold">العناصر الغذائية</h4>
          <p>{row.groups.length ? row.groups.map((g) => FOOD_GROUP_LABELS[g]).join('، ') : <span className="text-muted">لم تُحدَّد.</span>}</p>
        </section>
        <div>
          <LinkButton href={href.recipe(row.id)}>افتحي الوصفة للتعديل</LinkButton>
        </div>
      </div>
    </details>
  )
}

export default function OverviewPage({ api = real }: { canEdit?: boolean; api?: OverviewApi }) {
  const [data, setData] = useState<OverviewData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [section, setSection] = useState<string | null>(null)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [tag, setTag] = useState<string | null>(null)
  const [openAll, setOpenAll] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.loadOverview().then(
      (d) => !cancelled && setData(d),
      (e) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      cancelled = true
    }
  }, [api])

  const rows = useMemo(() => (data ? buildOverview(data) : []), [data])
  const sections = useMemo(() => sectionsOf(rows), [rows])
  const counts = useMemo(() => problemCounts(rows), [rows])
  const tags = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of rows) for (const t of r.tags) map.set(t, (map.get(t) ?? 0) + 1)
    return [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ar'))
  }, [rows])
  const shown = useMemo(() => filterRows(rows, { query, section, problem, tag }), [rows, query, section, problem, tag])

  if (error) return <Notice tone="error">{error}</Notice>
  if (!data) return <p className="text-muted">جارٍ التحميل…</p>

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-2xl font-bold">مراجعة الوصفات</h2>
        <p className="mt-1 text-sm text-muted">الوسوم والمقادير والتجهيزات والعناصر الغذائية لكل وصفة في مكان واحد. للقراءة فقط: افتحي الوصفة لتعديلها.</p>
      </div>

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
          الكل ({rows.length})
        </button>
        {counts
          .filter(([, n]) => n > 0)
          .map(([p, n]) => (
            <button key={p} type="button" className={chip(problem === p)} onClick={() => setProblem(problem === p ? null : p)}>
              {PROBLEM_LABELS[p]} ({n})
            </button>
          ))}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="الأقسام">
        <button type="button" className={chip(section === null)} onClick={() => setSection(null)}>
          كل الأقسام
        </button>
        {sections.map(([name, n]) => (
          <button key={name} type="button" dir="auto" className={chip(section === name)} onClick={() => setSection(section === name ? null : name)}>
            {name} ({n})
          </button>
        ))}
      </div>

      {tags.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="الوسوم">
          {tags.map(([name, n]) => (
            <button key={name} type="button" dir="auto" className={chip(tag === name)} onClick={() => setTag(tag === name ? null : name)}>
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

      {shown.length === 0 ? (
        <Notice>لا وصفات بهذه الاختيارات.</Notice>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((row) => (
            <Row key={`${row.id}:${openAll}`} row={row} open={openAll} />
          ))}
        </div>
      )}
    </div>
  )
}
