// The small editors inside a row of the review page: change a recipe's tags, food groups and prep
// tasks where they are listed. Each change is saved at once; nothing here touches the ingredients,
// which come from the OneNote page (changed there) or from what she confirmed in «المقادير».

import { useState } from 'react'
import { FOOD_GROUPS, FOOD_GROUP_LABELS, type FoodGroup } from '../nutrition/api'
import { KINDS, KIND_LABELS, TIMING_LABELS, type PrepKind, type PrepTiming, type TemplateInput } from '../prep/api'
import type { PrepItem } from './overview'

const FIELD = 'min-h-10 rounded-xl border border-line bg-bg px-3 text-sm'
const SMALL = 'min-h-9 rounded-full border px-3 text-sm disabled:opacity-50'
const MAX_TAG = 40

// Tags she uses often, offered as one-tap chips so she does not type them on the phone.
export const SUGGESTED_TAGS = ['دجاج', 'صدور دجاج', 'دجاج مفتفت', 'لحم مفروم', 'لحم كبير', 'كفتة', 'سريع', 'سناك/خفايف', 'تجهيز مُسبق', 'قلاش', 'صوص طماطم'] as const

export function TagsEditor({ tags, busy, onChange }: { tags: string[]; busy: boolean; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const offered = SUGGESTED_TAGS.filter((s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase()))
  const add = () => {
    const name = draft.trim()
    if (!name || name.length > MAX_TAG) return
    setDraft('')
    if (!tags.some((t) => t.toLowerCase() === name.toLowerCase())) onChange([...tags, name])
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((tag) => (
        <span key={tag} dir="auto" className="inline-flex min-h-9 items-center gap-1 rounded-full border border-accent px-3 text-sm text-accent">
          {tag}
          <button type="button" aria-label={`احذفي الوسم ${tag}`} disabled={busy} onClick={() => onChange(tags.filter((t) => t !== tag))} className="px-1 disabled:opacity-50">
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        dir="auto"
        maxLength={MAX_TAG}
        placeholder="+ وسم"
        aria-label="وسم جديد"
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add()
          }
        }}
        onBlur={add}
        className={`${FIELD} w-28`}
      />
      {offered.map((name) => (
        <button
          key={name}
          type="button"
          dir="auto"
          aria-label={`أضيفي الوسم ${name}`}
          disabled={busy}
          onClick={() => onChange([...tags, name])}
          className="min-h-9 rounded-full border border-dashed border-line px-3 text-sm text-muted disabled:opacity-50"
        >
          + {name}
        </button>
      ))}
    </div>
  )
}

export function GroupsEditor({ groups, busy, onChange }: { groups: FoodGroup[]; busy: boolean; onChange: (groups: FoodGroup[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="العناصر الغذائية">
      {FOOD_GROUPS.map((group) => {
        const on = groups.includes(group)
        return (
          <button
            key={group}
            type="button"
            aria-pressed={on}
            disabled={busy}
            onClick={() => onChange(FOOD_GROUPS.filter((g) => (g === group ? !on : groups.includes(g))))}
            className={`${SMALL} ${on ? 'border-accent bg-accent text-on-accent' : 'border-line text-ink'}`}
          >
            {FOOD_GROUP_LABELS[group]}
          </button>
        )
      })}
    </div>
  )
}

// The times she can choose here. A task at a given hour keeps its hour and is changed on the recipe's page.
const TIMINGS_HERE: PrepTiming[] = ['night_before', 'morning', 'before_cooking']

function PrepRow({ item, busy, onSave, onRemove }: { item: PrepItem; busy: boolean; onSave: (id: string, task: TemplateInput) => void; onRemove: (id: string) => void }) {
  const [body, setBody] = useState(item.body)
  const fixed = item.timing === 'at_time'
  const save = (patch: Partial<TemplateInput>) => onSave(item.id, { kind: item.kind, timing: item.timing, atTime: item.atTime, body: item.body, ...patch })
  const commit = () => {
    const text = body.trim()
    if (!text || text === item.body) return setBody(item.body)
    save({ body: text })
  }
  return (
    <li className="flex flex-col gap-2 p-2 rounded-2xl bg-surface ring-1 ring-line">
      <div className="flex flex-wrap gap-2">
        <select aria-label="نوع التجهيز" value={item.kind} disabled={busy} onChange={(e) => save({ kind: e.target.value as PrepKind })} className={FIELD}>
          {KINDS.map((k) => (
            <option key={k} value={k}>{KIND_LABELS[k]}</option>
          ))}
        </select>
        <select aria-label="موعد التجهيز" value={item.timing} disabled={busy || fixed} onChange={(e) => save({ timing: e.target.value as PrepTiming, atTime: null })} className={FIELD}>
          {(fixed ? (['at_time'] as PrepTiming[]) : TIMINGS_HERE).map((t) => (
            <option key={t} value={t}>{TIMING_LABELS[t]}</option>
          ))}
        </select>
        <button type="button" aria-label="احذفي التجهيز" disabled={busy} onClick={() => onRemove(item.id)} className={`${SMALL} border-red-600 text-red-700 dark:text-red-400`}>
          حذف
        </button>
      </div>
      <input
        value={body}
        dir="auto"
        maxLength={200}
        aria-label="نص التجهيز"
        disabled={busy}
        onChange={(e) => setBody(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
        className={`${FIELD} w-full`}
      />
    </li>
  )
}

export function PrepEditor({ items, busy, onSave, onRemove, onAdd }: { items: PrepItem[]; busy: boolean; onSave: (id: string, task: TemplateInput) => void; onRemove: (id: string) => void; onAdd: (task: TemplateInput) => void }) {
  const [text, setText] = useState('')
  const [kind, setKind] = useState<PrepKind>('other')
  const [timing, setTiming] = useState<PrepTiming>('before_cooking')
  const add = () => {
    const body = text.trim()
    if (!body) return
    setText('')
    onAdd({ kind, timing, atTime: null, body })
  }
  return (
    <div className="flex flex-col gap-2">
      {items.length === 0 ? (
        <p className="text-muted">لا تجهيزات.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <PrepRow key={`${item.id}:${item.body}:${item.kind}:${item.timing}`} item={item} busy={busy} onSave={onSave} onRemove={onRemove} />
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <select aria-label="نوع التجهيز الجديد" value={kind} onChange={(e) => setKind(e.target.value as PrepKind)} className={FIELD}>
          {KINDS.map((k) => (
            <option key={k} value={k}>{KIND_LABELS[k]}</option>
          ))}
        </select>
        <select aria-label="موعد التجهيز الجديد" value={timing} onChange={(e) => setTiming(e.target.value as PrepTiming)} className={FIELD}>
          {TIMINGS_HERE.map((t) => (
            <option key={t} value={t}>{TIMING_LABELS[t]}</option>
          ))}
        </select>
        <input
          value={text}
          dir="auto"
          maxLength={200}
          aria-label="تجهيز جديد"
          placeholder="+ تجهيز جديد"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          className={`${FIELD} min-w-0 flex-1`}
        />
        <button type="button" disabled={busy || !text.trim()} onClick={add} className={`${SMALL} border-line text-ink`}>
          أضيفي
        </button>
      </div>
    </div>
  )
}
