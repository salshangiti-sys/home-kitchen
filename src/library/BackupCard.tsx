// The nightly backup to OneDrive: when the last one ran, whether it was read back and checked, and
// a button to back up now.

import { useCallback, useEffect, useState } from 'react'
import { href } from '../router'
import { Button, Card, LinkButton, Notice } from '../ui'
import { explain } from '../offline/readThrough'
import { backUpNow, backupState, downloadFullBackup, formatBytes, loadBackupRuns, loadStorageUsage, photoLine, usageLines, type BackupRun, type Usage } from './backupStatus'
import { timeAgo } from './onenote'

function Summary({ run }: { run: BackupRun }) {
  const recipes = `${run.recipes ?? 0} وصفة${run.deleted_recipes ? ` (و${run.deleted_recipes} محذوفة)` : ''}`
  const where = run.folder_name ? `OneDrive › Apps › ${run.folder_name}` : 'OneDrive'
  const photos = photoLine(run)
  return (
    <>
      <p className="text-sm text-muted">
        {recipes} · {formatBytes(run.bytes)} · <span dir="ltr">{where}</span>
      </p>
      {photos && <p className={`text-sm ${photos.warn ? 'text-amber-700 dark:text-amber-400' : 'text-muted'}`}>{photos.text}</p>}
    </>
  )
}

function UsageBars({ usage }: { usage: Usage }) {
  return (
    <div className="flex flex-col gap-2" aria-label="استهلاك المساحة">
      {usageLines(usage).map((line) => (
        <div key={line.label} className="flex flex-col gap-1">
          <p className={`text-sm ${line.warn ? 'text-amber-700 dark:text-amber-400' : 'text-muted'}`}>{line.text}{line.warn ? ' (اقتربت من حد الباقة المجانية)' : ''}</p>
          <div role="progressbar" aria-label={line.label} aria-valuenow={line.percent} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-line">
            <div className={`h-full ${line.warn ? 'bg-amber-600' : 'bg-accent'}`} style={{ width: `${Math.max(line.percent, 1)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function BackupCard({ canDownload = true, api = { downloadFullBackup, loadStorageUsage } }: { canDownload?: boolean; api?: { downloadFullBackup: typeof downloadFullBackup; loadStorageUsage: typeof loadStorageUsage } }) {
  const [usage, setUsage] = useState<Usage | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [runs, setRuns] = useState<BackupRun[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)

  useEffect(() => {
    api.loadStorageUsage().then(setUsage, () => undefined) // a line of information: no message if it cannot be read
  }, [api])

  const download = async () => {
    setDownloading(true)
    setMessage(null)
    try {
      const result = await api.downloadFullBackup()
      setMessage({ text: `نُزّلت النسخة الكاملة (${result.recipes} وصفة) إلى جهازك: ${result.name}. صور الوصفات ليست فيها (تُنسخ ليلًا إلى OneDrive).`, error: false })
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true })
    } finally {
      setDownloading(false)
    }
  }

  const load = useCallback(() => loadBackupRuns().then(setRuns, (e: Error) => setMessage({ text: explain(e).message, error: true })), [])
  useEffect(() => {
    void load()
  }, [load])

  const now = async () => {
    setBusy(true)
    setMessage(null)
    try {
      await backUpNow()
      setMessage({ text: 'حُفظت نسخة جديدة وفُحصت.', error: false })
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true })
    } finally {
      await load()
      setBusy(false)
    }
  }

  const state = runs ? backupState(runs) : null

  return (
    <Card title="النسخ الاحتياطي">
      <div className="flex flex-col gap-3">
        <p className="text-sm leading-relaxed text-muted">
          كل ليلة (الخامسة والنصف فجرًا بتوقيت جدة) يُحفظ في OneDrive ملف فيه وصفاتك ووسومك ومفضلتك وسجل التعديلات. يُفحص الملف: كل وصفة فيه سليمة، وحجم الملف المخزَّن في OneDrive (وبصمته إن أعلنها) يطابق ما أُرسل. يُحتفظ بآخر 30 نسخة، وما قبلها يذهب إلى سلة OneDrive. وصور الوصفات تُنسخ إلى مجلد «photos» بجانبها (مرة واحدة لكل صورة، ولا يُحذف منه شيء).
        </p>

        {state?.kind === 'ok' && (
          <div className="flex flex-col gap-1">
            <p>آخر نسخة سليمة: {timeAgo(state.run.started_at)} ✓</p>
            <Summary run={state.run} />
          </div>
        )}
        {state?.kind === 'stale' && (
          <Notice tone="error">آخر نسخة سليمة كانت {timeAgo(state.run.started_at)}، ولم تُحفظ نسخة منذ أكثر من يوم ونصف. اضغطي «انسخي الآن» وإن تكرر الأمر أخبريني.</Notice>
        )}
        {state?.kind === 'failing' && (
          <>
            <Notice tone="error">فشلت آخر محاولة ({timeAgo(state.run.started_at)}): {state.run.error ?? 'لم تنجح النسخة'}</Notice>
            {state.lastGood && <p className="text-sm text-muted">آخر نسخة سليمة قبلها: {timeAgo(state.lastGood.started_at)}.</p>}
          </>
        )}
        {state?.kind === 'none' && <p className="text-sm text-muted">لم تُحفظ نسخة بعد. أول نسخة تلقائية الليلة، أو اضغطي «انسخي الآن».</p>}
        {runs === null && !message && <p className="text-sm text-muted">جارٍ التحميل…</p>}

        {usage && <UsageBars usage={usage} />}

        {message && <Notice tone={message.error ? 'error' : 'plain'}>{message.text}</Notice>}
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={now}>
            {busy ? 'جارٍ النسخ والفحص…' : 'انسخي الآن'}
          </Button>
          {canDownload && (
            <Button kind="plain" disabled={downloading} onClick={() => void download()}>
              {downloading ? 'جارٍ التجهيز…' : 'نزّلي نسخة كاملة الآن'}
            </Button>
          )}
          <LinkButton href={href.restore}>استعادة من نسخة</LinkButton>
        </div>
      </div>
    </Card>
  )
}
