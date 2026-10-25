// Importing recipes.json in three steps, nothing saved until the last one:
// 1. read the file and check every record against recipe.schema.json (in the browser),
// 2. dry run on the server: what would be created, updated, left alone, or skipped because it was
//    changed in the app since it was imported (then everything is rolled back),
// 3. the real import, same batches.
// Re-importing the same file creates no duplicates and never deletes anything.

import { useState } from 'react'
import { href } from '../router'
import { Button, Card, LinkButton, Notice } from '../ui'
import { importBatch } from './api'
import { buildFileReport, chunk, parseRecipeFile, summarizeRun, type FileReport, type ImportOutcome, type RunSummary } from './importReport'
import { STATUS_LABELS, type RecipeStatus } from './types'

// Small batches keep each server call well inside its time limit.
const BATCH_SIZE = 20

const RESULT_LABELS: Record<keyof RunSummary['counts'], string> = {
  created: 'جديدة',
  updated: 'تحديث من الملف',
  unchanged: 'لم تتغير',
  skipped_edited: 'لم تُلمس: عُدّلت في التطبيق',
  error: 'أخطاء',
}

export default function ImportPage() {
  const [fileName, setFileName] = useState<string | null>(null)
  const [report, setReport] = useState<FileReport | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [dryRun, setDryRun] = useState<RunSummary | null>(null)
  const [done, setDone] = useState<RunSummary | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)

  const readFile = async (file: File) => {
    setFileName(file.name)
    setReport(null)
    setFileError(null)
    setDryRun(null)
    setDone(null)
    setRunError(null)
    try {
      setReport(buildFileReport(parseRecipeFile(await file.text())))
    } catch (e) {
      setFileError((e as Error).message)
    }
  }

  const run = async (dry: boolean) => {
    if (!report) return
    setRunError(null)
    const outcomes: ImportOutcome[] = []
    const batches = chunk(report.valid, BATCH_SIZE)
    try {
      for (const [i, batch] of batches.entries()) {
        setProgress(`${dry ? 'تشغيل تجريبي' : 'استيراد'}: الدفعة ${i + 1} من ${batches.length}`)
        outcomes.push(...(await importBatch(batch, dry)))
      }
      const summary = summarizeRun(outcomes)
      if (dry) setDryRun(summary)
      else setDone(summary)
    } catch (e) {
      setRunError(`${(e as Error).message}${dry ? '' : `\nتوقف بعد ${outcomes.length} وصفة. ما حُفظ يبقى، وإعادة الاستيراد آمنة: لا تكرر شيئًا.`}`)
    } finally {
      setProgress(null)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <a href={href.library} className="text-sm text-accent">→ كل الوصفات</a>
      <h2 className="text-2xl font-bold">استيراد الوصفات</h2>

      <Card title="1. اختيار الملف">
        <p className="mb-3 text-sm text-muted">ملف recipes.json المصدَّر من OneNote. يُفحص هنا في المتصفح أولًا، ولا يُحفظ شيء حتى الخطوة الثالثة.</p>
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-line px-4 text-sm font-medium">
          اختاري ملف الوصفات
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])}
          />
        </label>
        {fileName && <span dir="ltr" className="ms-3 text-sm text-muted">{fileName}</span>}
        {fileError && <div className="mt-3"><Notice tone="error">{fileError}</Notice></div>}
      </Card>

      {report && <FileReportCard fileName={fileName} report={report} />}

      {report && report.valid.length > 0 && (
        <Card title="2. تشغيل تجريبي">
          <p className="mb-3 text-sm text-muted">يجرّب الحفظ على الخادم ثم يتراجع عنه كاملًا، ليعرض بالضبط ما سيحدث.</p>
          <Button onClick={() => run(true)} disabled={!!progress}>شغّل تجربة على {report.valid.length} وصفة</Button>
          {dryRun && <div className="mt-4"><RunSummaryView summary={dryRun} /></div>}
        </Card>
      )}

      {dryRun && (
        <Card title="3. الاستيراد">
          {dryRun.counts.created + dryRun.counts.updated === 0 ? (
            <p className="text-muted">لا جديد في الملف: كل وصفاته موجودة كما هي.</p>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted">
                سيُضاف {dryRun.counts.created} ويُحدَّث {dryRun.counts.updated}. لن يُحذف شيء، والوصفات المعدّلة في التطبيق لن تُلمس.
              </p>
              <Button onClick={() => run(false)} disabled={!!progress || !!done}>استورد الآن</Button>
            </>
          )}
          {done && (
            <div className="mt-4 flex flex-col gap-3">
              <RunSummaryView summary={done} />
              <div><LinkButton href={href.library} kind="primary">افتح المكتبة</LinkButton></div>
            </div>
          )}
        </Card>
      )}

      {progress && <Notice>{progress}…</Notice>}
      {runError && <Notice tone="error">{runError}</Notice>}
    </div>
  )
}

