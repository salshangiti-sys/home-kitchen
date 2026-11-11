// The panel for tagging the selected recipes: pick what to change, see how many recipes it would
// change, then apply. Only tags are touched, and each changed recipe keeps its earlier version in
// the version history. Nothing happens until the person agrees to the preview.

import { useEffect, useState } from 'react'
import { Button, Notice } from '../ui'
import { MAX_RECIPES, bulkMessage, bulkTag, buildChanges, emptyChoices, previewText, type BulkChoices, type BulkResult, type Choice, type MealAction } from './bulkTag'
import { MEAL_TYPES, MEAL_TYPE_LABELS, type MealType } from './types'

interface Props {
  ids: string[]
  onApplied: (changed: number) => void // the list is read again by the caller
  onClose: () => void
  api?: { bulkTag: typeof bulkTag }
}

const CHOICES: Array<[Choice, string]> = [
  ['keep', 'بدون تغيير'],
  ['yes', 'نعم'],
  ['no', 'لا'],
  ['unset', 'غير محدد'],
]

const NEXT: Record<string, MealAction | undefined> = { none: 'add', add: 'remove', remove: undefined }

export default function BulkTagPanel({ ids, onApplied, onClose, api = { bulkTag } }: Props) {
  const [choices, setChoices] = useState<BulkChoices>(emptyChoices)
  const [preview, setPreview] = useState<BulkResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Any new choice, or a different selection, makes an earlier preview out of date.
  const selection = ids.join('\n')
  useEffect(() => {
    setPreview(null)
  }, [choices, selection])

  const { changes, problem } = buildChanges(choices)
  const tooMany = ids.length > MAX_RECIPES
  const update = (patch: Partial<BulkChoices>) => {
    setError(null)
    setChoices((c) => ({ ...c, ...patch }))
  }
  const cycle = (type: MealType) => {
    const current = choices.meals[type]
    const next = NEXT[current ?? 'none']
    const meals = { ...choices.meals }
    if (next) meals[type] = next
    else delete meals[type]
    update({ meals })
  }

  const run = async (dryRun: boolean) => {
    if (!changes) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.bulkTag(ids, changes, dryRun)
      if (dryRun) setPreview(result)
      else onApplied(result.changed)
    } catch (e) {
      setError(bulkMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const label = (type: MealType) => {
    const action = choices.meals[type]
    return action === 'add' ? `+ ${MEAL_TYPE_LABELS[type]}` : action === 'remove' ? `− ${MEAL_TYPE_LABELS[type]}` : MEAL_TYPE_LABELS[type]
  }
  const state = (type: MealType) => (choices.meals[type] === 'add' ? 'ستُضاف' : choices.meals[type] === 'remove' ? 'ستُزال' : 'بدون تغيير')

  return (
    <section aria-label="توسيم المحدّد" className="flex flex-col gap-4 rounded-2xl border border-accent bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">توسيم {ids.length} {ids.length === 1 ? 'وصفة' : 'وصفات'}</h3>
        <Button kind="plain" onClick={onClose}>إغلاق</Button>
      </div>
      <p className="text-sm text-muted">تتغير الوسوم فقط، ولا يُمسّ نص أي وصفة. كل وصفة تتغير تحفظ إصدارها السابق في «الإصدارات السابقة».</p>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">نوع الوجبة</legend>
        <div className="flex flex-wrap gap-2">
          {MEAL_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              aria-label={`${MEAL_TYPE_LABELS[type]}: ${state(type)}`}
              onClick={() => cycle(type)}
              className={`min-h-11 rounded-full border px-4 text-sm font-medium ${
                choices.meals[type] === 'add' ? 'border-accent bg-accent text-on-accent' : choices.meals[type] === 'remove' ? 'border-red-600 text-red-700 dark:text-red-400' : 'border-line'
              }`}
            >
              {label(type)}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted">اضغطي على النوع: مرة للإضافة (+)، ومرة للإزالة (−)، ومرة ثالثة لتركه كما هو.</span>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <ChoiceSelect label="مناسبة للأطفال" value={choices.kid} onChange={(kid) => update({ kid })} />
        <ChoiceSelect label="لانش بوكس" value={choices.lunchbox} onChange={(lunchbox) => update({ lunchbox })} />
      </div>

      <label className="flex flex-col gap-1 text-sm font-medium">
        وسوم خاصة تُضاف (افصلي بينها بفاصلة)
        <input
          dir="auto"
          value={choices.custom}
          onChange={(e) => update({ custom: e.target.value })}
          placeholder="مثال: سريعة، عائلية"
          className="min-h-11 rounded-xl border border-line bg-bg px-3 text-base font-normal"
        />
      </label>

      {problem && <Notice tone="error">{problem}</Notice>}
      {tooMany && <Notice tone="error">يمكن توسيم حتى {MAX_RECIPES} وصفة في المرة الواحدة. قلّلي المحدّد.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {preview && <Notice>{previewText(preview, ids.length)}</Notice>}

      <div className="flex flex-wrap gap-2">
        {!preview && (
          <Button disabled={busy || !changes || tooMany || ids.length === 0} onClick={() => run(true)}>
            معاينة ما سيتغير
          </Button>
        )}
        {preview && preview.changed > 0 && (
          <Button disabled={busy} onClick={() => run(false)}>
            نعم، طبّقي على {preview.changed} {preview.changed === 1 ? 'وصفة' : 'وصفات'}
          </Button>
        )}
        {preview && <Button kind="plain" onClick={() => setPreview(null)}>رجوع</Button>}
      </div>
    </section>
  )
}

function ChoiceSelect({ label, value, onChange }: { label: string; value: Choice; onChange: (value: Choice) => void }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as Choice)} className="min-h-11 rounded-xl border border-line bg-bg px-3 text-base font-normal">
        {CHOICES.map(([choice, text]) => (
          <option key={choice} value={choice}>{text}</option>
        ))}
      </select>
    </label>
  )
}
