// The recipe library: search (Arabic-aware), sections, favorites, and one card per recipe that
// follows its status (complete, partial, link only, note only).

import { useEffect, useMemo, useState } from 'react'
import { href } from '../router'
import { Badge, Button, LinkButton, Notice } from '../ui'
import { countTrash, downloadJson, exportRecipes, listRecipes, type RecipeSummary } from './api'
import { coverThumbs } from '../photos/api'
import { listCookStats, localDate, type CookStat } from '../history/api'
import { SORT_LABELS, cookLine, sortRecipes, type SortMode } from '../history/stats'
import { matchesQuery, normalizeAr } from './normalize'
import BulkTagPanel from './BulkTagPanel'
import { MEAL_TYPE_LABELS, STATUS_LABELS, type RecipeStatus } from './types'
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
  const [onlyNeverCooked, setOnlyNeverCooked] = useState(false)
  const [sort, setSort] = useState<SortMode>('name')
  const [stats, setStats] = useState<Map<string, CookStat> | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportNote, setExportNote] = useState<string | null>(null)

  // Tagging many at once: pick recipes, then change their tags together.
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkNote, setBulkNote] = useState<string | null>(null)

  const [trashed, setTrashed] = useState(0)
  const [covers, setCovers] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    listRecipes().then(setData, (e: Error) => setError(e.message))
    if (canEdit) countTrash().then(setTrashed, () => undefined)
    coverThumbs().then(setCovers)
    listCookStats().then(setStats, () => undefined) // only for sorting and the line under a recipe
  }, [canEdit])

  const sections = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of data?.recipes ?? []) counts.set(r.section, (counts.get(r.section) ?? 0) + 1)
    return [...counts].sort((a, b) => a[0].localeCompare(b[0], 'ar'))
  }, [data])

  const shown = useMemo(() => {
    if (!data) return []
    const matching = data.recipes.filter(
      (r) =>
        (!section || r.section === section) &&
        (!status || r.status === status) &&
        (!onlyFavorites || data.favorites.has(r.id)) &&
        (!onlyFlagged || data.openFlags.has(r.id)) &&
        (!onlyNeverCooked || !stats?.has(r.id)) &&
        matchesQuery(r.search_norm || normalizeAr(r.title), query),
    )
    return sortRecipes(matching, stats ?? new Map(), sort)
  }, [data, query, section, status, onlyFavorites, onlyFlagged, onlyNeverCooked, stats, sort])
  const neverCooked = useMemo(() => (stats && data ? data.recipes.filter((r) => !stats.has(r.id)).length : 0), [stats, data])
  const today = localDate()

  // Only recipes that are shown count as selected: one filtered out of sight is never tagged.
  const chosen = shown.filter((recipe) => selected.has(recipe.id)).map((recipe) => recipe.id)
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const leaveSelecting = () => {
    setSelecting(false)
    setSelected(new Set())
  }

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
        {stats && stats.size > 0 && neverCooked > 0 && (
          <button type="button" className={chip(onlyNeverCooked)} onClick={() => setOnlyNeverCooked(!onlyNeverCooked)}>
            لم تُجرَّب بعد ({neverCooked})
          </button>
        )}
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted">{shown.length === data.recipes.length ? `${shown.length} وصفة` : `${shown.length} من ${data.recipes.length} وصفة`}</p>
            <div className="flex flex-wrap items-center gap-2">
              {stats && stats.size > 0 && (
                <label className="flex items-center gap-2 text-sm">
                  الترتيب
                  <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)} className="min-h-11 rounded-xl border border-line bg-bg px-3 text-sm">
                    {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
                      <option key={mode} value={mode}>{SORT_LABELS[mode]}</option>
                    ))}
                  </select>
                </label>
              )}
              {canEdit && !selecting && <Button kind="plain" onClick={() => setSelecting(true)}>توسيم عدة وصفات</Button>}
            </div>
          </div>
          {bulkNote && <Notice>{bulkNote}</Notice>}
          {selecting && (
            <div className="flex flex-col gap-3 rounded-2xl border border-line p-3">
              <p className="text-sm">اختاري الوصفات ثم غيّري وسومها معًا. المحدّدة: {chosen.length}</p>
              <div className="flex flex-wrap gap-2">
                <Button kind="plain" disabled={shown.length === 0} onClick={() => setSelected(new Set(shown.map((recipe) => recipe.id)))}>
                  تحديد كل المعروضة ({shown.length})
                </Button>
                <Button kind="plain" disabled={chosen.length === 0} onClick={() => setSelected(new Set())}>إلغاء التحديد</Button>
                <Button kind="plain" onClick={leaveSelecting}>تم</Button>
              </div>
              {chosen.length > 0 && (
                <BulkTagPanel
                  ids={chosen}
                  onClose={() => setSelected(new Set())}
                  onApplied={(changed) => {
                    setBulkNote(`عُدّلت وسوم ${changed} ${changed === 1 ? 'وصفة' : 'وصفات'}. كل وصفة حفظت إصدارها السابق.`)
                    setSelected(new Set())
                    listRecipes().then(setData, (e: Error) => setError(e.message))
                  }}
                />
              )}
            </div>
          )}
          <ul className="flex flex-col gap-2">
            {shown.map((recipe) =>
              selecting ? (
                <SelectableRow key={recipe.id} recipe={recipe} checked={selected.has(recipe.id)} onToggle={() => toggle(recipe.id)} />
              ) : (
                <RecipeRow key={recipe.id} recipe={recipe} cover={covers.get(recipe.id)} favorite={data.favorites.has(recipe.id)} flagged={data.openFlags.has(recipe.id)} cooked={cookLine(stats?.get(recipe.id), today)} />
              ),
            )}
          </ul>
          {shown.length === 0 && <p className="text-muted">لا نتائج. جرّب كلمة أخرى أو ألغِ التصفية.</p>}
        </>
      )}

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <div className="flex flex-wrap gap-2">
          {canEdit && <LinkButton href={href.trash}>سلة المحذوفات{trashed > 0 ? ` (${trashed})` : ''}</LinkButton>}
          <Button kind="plain" onClick={doExport} disabled={exporting || data.recipes.length === 0}>
            نزّل نسخة من كل الوصفات (JSON)
          </Button>
        </div>
        {exportNote && <Notice>{exportNote}</Notice>}
      </div>
    </div>
  )
}

