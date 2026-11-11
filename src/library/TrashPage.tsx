// The trash: recipes that were moved out of the library. Nothing is erased; each can be restored.
// The app never empties the trash on its own.

import { useCallback, useEffect, useState } from 'react'
import { explain } from '../offline/readThrough'
import { href } from '../router'
import { Button, Notice } from '../ui'
import { listTrash, restoreRecipe, type TrashedRecipe } from './api'

export default function TrashPage() {
  const [items, setItems] = useState<TrashedRecipe[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => listTrash().then(setItems, (e: Error) => setError(explain(e).message)), [])
  useEffect(() => {
    void load()
  }, [load])

  const restore = async (id: string) => {
    setBusy(id)
    setError(null)
    try {
      await restoreRecipe(id)
      await load()
    } catch (e) {
      setError(explain(e).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <a href={href.library} className="text-sm text-accent">→ كل الوصفات</a>
      <h2 className="text-2xl font-bold">سلة المحذوفات</h2>
      <p className="text-sm leading-relaxed text-muted">
        الوصفات التي نقلتِها من المكتبة. لا يُمحى شيء منها، ولا يفرغ التطبيق السلة وحده. استرجاعها يعيدها كما كانت بوسومها ومفضلتها وربطها بصفحة OneNote.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      {items === null ? (
        !error && <p className="text-muted">جارٍ التحميل…</p>
      ) : items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-6 text-center text-muted">السلة فارغة.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-surface px-4 py-3">
              <a href={href.recipe(item.id)} className="flex min-w-0 flex-col">
                <span dir="auto" className="truncate font-medium">{item.title}</span>
                <span dir="auto" className="text-sm text-muted">{item.section} · حُذفت {new Date(item.deleted_at).toLocaleDateString('ar-SA', { day: 'numeric', month: 'long' })}</span>
              </a>
              <Button kind="plain" disabled={busy === item.id} onClick={() => restore(item.id)}>
                استرجعي
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
