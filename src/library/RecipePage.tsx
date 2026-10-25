// One recipe, in the template order: sources, ingredients, method, my notes. Every text is shown
// exactly as written, each in its own direction (dir="auto") so mixed Arabic/English lines read
// correctly. The original page text is always one tap away.

import { useCallback, useEffect, useState } from 'react'
import { href } from '../router'
import { Badge, Button, LinkButton, Notice } from '../ui'
import { loadRecipe, setFavorite, setFlagStatus, type LoadedRecipe } from './api'
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
}

function describeFlag(flag: string): string {
  const [kind, ...rest] = flag.split(':')
  const label = FLAG_LABELS[kind] ?? kind
  return rest.length ? `${label} ${rest.join(':')}` : label
}

export default function RecipePage({ id, canEdit, userId }: { id: string; canEdit: boolean; userId: string }) {
  const [loaded, setLoaded] = useState<LoadedRecipe | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    loadRecipe(id).then(setLoaded, (e: Error) => setError(e.message))
  }, [id])
  useEffect(load, [load])

  if (error) return <Notice tone="error">{error}</Notice>
  if (loaded === undefined) return <p className="text-muted">جارٍ التحميل…</p>
  if (loaded === null) return <Notice>لم تُعثر على هذه الوصفة.</Notice>

  const { doc, favorite, flags } = loaded
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
        <div className="flex flex-wrap gap-2">
          <Button kind="plain" onClick={toggleFavorite}>{favorite ? '★ في المفضلة' : '☆ أضف للمفضلة'}</Button>
          {canEdit && <LinkButton href={href.edit(id)}>تعديل</LinkButton>}
        </div>
        <Facts doc={doc} />
      </header>

      {doc.status === 'link_only' && <LinkOnly doc={doc} />}
      {doc.status !== 'link_only' && doc.sources.length > 0 && (
        <Section title="المصدر">
          <ul className="flex flex-col gap-2">
            {doc.sources.map((source, i) => (
              <li key={i}>
                <SourceLink source={source} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {doc.ingredient_groups.length > 0 && (
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

      {doc.steps.length > 0 && (
        <Section title="الطريقة">
          <ol className="flex list-decimal flex-col gap-2 ps-5 marker:font-semibold marker:text-muted">
            {doc.steps.map((step) => (
              <li key={step.order} dir="auto" className="leading-relaxed">{step.text}</li>
            ))}
          </ol>
        </Section>
      )}

      {doc.notes.length > 0 && (
        <Section title={doc.status === 'note_only' ? 'الملاحظة' : 'ملاحظاتي'}>
          <ul className="flex flex-col gap-1.5">
            {doc.notes.map((note, i) => (
              <li key={i} dir="auto" className="leading-relaxed">{note}</li>
            ))}
          </ul>
        </Section>
      )}

      {doc.status === 'note_only' && doc.notes.length === 0 && doc.raw_text && (
        <Section title="الملاحظة">
          <p dir="auto" className="whitespace-pre-line leading-relaxed">{doc.raw_text}</p>
        </Section>
      )}

      {(doc.media?.length ?? 0) > 0 && (
        <p className="text-sm text-muted">في صفحة OneNote الأصلية {doc.media!.length === 1 ? 'صورة أو فيديو لم يُنقل' : `${doc.media!.length} صور أو فيديوهات لم تُنقل`}. إضافة الصور للوصفة قادمة لاحقًا.</p>
      )}

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

      {doc.raw_text && doc.status !== 'note_only' && (
        <details className="rounded-2xl border border-line bg-surface p-4">
          <summary className="cursor-pointer font-medium">النص الأصلي كما في OneNote</summary>
          <p dir="auto" className="mt-3 whitespace-pre-line text-sm leading-relaxed">{doc.raw_text}</p>
        </details>
      )}
    </article>
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

function SourceLink({ source }: { source: RecipeDoc['sources'][number] }) {
  return (
    <a href={source.url} target="_blank" rel="noreferrer" className="inline-flex flex-wrap items-center gap-2 text-accent underline">
      {source.platform && <Badge>{PLATFORM_LABELS[source.platform] ?? source.platform}</Badge>}
      <span dir="auto" className="break-all">{source.label || source.url}</span>
    </a>
  )
}

function LinkOnly({ doc }: { doc: RecipeDoc }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
      <p className="text-muted">وصفة محفوظة كرابط فقط. افتح الرابط لمشاهدتها:</p>
      {doc.sources.map((source, i) => (
        <a key={i} href={source.url} target="_blank" rel="noreferrer" className="flex min-h-12 items-center justify-between gap-3 rounded-xl bg-accent px-4 text-on-accent">
          <span dir="auto" className="truncate">{source.label || source.url}</span>
          <span className="shrink-0">{PLATFORM_LABELS[source.platform ?? 'other']} ↗</span>
        </a>
      ))}
    </section>
  )
}
