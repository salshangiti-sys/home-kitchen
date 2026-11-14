// "Link the recipes to their pages by title": shows what would be linked, then links on a yes.
// Used after the recipes are imported and the notebook has been checked. Nothing is guessed: only a
// title that exactly one recipe and one page share is linked, the rest is listed to link by hand.
// The recipe text is not touched (it is read from the page when the recipe is opened).

import { useState } from 'react'
import { Button, Notice } from '../ui'
import { linkPagesByTitle, type TitleLinkResult } from './onenote'

export default function TitleLinker({ onLinked, link = linkPagesByTitle }: { onLinked: (message: string) => void; link?: typeof linkPagesByTitle }) {
  const [preview, setPreview] = useState<TitleLinkResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!preview) {
    return (
      <div className="flex flex-col gap-2">
        <div>
          <Button kind="plain" disabled={busy} onClick={() => void run(async () => setPreview(await link(true)))}>
            {busy ? 'جارٍ المطابقة…' : 'اربطي الوصفات بصفحاتها (بالعنوان)'}
          </Button>
        </div>
        <p className="text-xs text-muted">يطابق عناوين الوصفات بعناوين الصفحات التي وجدها الفحص، ويعرض لكِ ما سيُربط قبل أن يغيّر شيئًا. لا يمسّ نص الوصفة.</p>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line p-4" role="group" aria-label="معاينة الربط بالعنوان">
      <p className="font-medium">سيُربط {preview.linked} {preview.linked === 1 ? 'وصفة' : 'وصفة'} بصفحة لها العنوان نفسه.</p>
      <ul className="flex flex-col gap-1 text-sm text-muted">
        <li>{preview.pages_without_recipe} صفحة في الدفتر ليست لها وصفة في التطبيق.</li>
        <li>{preview.recipes_without_page} وصفة في التطبيق ليست لها صفحة بالعنوان نفسه.</li>
        {preview.ambiguous_titles.length > 0 && <li>{preview.ambiguous_titles.length} عنوان مكرر لا يُربط تلقائيًا (تربطينه واحدًا واحدًا).</li>}
      </ul>
      {preview.ambiguous_titles.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer">العناوين المكررة</summary>
          <ul className="mt-1 list-disc ps-5">
            {preview.ambiguous_titles.map((t) => <li key={t} dir="auto">{t}</li>)}
          </ul>
        </details>
      )}
      {preview.linked > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer">ما سيُربط ({preview.linked})</summary>
          <ul className="mt-1 flex max-h-72 flex-col gap-1 overflow-y-auto">
            {preview.pairs.map((p) => (
              <li key={p.recipe_id} dir="auto">
                {p.recipe_title}{p.section_name ? <span className="text-muted"> · {p.section_name}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || preview.linked === 0}
          onClick={() =>
            void run(async () => {
              const done = await link(false)
              setPreview(null)
              onLinked(`رُبطت ${done.linked} وصفة بصفحاتها. تُقرأ الصفحة كلما فتحتِ الوصفة.`)
            })
          }
        >
          {busy ? 'جارٍ الربط…' : `نعم، اربطي ${preview.linked}`}
        </Button>
        <Button kind="plain" disabled={busy} onClick={() => setPreview(null)}>إلغاء</Button>
      </div>
    </div>
  )
}
