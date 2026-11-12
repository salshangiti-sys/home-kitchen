// Restoring from a backup file in three steps, nothing saved until the last one:
// 1. choose a backup file (hk-backup-….json, from OneDrive › Apps › home-kitchen) and see what it holds,
// 2. a trial run on the server: what would be added (everything is then rolled back),
// 3. the real restore.
// It only ADDS what is missing. Nothing already in the app is changed or deleted, and doing it twice
// adds nothing the second time.

import { useState } from 'react'
import { href } from '../router'
import { Button, Card, LinkButton, Notice } from '../ui'
import { MAX_FILE_BYTES, addsAnything, parseBackup, reportLines, restoreFromBackup, restoreMessage, type Bundle, type FileSummary, type RestoreResult } from './restoreBackup'

interface Api {
  restoreFromBackup: typeof restoreFromBackup
}

export default function RestorePage({ api = { restoreFromBackup } }: { api?: Api }) {
  const [fileName, setFileName] = useState<string | null>(null)
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [summary, setSummary] = useState<FileSummary | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [trial, setTrial] = useState<RestoreResult | null>(null)
  const [done, setDone] = useState<RestoreResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  const readFile = async (file: File) => {
    setFileName(file.name)
    setBundle(null)
    setSummary(null)
    setTrial(null)
    setDone(null)
    setRunError(null)
    setFileError(null)
    if (file.size > MAX_FILE_BYTES) {
      setFileError('الملف كبير جدًا (أكثر من 40 ميغابايت). هل هو ملف نسخة احتياطية فعلًا؟')
      return
    }
    try {
      const parsed = parseBackup(await file.text())
      setBundle(parsed.bundle)
      setSummary(parsed.summary)
    } catch (e) {
      setFileError((e as Error).message)
    }
  }

  const run = async (dryRun: boolean) => {
    if (!bundle) return
    setBusy(true)
    setRunError(null)
    try {
      const result = await api.restoreFromBackup(bundle, dryRun)
      if (dryRun) setTrial(result)
      else setDone(result)
    } catch (e) {
      setRunError(restoreMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <a href={href.library} className="text-sm text-accent">→ كل الوصفات</a>
      <h2 className="text-2xl font-bold">استعادة من نسخة احتياطية</h2>
      <Notice>
        تُضيف الاستعادة ما هو ناقص فقط: لا تغيّر ولا تحذف شيئًا موجودًا في التطبيق، وإن كررتِها لا تُضيف شيئًا ثانية. للمالكة فقط. ملفات الصور لا تُستعاد من هنا (تبقى في OneDrive › photos).
      </Notice>

      <Card title="1. اختيار الملف">
        <p className="mb-3 text-sm text-muted">ملف hk-backup-….json من OneDrive › Apps › home-kitchen. يُقرأ هنا في المتصفح أولًا.</p>
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-line px-4 text-sm font-medium">
          اختاري ملف النسخة
          <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => e.target.files?.[0] && void readFile(e.target.files[0])} />
        </label>
        {fileName && <span dir="ltr" className="ms-3 text-sm text-muted">{fileName}</span>}
        {fileError && <div className="mt-3"><Notice tone="error">{fileError}</Notice></div>}
        {summary && (
          <ul className="mt-3 flex flex-col gap-1 text-sm">
            {summary.createdAt && <li>كُتبت: <span dir="ltr">{summary.createdAt.slice(0, 16).replace('T', ' ')} UTC</span></li>}
            <li>{summary.recipes} وصفة، و{summary.deleted} في سلة المحذوفات</li>
            <li>{summary.favorites} من المفضلة، و{summary.cookEntries} من سجل التجارب، و{summary.versions} من الإصدارات السابقة</li>
            {summary.meals > 0 && <li>{summary.meals} من وجبات الخطة الأسبوعية</li>}
            {summary.photos > 0 && <li>{summary.photos} صورة (بياناتها فقط في الملف)</li>}
          </ul>
        )}
      </Card>

      {bundle && (
        <Card title="2. تشغيل تجريبي">
          <p className="mb-3 text-sm text-muted">يجرّب الاستعادة على الخادم ثم يتراجع عنها كاملًا، ليعرض بالضبط ما سيُضاف.</p>
          <Button onClick={() => run(true)} disabled={busy}>شغّلي تجربة</Button>
          {trial && <Report result={trial} />}
        </Card>
      )}

      {trial && (
        <Card title="3. الاستعادة">
          {addsAnything(trial) ? (
            <>
              <p className="mb-3 text-sm text-muted">سيُضاف ما ذُكر أعلاه، ولن يُمسّ ما هو موجود.</p>
              <Button onClick={() => run(false)} disabled={busy || !!done}>استعيدي الآن</Button>
            </>
          ) : (
            <p className="text-muted">لا شيء ناقص: كل ما في الملف موجود في التطبيق أصلًا.</p>
          )}
          {done && (
            <div className="mt-4 flex flex-col gap-3">
              <Notice>تمت الاستعادة.</Notice>
              <Report result={done} />
              <div><LinkButton href={href.library} kind="primary">افتحي المكتبة</LinkButton></div>
            </div>
          )}
        </Card>
      )}

      {busy && <Notice>جارٍ العمل… قد يستغرق ذلك دقيقة لملف كبير.</Notice>}
      {runError && <Notice tone="error">{runError}</Notice>}
    </div>
  )
}

function Report({ result }: { result: RestoreResult }) {
  const lines = reportLines(result)
  return (
    <div className="mt-4 flex flex-col gap-2 text-sm">
      <p className="font-medium">{result.dry_run ? 'سيُضاف:' : 'أُضيف:'}</p>
      {lines.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1 ps-5">{lines.map((line) => <li key={line}>{line}</li>)}</ul>
      ) : (
        <p className="text-muted">لا شيء.</p>
      )}
      {result.recipes_existing > 0 && <p className="text-muted">{result.recipes_existing} وصفة موجودة أصلًا، لم تُمسّ.</p>}
      {result.entries_skipped_unknown_person > 0 && (
        <p className="text-muted">{result.entries_skipped_unknown_person} من المفضلة أو سجل التجارب تخص أشخاصًا ليسوا في هذا البيت الآن، فتُخطّيت.</p>
      )}
      {result.errors.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="font-medium text-red-700 dark:text-red-400">تعذّر استعادة {result.errors.length} وصفة:</p>
          <ul className="flex flex-col gap-1">
            {result.errors.map((e, i) => <li key={i} dir="ltr" className="text-start text-red-700 dark:text-red-400">{e.id}: {e.error}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}
