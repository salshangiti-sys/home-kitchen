// «الفريزر»: what is in the freezer, with quantities. Add an item, change it, take one off with
// «استعملت» (the item goes when nothing is left), or remove it. Readers see; owners and editors change.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { href } from '../router'
import { Badge, Button, Card, Notice } from '../ui'
import { todayIso } from '../plan/dates'
import { listRecipes } from '../library/api'
import { UNITS, freezerMessage, loadFreezer, removeFreezerItem, saveFreezerItem, useFreezerItem, type FreezerInput, type FreezerItem } from './api'
import { frozenAgo, isOld, quantityText } from './model'

export interface FrozenRecipe {
  id: string
  title: string
  section: string
}

export interface FreezerApi {
  loadFreezer: typeof loadFreezer
  loadFrozenRecipes: () => Promise<FrozenRecipe[]> // the recipe pages of the section «مفرزنات»
  saveItem: typeof saveFreezerItem
  useItem: typeof useFreezerItem
  removeItem: typeof removeFreezerItem
}

export const FROZEN_SECTION = 'مفرزنات'
export const inFrozenSection = (section: string) => section === FROZEN_SECTION || section.startsWith(`${FROZEN_SECTION} ›`)

const real: FreezerApi = {
  loadFreezer,
  loadFrozenRecipes: async () => (await listRecipes()).recipes.filter((r) => inFrozenSection(r.section)).map(({ id, title, section }) => ({ id, title, section })),
  saveItem: saveFreezerItem,
  useItem: useFreezerItem,
  removeItem: removeFreezerItem,
}

const FIELD = 'min-h-11 w-full rounded-xl border border-line bg-bg px-3'

