// «المقاضي»: what to buy for the week's meals, grouped by shop aisle. The list is worked out from the
// plan and the recipes' ingredient lines (see model.ts), so it follows the plan. Ticking an item as
// bought, "I have it", keeping something at home for every week, and adding an item by hand all work
// with no connection: they wait in the outbox ("لم تُرسل بعد") and are sent when the connection returns.
// Nothing here changes a recipe or OneNote.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { href } from '../router'
import { Badge, Button, LinkButton, Notice } from '../ui'
import { enqueue, flush, pending, subscribe, type Op } from '../offline/outbox'
import * as plan from '../plan/api'
import { loadFreezer, type FreezerItem } from '../freezer/api'
import { inFreezer, summary } from '../freezer/model'
import { addDays, isIsoDate, todayIso, weekRange } from '../plan/dates'
import { loadShopping, shoppingMessage, type ShoppingData } from './api'
import { ADD_KIND, CLEAR_KIND, CONFIRM_KIND, MARK_KIND, PANTRY_KIND, UNCONFIRM_KIND, buildShoppingList, confirmKey, keyOf, markKey, overlayConfirmations, overlayMarks, pantryKey, plannedRecipes, type Item, type ItemSource, type MarkStatus } from './model'
import { useLessonsVersion } from './LessonsContext'
import { UNITS, formatQuantity, formatTotals, parseAmount, type Quantity, type Unit } from './quantity'

export interface ShoppingApi {
  loadWeek: typeof plan.loadWeek
  loadShopping: typeof loadShopping
  loadFreezer?: typeof loadFreezer // what is in the freezer, noted beside an item she has some of (best effort)
}

const realApi: ShoppingApi = { loadWeek: plan.loadWeek, loadShopping, loadFreezer }

export interface Outbox {
  enqueue: (kind: string, key: string, args: Record<string, unknown>) => Promise<void>
  pending: () => Promise<Op[]>
  flush: () => Promise<unknown>
  subscribe: (listener: (event: 'queued' | 'flushed' | 'failed') => void) => () => void
}
const realOutbox: Outbox = { enqueue, pending, flush, subscribe }

interface Props {
  canEdit: boolean
  week?: string
  today?: () => string
  api?: ShoppingApi
  outbox?: Outbox
}

