// One recipe, as the app needs it: its title, tags, photos and INGREDIENTS (they feed the shopping list
// and the prep tasks), planning and cooking history. The details (method, notes, the original text) are
// read in OneNote: a big button opens the page. The method, notes and original text stay stored (they
// are read from OneNote and kept in the backup) but are not shown here, and they are never edited here.
// Every text shown is exactly as written, each in its own direction (dir="auto").
//
// A recipe with a OneNote page is read from the page again each time it is opened (for owners and
// editors), and its text is edited in OneNote; the app edits only its own fields (tags, planning).

import { useCallback, useEffect, useState } from 'react'
import { href, navigate } from '../router'
import { Badge, Button, LinkButton, Notice } from '../ui'
import { loadRecipe, restoreRecipe, setFavorite, setFlagStatus, trashRecipe, type LoadedRecipe } from './api'
import { explain } from '../offline/readThrough'
import CookHistory from '../history/CookHistory'
import FoodGroups from '../nutrition/FoodGroups'
import PrepTemplates from '../prep/PrepTemplates'
import PhotoGallery from '../photos/PhotoGallery'
import { loadRecipePage, refreshFromPage, timeAgo, type RecipePage as PageLink } from './onenote'
import { safeHref } from './safeUrl'
import { MEAL_TYPE_LABELS, STATUS_LABELS, type RecipeDoc } from './types'

const PLATFORM_LABELS: Record<string, string> = {
  tiktok: 'تيك توك',
  youtube: 'يوتيوب',
  instagram: 'إنستغرام',
  snapchat: 'سناب شات',
  web: 'موقع',
  other: 'رابط',
}

const FLAG_LABELS: Record<string, string> = {
  possible_duplicate: 'قد تكون مكررة مع',
  method_inside_ingredients: 'الطريقة مكتوبة داخل المقادير',
  quantities_missing: 'كميات غير مذكورة',
  title_mismatch: 'العنوان لا يطابق المحتوى',
  added_from_onenote: 'أُضيفت من صفحة في OneNote',
}

function describeFlag(flag: string): string {
  const [kind, ...rest] = flag.split(':')
  const label = FLAG_LABELS[kind] ?? kind
  return rest.length ? `${label} ${rest.join(':')}` : label
}

