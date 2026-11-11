// The nightly backup to OneDrive: when the last one ran, whether it was read back and checked, and
// a button to back up now.

import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Notice } from '../ui'
import { explain } from '../offline/readThrough'
import { backUpNow, backupState, formatBytes, loadBackupRuns, type BackupRun } from './backupStatus'
import { timeAgo } from './onenote'

function Summary({ run }: { run: BackupRun }) {
  const recipes = `${run.recipes ?? 0} وصفة${run.deleted_recipes ? ` (و${run.deleted_recipes} محذوفة)` : ''}`
  const where = run.folder_name ? `OneDrive › Apps › ${run.folder_name}` : 'OneDrive'
  return (
    <p className="text-sm text-muted">
      {recipes} · {formatBytes(run.bytes)} · <span dir="ltr">{where}</span>
    </p>
  )
}

export default function BackupCard() {
  const [runs, setRuns] = useState<BackupRun[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)

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
          كل ليلة (الخامسة والنصف فجرًا بتوقيت جدة) يُحفظ في OneDrive ملف فيه وصفاتك ووسومك ومفضلتك وسجل التعديلات. يُقرأ الملف بعدها من OneDrive ويُفحص: مطابق تمامًا لما كُتب، وكل وصفة فيه سليمة. يُحتفظ بآخر 30 نسخة، وما قبلها يذهب إلى سلة OneDrive.
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

        {message && <Notice tone={message.error ? 'error' : 'plain'}>{message.text}</Notice>}
        <div>
          <Button disabled={busy} onClick={now}>
            {busy ? 'جارٍ النسخ والفحص…' : 'انسخي الآن'}
          </Button>
        </div>
      </div>
    </Card>
  )
}
