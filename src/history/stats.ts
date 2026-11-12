// Using the cooking history to browse the library: most cooked, and what has not been cooked for a
// while (or ever).

import { daysAgo, timesLabel, type CookStat } from './api'

export type SortMode = 'name' | 'most' | 'longest'

export const SORT_LABELS: Record<SortMode, string> = {
  name: 'الاسم',
  most: 'الأكثر طبخًا',
  longest: 'لم تُجرَّب منذ مدة',
}

const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title, 'ar')

// 'name' keeps the order given (the library already comes sorted by title). 'most': by number of times,
// then by name. 'longest': never cooked first (by name), then the one cooked longest ago.
export function sortRecipes<T extends { id: string; title: string }>(recipes: T[], stats: Map<string, CookStat>, mode: SortMode): T[] {
  if (mode === 'name') return recipes
  const copy = [...recipes]
  if (mode === 'most') {
    return copy.sort((a, b) => (stats.get(b.id)?.count ?? 0) - (stats.get(a.id)?.count ?? 0) || byTitle(a, b))
  }
  return copy.sort((a, b) => {
    const x = stats.get(a.id)?.lastOn
    const y = stats.get(b.id)?.lastOn
    if (!x && !y) return byTitle(a, b)
    if (!x) return -1
    if (!y) return 1
    return x.localeCompare(y) || byTitle(a, b)
  })
}

// "cooked 3 times · last time 5 days ago", or null for a recipe never cooked.
export function cookLine(stat: CookStat | undefined, today: string): string | null {
  return stat ? `${timesLabel(stat.count)} · آخر مرة ${daysAgo(stat.lastOn, today)}` : null
}