export default function RecipePage({ id, canEdit, userId, startLogging = false }: { id: string; canEdit: boolean; userId: string; startLogging?: boolean }) {
  const [loaded, setLoaded] = useState<LoadedRecipe | null | undefined>(undefined)
  const [page, setPage] = useState<PageLink | null>(null)
  const [reading, setReading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [moving, setMoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    loadRecipe(id).then(setLoaded, (e: Error) => setError(e.message))
    loadRecipePage(id).then(
      setPage,
      () => setPage(null),
    )
  }, [id])
  useEffect(load, [load])

  // Read the page again on open (unless it was read a moment ago), then show the result.
  useEffect(() => {
    if (!canEdit) return
    let live = true
    loadRecipePage(id).then((link) => {
      if (!link || !live) return
      if (link.last_read_at && Date.now() - Date.parse(link.last_read_at) < 60_000) return
      setReading(true)
      refreshFromPage(id)
        .then(
          () => {
            if (live) load()
          },
          () => {
            if (live) loadRecipePage(id).then(setPage, () => undefined)
          },
        )
        .finally(() => {
          if (live) setReading(false)
        })
    }, () => undefined)
    return () => {
      live = false
    }
  }, [id, canEdit, load])

  if (error) return <Notice tone="error">{error}</Notice>
  if (loaded === undefined) return <p className="text-muted">جارٍ التحميل…</p>
  if (loaded === null) return <Notice>لم تُعثر على هذه الوصفة.</Notice>

  const { doc, favorite, flags, trashedAt } = loaded
  const inTrash = trashedAt !== null
  const move = async (work: () => Promise<void>, then: () => void) => {
    setMoving(true)
    try {
      await work()
      then()
    } catch (e) {
      setError(explain(e).message)
    } finally {
      setMoving(false)
      setConfirming(false)
    }
  }
  const toggleFavorite = async () => {
    try {
      await setFavorite(id, userId, !favorite)
      setLoaded({ ...loaded, favorite: !favorite })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <article className="flex flex-col gap-5">
      <header className="flex flex-col gap-3">
        <a href={href.library} className="text-sm text-accent">→ كل الوصفات</a>
        <h2 dir="auto" className="text-2xl font-bold leading-snug">{doc.title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{doc.category.section}</Badge>
          {doc.status !== 'complete' && <Badge tone={doc.status === 'partial' ? 'warn' : 'plain'}>{STATUS_LABELS[doc.status]}</Badge>}
          {doc.tags?.meal_types?.map((type) => <Badge key={type} tone="accent">{MEAL_TYPE_LABELS[type]}</Badge>)}
          {doc.tags?.kid_friendly && <Badge tone="accent">مناسبة للأطفال</Badge>}
          {doc.tags?.lunchbox && <Badge tone="accent">لانش بوكس</Badge>}
          {doc.tags?.custom?.map((tag) => <Badge key={tag}>{tag}</Badge>)}
        </div>
        {inTrash && (
          <div className="flex flex-col gap-2 rounded-2xl border border-amber-500 p-4">
            <p className="font-medium">هذه الوصفة في سلة المحذوفات، ولا تظهر في المكتبة.</p>
            {canEdit && (
              <div>
                <Button disabled={moving} onClick={() => move(() => restoreRecipe(id), load)}>
                  استرجعي الوصفة
                </Button>
              </div>
            )}
          </div>
        )}
        <PhotoGallery recipeId={id} title={doc.title} canEdit={canEdit && !inTrash} />
        <div className="flex flex-wrap gap-2">
          {page?.web_url && <LinkButton external kind="primary" href={page.web_url}>افتحي الوصفة في OneNote ↗</LinkButton>}
          <Button kind="plain" onClick={toggleFavorite}>{favorite ? '★ في المفضلة' : '☆ أضف للمفضلة'}</Button>
          {canEdit && !inTrash && <LinkButton href={href.edit(id)}>{page ? 'الوسوم والتخطيط' : 'تعديل'}</LinkButton>}
          {canEdit && !inTrash && !confirming && <Button kind="plain" onClick={() => setConfirming(true)}>نقل إلى سلة المحذوفات</Button>}
        </div>
        {canEdit && !inTrash && confirming && (
          <div className="flex flex-col gap-2 rounded-2xl border border-line p-4">
            <p>تُنقل الوصفة إلى سلة المحذوفات ويمكنك استرجاعها منها في أي وقت. صفحتها في OneNote لا تتأثر.</p>
            <div className="flex gap-2">
              <Button kind="danger" disabled={moving} onClick={() => move(() => trashRecipe(id), () => navigate(href.library))}>
                نعم، انقليها
              </Button>
              <Button kind="plain" onClick={() => setConfirming(false)}>إلغاء</Button>
            </div>
          </div>
        )}
        <Facts doc={doc} />
        {page && <PageStatus page={page} reading={reading} />}
      </header>

      {doc.status === 'link_only' && <LinkOnly doc={doc} />}
      {doc.status !== 'link_only' && doc.ingredient_groups.every((g) => g.items.length === 0) && (
        <Notice>لا مقادير مسجّلة لهذه الوصفة بعد. تُكتب في صفحتها في OneNote، فتظهر هنا ومنها تُبنى المقاضي.</Notice>
      )}

      {doc.ingredient_groups.some((g) => g.items.length > 0) && (
        <Section title="المقادير">
          <div className="flex flex-col gap-4">
            {doc.ingredient_groups.map((group, g) => (
              <div key={g}>
                {group.name !== null && <h4 dir="auto" className="mb-1 font-semibold">{group.name}</h4>}
                <ul className="flex list-disc flex-col gap-1.5 ps-5 marker:text-muted">
                  {group.items.map((item, i) => (
                    <li key={i} dir="auto" className="leading-relaxed">{item.text}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      )}

      {page?.web_url && (
        <p className="text-sm text-muted">
          الطريقة والملاحظات في OneNote: <a href={page.web_url} target="_blank" rel="noreferrer" className="text-accent underline">افتحي الصفحة</a>.
        </p>
      )}

      <FoodGroups recipeId={id} canEdit={canEdit && !inTrash} />

      <PrepTemplates recipeId={id} canEdit={canEdit && !inTrash} ingredientLines={doc.ingredient_groups.flatMap((g) => g.items.map((item) => item.text))} />

      <CookHistory recipeId={id} userId={userId} canLog={!inTrash} startLogging={startLogging} />

      {flags.length > 0 && (
        <Section title="ملاحظات المراجعة">
          <p className="mb-2 text-sm text-muted">علامات من التصدير للمراجعة فقط. لا يُدمج ولا يُحذف شيء بسببها.</p>
          <ul className="flex flex-col gap-2">
            {flags.map((flag) => (
              <li key={flag.id} className="flex flex-wrap items-center justify-between gap-2">
                <span dir="auto" className={flag.status === 'reviewed' ? 'text-muted line-through' : ''}>{describeFlag(flag.flag)}</span>
                {canEdit && (
                  <Button
                    kind="plain"
                    onClick={async () => {
                      try {
                        await setFlagStatus(flag.id, flag.status === 'open' ? 'reviewed' : 'open')
                        load()
                      } catch (e) {
                        setError((e as Error).message)
                      }
                    }}
                  >
                    {flag.status === 'open' ? 'تمت المراجعة' : 'أعدها للمراجعة'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

    </article>
  )
}

function PageStatus({ page, reading }: { page: PageLink; reading: boolean }) {
  if (page.read_status === 'missing') {
    return <Notice>صفحة هذه الوصفة لم تعد في دفتر OneNote (حُذفت أو نُقلت). الوصفة باقية هنا كما قُرئت آخر مرة. إن نقلتِها، اربطيها من صفحة OneNote في التطبيق.</Notice>
  }
  return (
    <p className="text-sm text-muted">
      من OneNote{page.section_name ? ` · ${page.section_name}` : ''} · {reading ? 'جارٍ قراءة الصفحة…' : `قُرئت ${timeAgo(page.last_read_at)}`}
      {page.read_status === 'error' && !reading && ' · تعذّرت آخر قراءة'}
    </p>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <h3 className="mb-3 text-lg font-semibold">{title}</h3>
      {children}
    </section>
  )
}

function Facts({ doc }: { doc: RecipeDoc }) {
  const facts = [
    doc.servings != null && `${doc.servings} حصص`,
    doc.prep_time_min != null && `تحضير ${doc.prep_time_min} دقيقة`,
    doc.cook_time_min != null && `طبخ ${doc.cook_time_min} دقيقة`,
  ].filter(Boolean)
  return facts.length ? <p className="text-sm text-muted">{facts.join(' · ')}</p> : null
}

function LinkOnly({ doc }: { doc: RecipeDoc }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
      <p className="text-muted">وصفة محفوظة كرابط فقط. افتح الرابط لمشاهدتها:</p>
      {doc.sources.map((source, i) => {
        const link = safeHref(source.url)
        return link ? (
          <a key={i} href={link} target="_blank" rel="noreferrer" className="flex min-h-12 items-center justify-between gap-3 rounded-xl bg-accent px-4 text-on-accent">
            <span dir="auto" className="truncate">{source.label || source.url}</span>
            <span className="shrink-0">{PLATFORM_LABELS[source.platform ?? 'other']} ↗</span>
          </a>
        ) : (
          <p key={i} dir="auto" className="break-all rounded-xl border border-line px-4 py-3">{source.label || source.url}</p>
        )
      })}
    </section>
  )
}
