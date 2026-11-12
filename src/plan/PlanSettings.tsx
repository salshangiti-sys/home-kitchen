// Plan settings for owners and editors: the day a week starts, the meal slots, and the people meals
// can be planned for.

import { useState } from 'react'
import { Button, Card, Notice } from '../ui'
import { weekdayName } from './dates'
import { planMessage, type Person, type Slot } from './api'

export interface SettingsApi {
  setWeekStart: (dow: number) => Promise<unknown>
  saveSlot: (id: string | null, name: string, position: number | null) => Promise<unknown>
  removeSlot: (id: string) => Promise<unknown>
  savePerson: (id: string | null, name: string, kind: 'adult' | 'child', allergies: string[], notes: string) => Promise<unknown>
  removePerson: (id: string) => Promise<unknown>
}

interface Props {
  startDow: number
  slots: Slot[]
  people: Person[]
  api: SettingsApi
  onChanged: () => void
}

// 2026-11-14 is a Saturday: the names of the seven days from Sunday (0) to Saturday (6).
const dowName = (dow: number) => weekdayName(`2026-11-${15 + dow}`)

export default function PlanSettings({ startDow, slots, people, api, onChanged }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
      onChanged()
    } catch (e) {
      setError(planMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="إعدادات الخطة">
      <div className="flex flex-col gap-6">
        {error && <Notice tone="error">{error}</Notice>}

        <label className="flex flex-col gap-1 text-sm font-medium">
          يبدأ الأسبوع يوم
          <select value={startDow} disabled={busy} onChange={(e) => void run(() => api.setWeekStart(Number(e.target.value)))} className="min-h-11 rounded-xl border border-line bg-bg px-3 text-base font-normal">
            {[0, 1, 2, 3, 4, 5, 6].map((dow) => <option key={dow} value={dow}>{dowName(dow)}</option>)}
          </select>
        </label>

        <section aria-label="خانات الوجبات" className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">خانات الوجبات</h4>
          <ul className="flex flex-col gap-2">
            {slots.map((slot, index) => (
              <SlotRow
                key={slot.id}
                slot={slot}
                first={index === 0}
                last={index === slots.length - 1}
                busy={busy}
                onRename={(name) => void run(() => api.saveSlot(slot.id, name, slot.position))}
                onMove={(delta) => {
                  const other = slots[index + delta]
                  void run(async () => {
                    await api.saveSlot(slot.id, slot.name, other.position)
                    await api.saveSlot(other.id, other.name, slot.position)
                  })
                }}
                onRemove={() => void run(() => api.removeSlot(slot.id))}
              />
            ))}
          </ul>
          <NewSlot busy={busy} onAdd={(name) => void run(() => api.saveSlot(null, name, null))} />
        </section>

        <section aria-label="أفراد الأسرة" className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">أفراد الأسرة</h4>
          <p className="text-xs text-muted">من تُخطَّط لهم الوجبات. لا عمر مفترض؛ الحساسية والملاحظات تُكتب بحرّيتك.</p>
          <ul className="flex flex-col gap-2">
            {people.map((person) => (
              <PersonRow
                key={person.id}
                person={person}
                busy={busy}
                onSave={(name, kind, allergies, notes) => void run(() => api.savePerson(person.id, name, kind, allergies, notes))}
                onRemove={() => void run(() => api.removePerson(person.id))}
              />
            ))}
          </ul>
          <PersonRow person={null} busy={busy} onSave={(name, kind, allergies, notes) => void run(() => api.savePerson(null, name, kind, allergies, notes))} onRemove={() => undefined} />
        </section>
      </div>
    </Card>
  )
}

