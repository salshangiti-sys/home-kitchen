// "Earlier versions" on a recipe page: every version that was kept, newest first. Opening one shows
// what changed since the version before it (added and removed lines) and, below, that version's
// full text. An owner or editor can restore an earlier version: it is saved as a NEW version, so
// nothing is lost and the version it replaces stays in this list. No version is ever deleted.

import { useEffect, useState } from 'react'
import { Button, Notice } from '../ui'
import { daysAgo, formatDate, historyMessage, localDate } from './api'
import { compare, docLines, listVersions, originLabel, restoreVersion, type Line, type RecipeVersion } from './versions'

// 'yes': can restore. 'linked': an editor, but the recipe's text lives in OneNote. 'no': read only.
export type RestoreMode = 'yes' | 'linked' | 'no'

interface Api {
  listVersions: typeof listVersions
  restoreVersion: typeof restoreVersion
}

interface Props {
  recipeId: string
  currentVersion: number // when the recipe changes while the page is open, the list is read again
  restore?: RestoreMode
  onRestored?: () => void
  today?: () => string
  api?: Api
}

const real: Api = { listVersions, restoreVersion }

const restoreMessage = (e: unknown) => (/not allowed|42501/i.test(e instanceof Error ? e.message : '') ? 'لا تملكين صلاحية تعديل هذه الوصفة.' : historyMessage(e))

