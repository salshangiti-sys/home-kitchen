// The food groups of a recipe on its page: chips to read, and for owners and editors to tap.
// Every tap is saved at once. The note says plainly that this is the person's own estimate.

import { useCallback, useEffect, useState } from 'react'
import { Badge, Notice } from '../ui'
import { FOOD_GROUPS, FOOD_GROUP_LABELS, foodGroupMessage, listFoodGroups, setFoodGroups, toggleGroup, type FoodGroup } from './api'

interface Api {
  listFoodGroups: typeof listFoodGroups
  setFoodGroups: typeof setFoodGroups
}

const real: Api = { listFoodGroups, setFoodGroups }

export default function FoodGroups({ recipeId, canEdit, api = real }: { recipeId: string; canEdit: boolean; api?: Api }) {
  const [groups, setGroups] = useState<FoodGroup[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setGroups(await api.listFoodGroups(recipeId))
    } catch (e) {
      setGroups((current) => current ?? [])
      setError(foodGroupMessage(e))
    }
  }, [api, recipeId])

  useEffect(() => {
    void load()
  }, [load])

  if (groups === null) return null
  // Nothing to show to someone who cannot edit, when nothing was chosen.
  if (!canEdit && groups.length === 0 && !error) return null

  const tap = async (group: FoodGroup) => {
    const next = toggleGroup(groups, group)
    setBusy(true)
    setError(null)
    try {
      await api.setFoodGroups(recipeId, next)
      setGroups(next)
    } catch (e) {
      setError(foodGroupMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="العناصر الغذائية" className="rounded-2xl border border-line bg-surface p-5">
      <h3 className="mb-1 text-lg font-semibold">العناصر الغذائية</h3>
      {canEdit ? (
        <>
          <p className="mb-3 text-sm text-muted">اختاري ما يحتويه الطبق. تقديرك أنتِ، وليس تقييمًا غذائيًا أو طبيًا، ولا يُحسب من المقادير.</p>
          <div role="group" aria-label="العناصر الغذائية" className="flex flex-wrap gap-2">
            {FOOD_GROUPS.map((group) => {
              const on = groups.includes(group)
              return (
                <button
                  key={group}
                  type="button"
                  aria-pressed={on}
                  disabled={busy}
                  onClick={() => void tap(group)}
                  className={`min-h-11 rounded-full border px-4 text-sm font-medium disabled:opacity-60 ${on ? 'border-accent bg-accent text-on-accent' : 'border-line'}`}
                >
                  {FOOD_GROUP_LABELS[group]}
                </button>
              )
            })}
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          {groups.map((group) => <Badge key={group} tone="accent">{FOOD_GROUP_LABELS[group]}</Badge>)}
        </div>
      )}
      {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
    </section>
  )
}