function ItemForm({ initial, recipes, today, busy, onSave, onCancel }: { initial: FreezerItem | null; recipes: FrozenRecipe[]; today: string; busy: boolean; onSave: (input: FreezerInput) => void; onCancel?: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [quantity, setQuantity] = useState(initial ? String(initial.quantity) : '1')
  const [unit, setUnit] = useState(initial?.unit ?? UNITS[0])
  const [frozenOn, setFrozenOn] = useState(initial?.frozen_on ?? today)
  const [recipeId, setRecipeId] = useState(initial?.recipe_id ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const amount = Number(quantity.replace(',', '.'))
  const ok = name.trim().length > 0 && Number.isFinite(amount) && amount > 0

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ok) return
        onSave({ name: name.trim(), quantity: amount, unit, frozenOn: frozenOn || null, recipeId: recipeId || null, note: note.trim() || null })
        if (!initial) {
          setName('')
          setQuantity('1')
          setNote('')
          setRecipeId('')
        }
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        الصنف
        <input value={name} dir="auto" maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="مثل: كرات لحم" className={FIELD} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          الكمية
          <input value={quantity} inputMode="decimal" onChange={(e) => setQuantity(e.target.value)} className={FIELD} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          الوحدة
          <select value={unit} onChange={(e) => setUnit(e.target.value)} className={FIELD}>
            {(UNITS.includes(unit) ? UNITS : [unit, ...UNITS]).map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        تاريخ التفريز
        <input type="date" value={frozenOn} onChange={(e) => setFrozenOn(e.target.value)} className={FIELD} />
      </label>
      {recipes.length > 0 && (
        <label className="flex flex-col gap-1 text-sm">
          صفحة المفرزنات (اختياري)
          <select value={recipeId} onChange={(e) => setRecipeId(e.target.value)} className={FIELD}>
            <option value="">بدون ربط</option>
            {recipes.map((r) => (
              <option key={r.id} value={r.id}>{r.title} · {r.section}</option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm">
        ملاحظة (اختياري)
        <input value={note} dir="auto" maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="مثل: كيس 500 غ، الرف الأعلى" className={FIELD} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || !ok}>{initial ? 'احفظي التعديل' : 'أضيفي إلى الفريزر'}</Button>
        {onCancel && <Button kind="plain" onClick={onCancel}>إلغاء</Button>}
      </div>
    </form>
  )
}

function ItemRow({ item, canEdit, busy, today, onUse, onEdit, onRemove, onPlus }: { item: FreezerItem; canEdit: boolean; busy: boolean; today: string; onUse: () => void; onEdit: () => void; onRemove: () => void; onPlus: () => void }) {
  const [confirming, setConfirming] = useState(false)
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {item.recipe_id ? (
          <a dir="auto" href={href.recipe(item.recipe_id)} className="font-semibold text-accent underline">{item.name}</a>
        ) : (
          <span dir="auto" className="font-semibold">{item.name}</span>
        )}
        <span className="font-semibold">{quantityText(item.quantity, item.unit)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <span>جُمّد {frozenAgo(item.frozen_on, today)}</span>
        {isOld(item.frozen_on, today) && <Badge tone="warn">قديم</Badge>}
        {item.note && <span dir="auto">· {item.note}</span>}
      </div>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={onUse}>استعملت</Button>
          <Button kind="plain" disabled={busy} onClick={onPlus}>+1</Button>
          <Button kind="plain" disabled={busy} onClick={onEdit}>تعديل</Button>
          {confirming ? (
            <>
              <Button kind="danger" disabled={busy} onClick={onRemove}>نعم، احذفيه</Button>
              <Button kind="plain" onClick={() => setConfirming(false)}>إلغاء</Button>
            </>
          ) : (
            <Button kind="plain" disabled={busy} onClick={() => setConfirming(true)}>حذف</Button>
          )}
        </div>
      )}
    </li>
  )
}

export default function FreezerPage({ canEdit, api = real, today = todayIso }: { canEdit: boolean; api?: FreezerApi; today?: () => string }) {
  const [items, setItems] = useState<FreezerItem[] | null>(null)
  const [recipes, setRecipes] = useState<FrozenRecipe[]>([])
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<FreezerItem | null>(null)
  const [adding, setAdding] = useState(false)
  const day = today()

  const load = useCallback(async () => {
    try {
      const [list, frozen] = await Promise.all([api.loadFreezer(), api.loadFrozenRecipes().catch(() => [])])
      setItems(list)
      setRecipes(frozen)
    } catch (e) {
      setError(freezerMessage(e))
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (work: () => Promise<string | void>) => {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const message = await work()
      if (message) setNote(message)
      await load()
    } catch (e) {
      setError(freezerMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const total = useMemo(() => items?.length ?? 0, [items])

  if (!items) return error ? <Notice tone="error">{error}</Notice> : <p className="text-muted">جارٍ التحميل…</p>

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-2xl font-bold">الفريزر</h2>
        <p className="mt-1 text-sm text-muted">ما عندكِ في الفريزر وكمياته. «استعملت» تُنقص واحدًا، ويُحذف الصنف حين لا يبقى منه شيء.</p>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {note && <Notice>{note}</Notice>}

      {canEdit && (
        <Card
          title={editing ? `تعديل «${editing.name}»` : 'إضافة صنف'}
          actions={!editing && !adding ? <Button kind="plain" onClick={() => setAdding(true)}>+ صنف جديد</Button> : undefined}
        >
          {(editing || adding) && (
            <ItemForm
              key={editing?.id ?? 'new'}
              initial={editing}
              recipes={recipes}
              today={day}
              busy={busy}
              onCancel={() => {
                setEditing(null)
                setAdding(false)
              }}
              onSave={(input) =>
                void act(async () => {
                  await api.saveItem(editing?.id ?? null, input)
                  setEditing(null)
                  return editing ? `حُفظ تعديل «${input.name}».` : `أُضيف «${input.name}» إلى الفريزر.`
                })
              }
            />
          )}
          {!editing && !adding && <p className="text-sm text-muted">اضغطي «+ صنف جديد» لتسجيل ما وضعتِه في الفريزر.</p>}
        </Card>
      )}

      <Card title={`في الفريزر (${total})`}>
        {items.length === 0 ? (
          <p className="text-muted">الفريزر فارغ في التطبيق.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                canEdit={canEdit}
                busy={busy}
                today={day}
                onUse={() =>
                  void act(async () => {
                    const left = await api.useItem(item.id)
                    return left > 0 ? `بقي من «${item.name}» ${quantityText(left, item.unit)}.` : `انتهى «${item.name}» وحُذف من الفريزر.`
                  })
                }
                onPlus={() =>
                  void act(async () => {
                    await api.saveItem(item.id, { name: item.name, quantity: item.quantity + 1, unit: item.unit, frozenOn: item.frozen_on, recipeId: item.recipe_id, note: item.note })
                  })
                }
                onEdit={() => {
                  setAdding(false)
                  setEditing(item)
                }}
                onRemove={() =>
                  void act(async () => {
                    await api.removeItem(item.id)
                    return `حُذف «${item.name}».`
                  })
                }
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