function FileReportCard({ fileName, report }: { fileName: string | null; report: FileReport }) {
  return (
    <Card title={`فحص الملف${fileName ? `: ${fileName}` : ''}`}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <Stat label="سجلات في الملف" value={report.total} />
        <Stat label="صالحة للاستيراد" value={report.valid.length} />
        <Stat label="لا تطابق المخطط" value={report.invalid.length} warn={report.invalid.length > 0} />
        {(Object.keys(report.byStatus) as RecipeStatus[]).map((s) => (
          <Stat key={s} label={STATUS_LABELS[s]} value={report.byStatus[s]} />
        ))}
        <Stat label="لها معرّف صفحة OneNote" value={`${report.withPageId} من ${report.valid.length}`} />
        <Stat label="عليها علامات مراجعة" value={report.flaggedRecords} />
      </dl>

      {report.duplicateIds.length > 0 && (
        <p className="mt-3 text-sm">معرّفات مكررة داخل الملف (يُستورد أول ظهور فقط): <span dir="ltr">{report.duplicateIds.join(', ')}</span></p>
      )}

      {report.flagCounts.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-medium">أنواع علامات المراجعة</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {report.flagCounts.map(([flag, count]) => <li key={flag} dir="ltr" className="text-start">{flag}: {count}</li>)}
          </ul>
        </details>
      )}

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium">الأقسام ({report.bySection.length})</summary>
        <ul className="mt-2 flex flex-col gap-1">
          {report.bySection.map(([section, count]) => <li key={section} dir="auto">{section}: {count}</li>)}
        </ul>
      </details>

      {report.invalid.length > 0 && (
        <details className="mt-3 text-sm" open>
          <summary className="cursor-pointer font-medium">سجلات لا تطابق المخطط (لن تُستورد)</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {report.invalid.slice(0, 50).map((record) => (
              <li key={record.index} className="rounded-lg border border-line p-2">
                <div dir="auto">#{record.index + 1} {record.id ?? '—'} {record.title ? `· ${record.title}` : ''}</div>
                <ul dir="ltr" className="mt-1 text-start text-xs text-muted">
                  {record.errors.slice(0, 5).map((error) => <li key={error}>{error}</li>)}
                </ul>
              </li>
            ))}
          </ul>
          {report.invalid.length > 50 && <p className="mt-2 text-muted">و{report.invalid.length - 50} غيرها.</p>}
        </details>
      )}
    </Card>
  )
}

function RunSummaryView({ summary }: { summary: RunSummary }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {(Object.keys(summary.counts) as Array<keyof RunSummary['counts']>).map((key) => (
          <Stat key={key} label={RESULT_LABELS[key]} value={summary.counts[key]} warn={key === 'error' && summary.counts.error > 0} />
        ))}
      </dl>
      {summary.skippedEdited.length > 0 && (
        <p>لم تُلمس لأنها عُدّلت في التطبيق: <span dir="ltr">{summary.skippedEdited.join(', ')}</span></p>
      )}
      {summary.errors.length > 0 && (
        <ul className="flex flex-col gap-1">
          {summary.errors.map((e, i) => <li key={i} dir="ltr" className="text-start text-red-700 dark:text-red-400">{e.id}: {e.error}</li>)}
        </ul>
      )}
    </div>
  )
}

function Stat({ label, value, warn }: { label: string; value: number | string; warn?: boolean }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted">{label}</dt>
      <dd className={`text-lg font-semibold ${warn ? 'text-red-700 dark:text-red-400' : ''}`}>{value}</dd>
    </div>
  )
}
