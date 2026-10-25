// The recipe library: search (Arabic-aware), sections, favorites, and one card per recipe that
// follows its status (complete, partial, link only, note only).

import { useEffect, useMemo, useState } from 'react'
import { href } from '../router'
import { Badge, Button, LinkButton, Notice } from '../ui'
import { downloadJson, exportRecipes, listRecipes, type RecipeSummary } from './api'
import { matchesQuery, normalizeAr } from './normalize'
import { STATUS_LABELS, type RecipeStatus } from './types'
import { recipeErrors } from './validate'

const STATUS_ICONS: Record<RecipeStatus, string> = { complete: '🍽', partial: '📝', link_only: '🔗', note_only: '🗒' }

export default function LibraryPage({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof listRecipes>> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [section, setSection] = useState<string | null>(null)
  const [status, setStatus] = useState<RecipeStatus | null>(null)
  const [onlyFavorites, setOnlyFavorites] = useState(false)
  const [onlyFlagged, setOnlyFlagged] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportNote, setExportNote] = useState<string | null>(null)

  useEffect(() => {
    listRecipes().then(setData, (e: Error) => setError(e.message))
  }, [])

  const sections = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of data?.recipes ?? []) counts.set(r.section, (counts.get(r.section) ?? 0) + 1)
    return [...counts].sort((a, b) => a[0].localeCompare(b[0], 'ar'))
  }, [data])

  const shown = useMemo(() => {
    if (!data) return []
    return data.recipes.filter(
      (r) =>
        (!section || r.section === section) &&
        (!status || r.status === status) &&
        (!onlyFavorites || data.favorites.has(r.id)) &&
        (!onlyFlagged || data.openFlags.has(r.id)) &&
        matchesQuery(r.search_norm || normalizeAr(r.title), query),
    )
  }, [data, query, section, status, onlyFavorites, onlyFlagged])

  const doExport = async () => {
    setExporting(true)
    setExportNote(null)
    try {
      const docs = await exportRecipes()
      const invalid = docs.filter((doc) => recipeErrors(doc).length).length
      downloadJson(`recipes-${new Date().toISOString().slice(0, 10)}.json`, docs)
      setExportNote(`نُزّلت ${docs.length} وصفة.${invalid ? ` تنبيه: ${invalid} منها لا تطابق المخطط.` : ' كلها تطابق recipe.schema.json.'}`)
    } catch (e) {
      setExportNote((e as Error).message)
    } finally {
      setExporting(false)
    }
  }

  if (error) return <Notice tone="error">{error}</Notice>
  if (!data) return <p className="text-muted">جارٍ التحميل…</p>

  const chip = (active: boolean) =>
    `min-h-9 rounded-full border px-3 text-sm ${active ? 'border-accent bg-accent text-on-accent' : 'border-line text-ink'}`

  return (
    <div className="flex flex-col gap-4">
      <input
        type="search"
        dir="auto"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="ابحث بالاسم أو المكوّن أو الطريقة…"
        aria-label="بحث"
        className="min-h-12 rounded-2xl border border-line bg-surface px-4 text-base"
      />

      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="الأقسام">
        <button type="button" className={chip(section === null)} onClick={() => setSection(null)}>
          الكل ({data.recipes.length})
        </button>
        {sections.map(([name, count]) => (
          <button key={name} type="button" dir="auto" className={`${chip(section === name)} shrink-0`} onClick={() => setSection(section === name ? null : name)}>
            {name} ({count})
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <button type="button" className={chip(onlyFavorites)} onClick={() => setOnlyFavorites(!onlyFavorites)}>
          ★ المفضلة
        </button>
        {(Object.keys(STATUS_LABELS) as RecipeStatus[]).map((s) => (
          <button key={s} type="button" className={chip(status === s)} onClick={() => setStatus(status === s ? null : s)}>
            {STATUS_LABELS[s]}
          </button>
        ))}
        {data.openFlags.size > 0 && (
          <button type="button" className={chip(onlyFlagged)} onClick={() => setOnlyFlagged(!onlyFlagged)}>
            تحتاج مراجعة ({data.openFlags.size})
          </button>
        )}
      </div>

      {data.recipes.length === 0 ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-line p-6 text-center">
          <p>لا توجد وصفات بعد.</p>
          {canEdit && (
            <div className="flex flex-wrap justify-center gap-2">
              <LinkButton href={href.import} kind="primary">استورد ملف الوصفات</LinkButton>
              <LinkButton href={href.new}>أضف وصفة</LinkButton>
            </div>
          )}
        </div>
      ) : (
        <>
          <p className="text-sm text-muted">{shown.length === data.recipes.length ? `${shown.length} وصفة` : `${shown.length} من ${data.recipes.length} وصفة`}</p>
          <ul className="flex flex-col gap-2">
            {shown.map((recipe) => (
              <RecipeRow key={recipe.id} recipe={recipe} favorite={data.favorites.has(recipe.id)} flagged={data.openFlags.has(recipe.id)} />
            ))}
          </ul>
          {shown.length === 0 && <p className="text-muted">لا نتائج. جرّب كلمة أخرى أو ألغِ التصفية.</p>}
        </>
      )}

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <div>
          <Button kind="plain" onClick={doExport} disabled={exporting || data.recipes.length === 0}>
            نزّل نسخة من كل الوصفات (JSON)
          </Button>
        </div>
        {exportNote && <Notice>{exportNote}</Notice>}
      </div>
    </div>
  )
}

function RecipeRow({ recipe, favorite, flagged }: { recipe: RecipeSummary; favorite: boolean; flagged: boolean }) {
  return (
    <li>
      <a href={href.recipe(recipe.id)} className="flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
        <span aria-hidden className="text-xl">{STATUS_ICONS[recipe.status]}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span dir="auto" className="truncate font-medium">{recipe.title}</span>
          <span dir="auto" className="text-sm text-muted">{recipe.section}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {recipe.status !== 'complete' && <Badge tone={recipe.status === 'partial' ? 'warn' : 'plain'}>{STATUS_LABELS[recipe.status]}</Badge>}
          {flagged && <Badge tone="warn">مراجعة</Badge>}
          {favorite && <span aria-label="مفضلة" className="text-amber-500">★</span>}
        </span>
      </a>
    </li>
  )
}