export default function VersionHistory({ recipeId, currentVersion, restore = 'no', onRestored, today = localDate, api = real }: Props) {
  const [versions, setVersions] = useState<RecipeVersion[] | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<{ tone: 'plain' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let live = true
    api.listVersions(recipeId).then(
      (list) => live && setVersions(list),
      (e: unknown) => live && (setVersions((current) => current ?? []), setError(historyMessage(e))),
    )
    return () => {
      live = false
    }
  }, [api, recipeId, currentVersion])

  if (versions === null) return null
  if (error) return <Notice tone="error">{error}</Notice>
  // One version is the recipe itself: nothing earlier to look at.
  if (versions.length < 2) return null

  const now = today()
  const newest = versions[0].version
  const doRestore = async (version: number) => {
    setBusy(true)
    setOutcome(null)
    try {
      const result = await api.restoreVersion(recipeId, version, newest)
      setOutcome({
        tone: 'plain',
        text: result.result === 'unchanged' ? `الإصدار ${version} مطابق للوصفة الحالية، فلم يتغير شيء.` : `استُرجع الإصدار ${version}، وحُفظ كإصدار جديد (${result.version}).`,
      })
      setConfirming(null)
      setOpen(null)
      if (result.result === 'updated') onRestored?.()
    } catch (e) {
      setOutcome({ tone: 'error', text: restoreMessage(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label="الإصدارات السابقة" className="rounded-2xl border border-line bg-surface p-5">
      <h3 className="mb-1 text-lg font-semibold">الإصدارات السابقة</h3>
      <p className="mb-3 text-sm text-muted">كل تغيير في الوصفة يحفظ نسخة منها. افتحي إصدارًا لترين ما تغيّر فيه.</p>
      {outcome && <div className="mb-3"><Notice tone={outcome.tone}>{outcome.text}</Notice></div>}
      <ul className="flex flex-col gap-2">
        {versions.map((entry, index) => {
          const previous = versions[index + 1]
          const day = localDate(new Date(entry.changed_at))
          const expanded = open === entry.version
          return (
            <li key={entry.version} className="rounded-xl border border-line">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => {
                  setOpen(expanded ? null : entry.version)
                  setConfirming(null)
                }}
                className="flex min-h-12 w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-start"
              >
                <span className="font-medium">
                  الإصدار {entry.version}
                  {index === 0 && <span className="text-sm font-normal text-muted"> (الحالي)</span>}
                </span>
                <span className="text-sm text-muted">
                  {formatDate(day)} ({daysAgo(day, now)}) · {originLabel(entry.origin, entry.version)}
                </span>
              </button>
              {expanded && (
                <Detail
                  version={entry}
                  previous={previous}
                  restore={index === 0 ? 'no' : restore}
                  newest={newest}
                  confirming={confirming === entry.version}
                  busy={busy}
                  onAsk={() => setConfirming(entry.version)}
                  onCancel={() => setConfirming(null)}
                  onConfirm={() => void doRestore(entry.version)}
                />
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

interface DetailProps {
  version: RecipeVersion
  previous: RecipeVersion | undefined
  restore: RestoreMode
  newest: number
  confirming: boolean
  busy: boolean
  onAsk: () => void
  onCancel: () => void
  onConfirm: () => void
}

function Detail({ version, previous, restore, newest, confirming, busy, onAsk, onCancel, onConfirm }: DetailProps) {
  const lines = docLines(version.snapshot)
  const result = previous ? compare(docLines(previous.snapshot), lines) : null
  return (
    <div className="flex flex-col gap-3 border-t border-line p-3">
      {!result && <p className="text-sm text-muted">هذا أول إصدار محفوظ للوصفة.</p>}
      {result && (
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">ما تغيّر عن الإصدار {previous!.version}</h4>
          {result.changes.length === 0 ? (
            <p className="text-sm text-muted">لا فرق في النص الظاهر (ربما تغيّر شيء آخر كالربط بصفحة OneNote).</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {result.changes.map((change, i) => (
                <li
                  key={i}
                  className={`flex flex-col gap-0.5 rounded-lg px-3 py-2 ${
                    change.kind === 'added' ? 'bg-green-100 text-green-950 dark:bg-green-950/60 dark:text-green-100' : 'bg-red-100 text-red-950 dark:bg-red-950/60 dark:text-red-100'
                  }`}
                >
                  <span className="text-xs font-semibold">
                    {change.kind === 'added' ? 'أُضيف' : 'حُذف'} · {change.line.label}
                  </span>
                  <span dir="auto" className="leading-relaxed">{change.line.text}</span>
                </li>
              ))}
            </ul>
          )}
          {result.unchanged > 0 && <p className="text-xs text-muted">{result.unchanged} سطرًا لم يتغير.</p>}
        </div>
      )}
      {restore === 'linked' && (
        <p className="text-sm text-muted">نص هذه الوصفة يُقرأ من صفحتها في OneNote، لذلك لا يُسترجع إصدار قديم هنا. لاستعادة نص قديم، عدّلي الصفحة في OneNote.</p>
      )}
      {restore === 'yes' && !confirming && (
        <div>
          <Button kind="plain" onClick={onAsk}>استرجعي هذا الإصدار</Button>
        </div>
      )}
      {restore === 'yes' && confirming && (
        <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
          <p className="text-sm leading-relaxed">
            تعود الوصفة (النص والمقادير والوسوم) كما كانت في الإصدار {version.version}، وتُحفظ كإصدار جديد ({newest + 1}). لا يضيع شيء: الإصدار الحالي يبقى في هذه القائمة ويمكن استرجاعه. لا يتغير سجل التجارب ولا الصور ولا المفضلة.
          </p>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={onConfirm}>نعم، استرجعيه</Button>
            <Button kind="plain" onClick={onCancel}>إلغاء</Button>
          </div>
        </div>
      )}
      <details className="rounded-lg border border-line p-3">
        <summary className="cursor-pointer text-sm font-medium">نص هذا الإصدار كاملًا</summary>
        <FullText lines={lines} />
      </details>
    </div>
  )
}

// The version's lines, grouped under their labels in page order.
function FullText({ lines }: { lines: Line[] }) {
  const groups: Array<{ label: string; texts: string[] }> = []
  for (const line of lines) {
    const last = groups[groups.length - 1]
    if (last && last.label === line.label) last.texts.push(line.text)
    else groups.push({ label: line.label, texts: [line.text] })
  }
  return (
    <dl className="mt-3 flex flex-col gap-2">
      {groups.map((group, i) => (
        <div key={i}>
          <dt className="text-xs font-semibold text-muted">{group.label}</dt>
          {group.texts.map((text, j) => (
            <dd key={j} dir="auto" className="leading-relaxed">{text}</dd>
          ))}
        </div>
      ))}
    </dl>
  )
}