function RecipeRow({ recipe, cover, favorite, flagged, cooked }: { recipe: RecipeSummary; cover?: string; favorite: boolean; flagged: boolean; cooked: string | null }) {
  return (
    <li>
      <a href={href.recipe(recipe.id)} className="flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
        {cover ? (
          <img src={cover} alt="" loading="lazy" className="size-12 shrink-0 rounded-lg border border-line object-cover" />
        ) : (
          <span aria-hidden className="text-xl">{STATUS_ICONS[recipe.status]}</span>
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span dir="auto" className="truncate font-medium">{recipe.title}</span>
          <span dir="auto" className="text-sm text-muted">{recipe.section}</span>
          {cooked && <span className="text-xs text-muted">{cooked}</span>}
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

// In selection mode a row is a checkbox, with the tags it has now, so the choice is made knowingly.
function SelectableRow({ recipe, checked, onToggle }: { recipe: RecipeSummary; checked: boolean; onToggle: () => void }) {
  const tags = [
    ...recipe.meal_types.map((type) => MEAL_TYPE_LABELS[type]),
    recipe.kid_friendly === true && 'للأطفال',
    recipe.lunchbox === true && 'لانش بوكس',
  ].filter(Boolean)
  return (
    <li>
      <label className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border bg-surface px-4 py-3 ${checked ? 'border-accent' : 'border-line'}`}>
        <input type="checkbox" checked={checked} onChange={onToggle} className="size-6 shrink-0 accent-[var(--accent)]" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span dir="auto" className="truncate font-medium">{recipe.title}</span>
          <span dir="auto" className="text-sm text-muted">{recipe.section}{tags.length > 0 && ` · ${tags.join('، ')}`}</span>
        </span>
      </label>
    </li>
  )
}