export default function ShoppingPage({ canEdit, week, today = todayIso, api = realApi, outbox = realOutbox }: Props) {
  const anyDay = isIsoDate(week) ? week : today()
  const [weekData, setWeekData] = useState<plan.WeekData | null>(null)
  const [base, setBase] = useState<ShoppingData | null>(null)
  const [ops, setOps] = useState<Op[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState('')
  const [freezer, setFreezer] = useState<FreezerItem[]>([])
  const lessons = useLessonsVersion() // the list is worked out again when she teaches the dictionary
  const recipesRef = useRef<Array<{ id: string; title: string }>>([])

  const load = useCallback(async () => {
    try {
      const data = await api.loadWeek(anyDay)
      const recipes = plannedRecipes(data.meals)
      recipesRef.current = recipes
      const shop = await api.loadShopping(data.weekStart, recipes)
      setWeekData(data)
      setBase(shop)
      setFreezer((await api.loadFreezer?.().catch(() => undefined)) ?? [])
      setOps(await outbox.pending())
      setError(null)
    } catch (e) {
      setError(shoppingMessage(e))
    }
  }, [api, anyDay, outbox])

  useEffect(() => {
    setWeekData(null)
    setBase(null)
    void load()
  }, [load])

  // When waiting changes have been sent (or refused), read the list again.
  useEffect(() => outbox.subscribe((event) => event !== 'queued' && void load()), [outbox, load])

  const weekStart = weekData?.weekStart ?? ''
  const shown = useMemo(() => (base && weekData ? overlayMarks(base.marks, base.pantry, ops, weekStart) : null), [base, weekData, ops, weekStart])
  const sure = useMemo(() => (base ? overlayConfirmations(base.confirmations ?? [], ops) : null), [base, ops])
  const list = useMemo(
    () =>
      base && weekData && shown
        ? buildShoppingList({ meals: weekData.meals, recipes: base.recipes, marks: shown.marks, pantry: shown.pantry, confirmations: sure?.confirmations })
        : null,
    [base, weekData, shown, sure, lessons], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Every change is first kept in the outbox (the list shows it at once), then sent. With no connection
  // it simply stays there, marked «لم تُرسل بعد», and goes when the connection is back.
  const change = async (kind: string, key: string, args: Record<string, unknown>) => {
    setError(null)
    try {
      await outbox.enqueue(kind, key, args)
      setOps(await outbox.pending())
      setSending(true)
      await outbox.flush()
      setOps(await outbox.pending())
      setBase(await api.loadShopping(weekStart, recipesRef.current))
    } catch (e) {
      setOps(await outbox.pending().catch(() => []))
      setError(shoppingMessage(e))
    } finally {
      setSending(false)
    }
  }

  const mark = (item: Item, status: MarkStatus) => change(MARK_KIND, markKey(weekStart, item.key), { week: weekStart, key: item.key, status })
  const keepAtHome = async (item: Item, on: boolean) => {
    await change(PANTRY_KIND, pantryKey(item.key), { key: item.key, label: item.label, on })
    if (on) await mark(item, 'have') // for this week too, whatever it was marked
  }
  const addByHand = async (label: string) => {
    const text = label.trim()
    if (!text) return
    setAdding('')
    await change(ADD_KIND, markKey(weekStart, keyOf(text)), { week: weekStart, key: keyOf(text), label: text })
  }
  const confirm = (item: Item, source: ItemSource, q: Quantity) =>
    change(CONFIRM_KIND, confirmKey(source.recipeId, source.line, item.key), { recipe: source.recipeId, line: source.line, key: item.key, quantity: q.quantity, unit: q.unit })
  const unconfirm = (item: Item, source: ItemSource) => change(UNCONFIRM_KIND, confirmKey(source.recipeId, source.line, item.key), { recipe: source.recipeId, line: source.line, key: item.key })
  const confirmAllRead = async (item: Item) => {
    for (const source of item.sources) if (source.read && !source.confirmed) await confirm(item, source, source.read)
  }
  const removeManual = (item: Item) => change(CLEAR_KIND, markKey(weekStart, item.key), { week: weekStart, key: item.key })

  if (!list || !weekData) return error ? <Notice tone="error">{error}</Notice> : <p className="text-muted">جارٍ التحميل…</p>

  const waiting = sending ? new Set<string>() : shown?.waiting ?? new Set<string>()
  const waitingQuantities = sending ? new Set<string>() : sure?.waiting ?? new Set<string>()
  const empty = list.meals === 0 && list.toBuy.length === 0 && list.done.length === 0

  const row = (item: Item) => {
    const bought = item.status === 'bought'
    const have = item.status === 'have'
    return (
      <li key={item.key} className="rounded-xl border border-line bg-surface p-3">
        <label className="flex min-h-11 cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={bought}
            disabled={!canEdit}
            onChange={(e) => void mark(item, e.target.checked ? 'bought' : 'needed')}
            className="mt-1 size-6 shrink-0 accent-[var(--accent)]"
          />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span dir="auto" className={`leading-relaxed ${bought || have ? 'text-muted line-through' : 'font-medium'}`}>{item.label}</span>
            <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
              {have && <Badge tone="accent">{item.pantry ? 'دائمًا في البيت' : 'متوفر في البيت'}</Badge>}
              {item.manual && <Badge>أضفتِه بيدك</Badge>}
              {waiting.has(item.key) && <Badge tone="warn">لم تُرسل بعد</Badge>}
              {(() => {
                const home = inFreezer(freezer, item.label)
                return home.length > 0 ? <Badge tone="accent">في الفريزر: {summary(home)}</Badge> : null
              })()}
              {item.sources.length > 0 && <span dir="auto">{[...new Set(item.sources.map((s) => s.recipe))].join('، ')}</span>}
            </span>
            {item.totals.length > 0 && (
              <span className="text-sm">
                <span className="text-muted">المجموع المؤكَّد: </span>
                <strong dir="auto">{formatTotals(item.totals)}</strong>
                {item.unconfirmed > 0 && <span className="text-muted"> (غير محسوبة: {item.unconfirmed === 1 ? 'سطر واحد' : `${item.unconfirmed} أسطر`})</span>}
              </span>
            )}
          </span>
        </label>
        {(item.sources.length > 0 || canEdit) && (
          <details className="mt-1">
            <summary className="cursor-pointer text-sm text-muted">التفاصيل</summary>
            {item.sources.length > 0 && (
              <ul className="mt-2 flex flex-col gap-2 text-sm">
                {item.sources.map((s) => (
                  <SourceRow
                    key={`${s.recipeId}\u0000${s.line}`}
                    source={s}
                    canEdit={canEdit}
                    unsent={waitingQuantities.has(`${s.recipeId}\u0000${s.line}\u0000${item.key}`)}
                    onConfirm={(q) => void confirm(item, s, q)}
                    onClear={() => void unconfirm(item, s)}
                  />
                ))}
              </ul>
            )}
            {canEdit && (
              <div className="mt-2 flex flex-wrap gap-2">
                {item.sources.some((s) => s.read && !s.confirmed) && <Button kind="plain" onClick={() => void confirmAllRead(item)}>أكّدي كل الكميات المقروءة</Button>}
                {!have && <Button kind="plain" onClick={() => void mark(item, 'have')}>عندي في البيت</Button>}
                {have && <Button kind="plain" onClick={() => void mark(item, 'needed')}>أعيديه للشراء</Button>}
                {!item.pantry && <Button kind="plain" onClick={() => void keepAtHome(item, true)}>دائمًا عندي (كل الأسابيع)</Button>}
                {item.pantry && <Button kind="plain" onClick={() => void keepAtHome(item, false)}>لم يعد دائمًا عندي</Button>}
                {item.manual && item.sources.length === 0 && <Button kind="danger" onClick={() => void removeManual(item)}>احذفيه</Button>}
              </div>
            )}
          </details>
        )}
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-2xl font-bold">المقاضي</h2>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <LinkButton href={href.shopping(addDays(weekStart, -7))}>→ الأسبوع السابق</LinkButton>
        <span className="font-medium">{weekRange(weekStart)}</span>
        <LinkButton href={href.shopping(addDays(weekStart, 7))}>الأسبوع التالي ←</LinkButton>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      {empty && (
        <Notice>
          لا وجبات مخططة في هذا الأسبوع بعد. <a href={href.plan(weekStart)} className="underline">افتحي الخطة</a> وأضيفي وجباتك، فتُبنى المقاضي منها.
        </Notice>
      )}

      {!empty && (
        <p className="text-sm text-muted">
          من {list.meals === 1 ? 'وجبة واحدة' : `${list.meals} وجبات`} مخطَّطة (لا تدخل الوجبات المطبوخة ولا المتخطّاة). تُكتب الأصناف كما وردت في الوصفات، ولا تُجمع الكميات.
        </p>
      )}

      {list.toBuy.map((group) => (
        <section key={group.aisle} aria-label={group.label} className="flex flex-col gap-2">
          <h3 className="text-lg font-semibold">{group.label}</h3>
          <ul className="flex flex-col gap-2">{group.items.map(row)}</ul>
        </section>
      ))}

      {!empty && list.toBuy.length === 0 && <p className="text-sm text-muted">لا شيء للشراء الآن.</p>}

      {list.done.length > 0 && (
        <details className="rounded-2xl border border-line p-3">
          <summary className="cursor-pointer font-medium">تم شراؤه أو متوفر ({list.done.length})</summary>
          <ul className="mt-2 flex flex-col gap-2">{list.done.map(row)}</ul>
        </details>
      )}

      {canEdit && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void addByHand(adding)
          }}
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium">
            صنف تضيفينه بيدك
            <input dir="auto" maxLength={120} value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="مثل: حفاضات" className="min-h-11 rounded-xl border border-line bg-bg px-3 text-base font-normal" />
          </label>
          <Button type="submit" disabled={adding.trim() === ''}>أضيفي</Button>
        </form>
      )}

      {list.noIngredients.length > 0 && (
        <Notice>
          لا مقادير مسجّلة لهذه الوصفات، فلم تدخل القائمة: {list.noIngredients.join('، ')}. تُكتب مقاديرها في صفحتها في OneNote، أو <a href={href.ingredients} className="underline">راجعي المقادير المقترحة</a>.
        </Notice>
      )}
      {list.freeText.length > 0 && <Notice>وجبات مكتوبة نصًّا بلا وصفة، فلا مقادير لها: {list.freeText.join('، ')}.</Notice>}

      {canEdit && (
        <p className="text-sm text-muted">
          صنف ظهر مستقلًّا وهو نفس صنف آخر؟ <a href={href.dictionary} className="underline">علّمي القاموس</a>.
        </p>
      )}

      {list.sentences.length > 0 && (
        <details className="rounded-2xl border border-line p-3">
          <summary className="cursor-pointer font-medium">أسطر في المقادير تبدو كلامًا لا صنفًا ({list.sentences.length})</summary>
          <p className="mt-2 text-sm text-muted">لم أضعها في القائمة كي لا أخمّن. اقرئيها بنفسك:</p>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {list.sentences.map((s, i) => (
              <li key={i} dir="auto">{s.line} <span className="text-muted">· {s.recipe}</span></li>
            ))}
          </ul>
        </details>
      )}

      {list.pantryAll.length > 0 && (
        <details className="rounded-2xl border border-line p-3">
          <summary className="cursor-pointer font-medium">دائمًا في البيت ({list.pantryAll.length})</summary>
          <p className="mt-2 text-sm text-muted">لا تظهر للشراء في أي أسبوع إلا إن أعدتِها بنفسك.</p>
          <ul className="mt-2 flex flex-col gap-2">
            {list.pantryAll.map((p) => (
              <li key={p.key} className="flex items-center justify-between gap-2">
                <span dir="auto">{p.label}</span>
                {canEdit && <Button kind="plain" onClick={() => void change(PANTRY_KIND, pantryKey(p.key), { key: p.key, label: p.label, on: false })}>أزيليه</Button>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

// One recipe line of an item. What the parser read from it is only a suggestion: the quantity is added to
// the item's total once the person confirms it (as read, or after correcting it).
function SourceRow({ source, canEdit, unsent, onConfirm, onClear }: { source: ItemSource; canEdit: boolean; unsent: boolean; onConfirm: (q: Quantity) => void; onClear: () => void }) {
  const [editing, setEditing] = useState(false)
  const start = source.confirmed ?? source.read
  const [amount, setAmount] = useState(start ? String(Math.round(start.quantity * 100) / 100) : '')
  const [unit, setUnit] = useState<Unit>(start?.unit ?? null)
  const quantity = parseAmount(amount)

  return (
    <li dir="auto" className="flex flex-col gap-1">
      <span>
        <span>{source.line}</span> <span className="text-muted">· {source.recipe}{source.times > 1 ? ` (× ${source.times})` : ''}</span>
      </span>
      {!editing && (
        <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
          {source.confirmed ? (
            <Badge tone="accent">✓ مؤكَّدة: {formatQuantity(source.confirmed)}</Badge>
          ) : source.read ? (
            <span>قُرئت: {formatQuantity(source.read)} (غير محسوبة حتى تؤكديها)</span>
          ) : (
            <span>لا كمية مكتوبة (غير محسوبة)</span>
          )}
          {unsent && <Badge tone="warn">لم تُرسل بعد</Badge>}
          {canEdit && !source.confirmed && source.read && <Button kind="plain" onClick={() => onConfirm(source.read as Quantity)}>أكّدي</Button>}
          {canEdit && <Button kind="plain" onClick={() => setEditing(true)}>{source.confirmed || source.read ? 'عدّلي' : 'أدخلي كمية'}</Button>}
          {canEdit && source.confirmed && <Button kind="plain" onClick={onClear}>تراجعي</Button>}
        </span>
      )}
      {editing && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (quantity !== null) {
              onConfirm({ quantity, unit })
              setEditing(false)
            }
          }}
        >
          <label className="flex flex-col gap-1 text-xs font-medium">
            الكمية
            <input inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} className="min-h-11 w-24 rounded-xl border border-line bg-bg px-3 text-base font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            الوحدة
            <select value={unit ?? ''} onChange={(e) => setUnit((e.target.value || null) as Unit)} className="min-h-11 rounded-xl border border-line bg-bg px-3 text-base font-normal">
              {UNITS.map((u) => (
                <option key={u.unit ?? 'count'} value={u.unit ?? ''}>{u.name}</option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={quantity === null}>احفظي وأكّدي</Button>
          <Button kind="plain" onClick={() => setEditing(false)}>إلغاء</Button>
        </form>
      )}
    </li>
  )
}
