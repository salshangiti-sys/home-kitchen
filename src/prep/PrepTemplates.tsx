// What a recipe needs before cooking, on its page: owners and editors write the prep steps (kind and
// timing), and the plan turns them into tasks for each meal that uses the recipe. For ingredient lines
// that may need the freezer, the app only suggests a step; nothing is added unless you add it.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge, Button, Notice } from '../ui'
import { KINDS, KIND_LABELS, TIMINGS, TIMING_LABELS, listTemplates, prepMessage, removeTemplate, saveTemplate, shortTime, suggestPrep, type PrepKind, type PrepTiming, type Template, type TemplateInput } from './api'

interface Api {
  listTemplates: typeof listTemplates
  saveTemplate: typeof saveTemplate
  removeTemplate: typeof removeTemplate
}

const real: Api = { listTemplates, saveTemplate, removeTemplate }

interface Props {
  recipeId: string
  canEdit: boolean
  ingredientLines: string[]
  api?: Api
}

export default function PrepTemplates({ recipeId, canEdit, ingredientLines, api = real }: Props) {
  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setTemplates(await api.listTemplates(recipeId))
    } catch (e) {
      setTemplates((current) => current ?? [])
      setError(prepMessage(e))
    }
  }, [api, recipeId])

  useEffect(() => {
    void load()
  }, [load])

  const suggestions = useMemo(
    () => (canEdit && templates ? suggestPrep(ingredientLines).filter((s) => !templates.some((t) => t.body === s.body)) : []),
    [canEdit, templates, ingredientLines],
  )

  if (templates === null) return null
  if (!canEdit && templates.length === 0 && !error) return null

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
      setEditing(null)
      setConfirming(null)
      await load()
    } catch (e) {
      setError(prepMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="تجهيزات الوصفة" className="rounded-2xl border border-line bg-surface p-5">
      <h3 className="mb-1 text-lg font-semibold">تجهيزات الوصفة</h3>
      <p className="mb-3 text-sm text-muted">ما يلزم قبل الطبخ (إذابة، غسل وتقطيع، تتبيلة…). تتحول إلى مهام لكل وجبة تضعينها في الخطة.</p>

      {error && <div className="mb-3"><Notice tone="error">{error}</Notice></div>}

      {templates.length > 0 && (
        <ul className="flex flex-col gap-2">
          {templates.map((t) =>
            editing === t.id ? (
              <li key={t.id}>
                <TemplateForm initial={t} busy={busy} submitLabel="احفظي التعديل" onSubmit={(input) => run(() => api.saveTemplate(t.id, recipeId, input))} onCancel={() => setEditing(null)} />
              </li>
            ) : (
              <li key={t.id} className="flex flex-col gap-1 rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="accent">{KIND_LABELS[t.kind]}</Badge>
                  <Badge>{t.timing === 'at_time' ? `الساعة ${shortTime(t.at_time)}` : TIMING_LABELS[t.timing]}</Badge>
                </div>
                <p dir="auto" className="leading-relaxed">{t.body}</p>
                {canEdit && confirming !== t.id && (
                  <div className="flex gap-2">
                    <Button kind="plain" onClick={() => setEditing(t.id)}>تعديل</Button>
                    <Button kind="plain" onClick={() => setConfirming(t.id)}>حذف</Button>
                  </div>
                )}
                {canEdit && confirming === t.id && (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm">يُحذف هذا التجهيز، وتُزال مهامه التي لم تُلمس ولم تُنجَز من الخطة.</p>
                    <div className="flex gap-2">
                      <Button kind="danger" disabled={busy} onClick={() => run(() => api.removeTemplate(t.id))}>نعم، احذفيه</Button>
                      <Button kind="plain" onClick={() => setConfirming(null)}>إلغاء</Button>
                    </div>
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
      )}
      {templates.length === 0 && <p className="text-sm text-muted">لا تجهيزات مكتوبة لهذه الوصفة بعد.</p>}

      {suggestions.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <h4 className="text-sm font-semibold">اقتراحات (لا تُضاف وحدها)</h4>
          <ul className="flex flex-col gap-2">
            {suggestions.map((s) => (
              <li key={s.line} className="flex flex-col gap-2 rounded-xl border border-dashed border-line p-3">
                <p dir="auto" className="text-sm">«{s.line}» قد يحتاج إخراجًا من الفريزر.</p>
                <div>
                  <Button kind="plain" disabled={busy} onClick={() => run(() => api.saveTemplate(null, recipeId, { kind: s.kind, timing: s.timing, atTime: null, body: s.body }))}>
                    أضيفي: {s.body}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canEdit && editing === null && (
        <div className="mt-4">
          <Button onClick={() => setEditing('new')}>أضيفي تجهيزًا</Button>
        </div>
      )}
      {canEdit && editing === 'new' && (
        <TemplateForm initial={null} busy={busy} submitLabel="أضيفي" onSubmit={(input) => run(() => api.saveTemplate(null, recipeId, input))} onCancel={() => setEditing(null)} />
      )}
    </section>
  )
}

function TemplateForm({ initial, busy, submitLabel, onSubmit, onCancel }: { initial: Template | null; busy: boolean; submitLabel: string; onSubmit: (input: TemplateInput) => void; onCancel: () => void }) {
  const [kind, setKind] = useState<PrepKind>(initial?.kind ?? 'other')
  const [timing, setTiming] = useState<PrepTiming>(initial?.timing ?? 'before_cooking')
  const [time, setTime] = useState(shortTime(initial?.at_time ?? null) ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const ready = body.trim() !== '' && (timing !== 'at_time' || time !== '')

  return (
    <form
      className="mt-3 flex flex-col gap-3 rounded-xl border border-line p-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready) onSubmit({ kind, timing, atTime: timing === 'at_time' ? time : null, body })
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-medium">
        النوع
        <select value={kind} onChange={(e) => setKind(e.target.value as PrepKind)} className="min-h-11 rounded-xl border border-line bg-bg px-3 text-base font-normal">
          {KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        التوقيت
        <select value={timing} onChange={(e) => setTiming(e.target.value as PrepTiming)} className="min-h-11 rounded-xl border border-line bg-bg px-3 text-base font-normal">
          {TIMINGS.map((t) => <option key={t} value={t}>{TIMING_LABELS[t]}</option>)}
        </select>
      </label>
      {timing === 'at_time' && (
        <label className="flex flex-col gap-1 text-sm font-medium">
          الساعة
          <input type="time" required value={time} onChange={(e) => setTime(e.target.value)} className="min-h-11 rounded-xl border border-line bg-bg px-3 text-base font-normal" />
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm font-medium">
        ماذا تفعلين؟
        <input dir="auto" maxLength={200} value={body} onChange={(e) => setBody(e.target.value)} placeholder="مثال: أخرجي الدجاج من الفريزر" className="min-h-11 rounded-xl border border-line bg-bg px-3 text-base font-normal" />
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !ready}>{submitLabel}</Button>
        <Button kind="plain" onClick={onCancel}>إلغاء</Button>
      </div>
    </form>
  )
}