function SlotRow({ slot, first, last, busy, onRename, onMove, onRemove }: { slot: Slot; first: boolean; last: boolean; busy: boolean; onRename: (name: string) => void; onMove: (delta: -1 | 1) => void; onRemove: () => void }) {
  const [name, setName] = useState(slot.name)
  const [confirming, setConfirming] = useState(false)
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line p-2">
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label={`اسم الخانة ${slot.name}`} dir="auto" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-base" />
        <Button kind="plain" disabled={busy || name.trim() === '' || name.trim() === slot.name} onClick={() => onRename(name)}>احفظي الاسم</Button>
        <Button kind="plain" disabled={busy || first} onClick={() => onMove(-1)}>↑ {slot.name}</Button>
        <Button kind="plain" disabled={busy || last} onClick={() => onMove(1)}>↓ {slot.name}</Button>
        <Button kind="plain" onClick={() => setConfirming(true)}>حذف {slot.name}</Button>
      </div>
      {confirming && (
        <div className="flex flex-col gap-2 text-sm">
          <p>تُخفى الخانة. لا تُحذف إن كانت فيها وجبات مخطَّطة.</p>
          <div className="flex gap-2">
            <Button kind="danger" disabled={busy} onClick={() => { onRemove(); setConfirming(false) }}>نعم، احذفيها</Button>
            <Button kind="plain" onClick={() => setConfirming(false)}>إلغاء</Button>
          </div>
        </div>
      )}
    </li>
  )
}

function NewSlot({ busy, onAdd }: { busy: boolean; onAdd: (name: string) => void }) {
  const [name, setName] = useState('')
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onAdd(name); setName('') } }}>
      <input aria-label="اسم خانة جديدة" dir="auto" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="خانة جديدة، مثل: تحلية" className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-base" />
      <Button type="submit" disabled={busy || name.trim() === ''}>أضيفي خانة</Button>
    </form>
  )
}

function PersonRow({ person, busy, onSave, onRemove }: { person: Person | null; busy: boolean; onSave: (name: string, kind: 'adult' | 'child', allergies: string[], notes: string) => void; onRemove: () => void }) {
  const [name, setName] = useState(person?.name ?? '')
  const [kind, setKind] = useState<'adult' | 'child'>(person?.kind ?? 'adult')
  const [allergies, setAllergies] = useState((person?.allergies ?? []).join('، '))
  const [notes, setNotes] = useState(person?.notes ?? '')
  const [confirming, setConfirming] = useState(false)
  const label = person ? person.name : 'جديد'
  const split = (text: string) => text.split(/[,،]/).map((a) => a.trim()).filter(Boolean)

  return (
    <li className="flex list-none flex-col gap-2 rounded-xl border border-line p-3">
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          onSave(name, kind, split(allergies), notes)
          if (!person) {
            setName('')
            setAllergies('')
            setNotes('')
            setKind('adult')
          }
        }}
      >
        <div className="flex flex-wrap gap-2">
          <input aria-label={`الاسم (${label})`} dir="auto" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="الاسم" className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-base" />
          <select aria-label={`النوع (${label})`} value={kind} onChange={(e) => setKind(e.target.value as 'adult' | 'child')} className="min-h-11 rounded-xl border border-line bg-bg px-3 text-base">
            <option value="adult">بالغ</option>
            <option value="child">طفل</option>
          </select>
        </div>
        <input aria-label={`الحساسية (${label})`} dir="auto" value={allergies} onChange={(e) => setAllergies(e.target.value)} placeholder="الحساسية، افصلي بفاصلة" className="min-h-11 rounded-xl border border-line bg-bg px-3 text-base" />
        <input aria-label={`ملاحظات (${label})`} dir="auto" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات" className="min-h-11 rounded-xl border border-line bg-bg px-3 text-base" />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || name.trim() === ''}>{person ? `احفظي ${person.name}` : 'أضيفي شخصًا'}</Button>
          {person && !confirming && <Button kind="plain" onClick={() => setConfirming(true)}>حذف {person.name}</Button>}
        </div>
      </form>
      {person && confirming && (
        <div className="flex flex-col gap-2 text-sm">
          <p>يُخفى من القائمة. الوجبات التي خُطِّطت له تبقى.</p>
          <div className="flex gap-2">
            <Button kind="danger" disabled={busy} onClick={() => { onRemove(); setConfirming(false) }}>نعم، احذفيه</Button>
            <Button kind="plain" onClick={() => setConfirming(false)}>إلغاء</Button>
          </div>
        </div>
      )}
    </li>
  )
}
