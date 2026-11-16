// Pure helpers for the freezer (tested).

import { normalizeAr } from '../library/normalize'
import type { FreezerItem } from './api'

// «٣ كرة»: the quantity without a useless «.0», and its unit.
export function quantityText(quantity: number, unit: string): string {
  const shown = Number.isInteger(quantity) ? String(quantity) : String(Math.round(quantity * 100) / 100)
  return `${shown} ${unit}`
}

const DAY = 24 * 60 * 60 * 1000

// How long ago it was frozen, in words («اليوم»، «قبل 3 أسابيع»).
export function frozenAgo(frozenOn: string, today: string): string {
  const days = Math.round((Date.parse(today) - Date.parse(frozenOn)) / DAY)
  if (!Number.isFinite(days) || days <= 0) return 'اليوم'
  if (days === 1) return 'أمس'
  if (days < 7) return `قبل ${days} أيام`
  if (days < 30) {
    const weeks = Math.floor(days / 7)
    return weeks === 1 ? 'قبل أسبوع' : weeks === 2 ? 'قبل أسبوعين' : `قبل ${weeks} أسابيع`
  }
  const months = Math.floor(days / 30)
  return months === 1 ? 'قبل شهر' : months === 2 ? 'قبل شهرين' : `قبل ${months} أشهر`
}

// More than this many days in the freezer is shown as old.
export const OLD_AFTER_DAYS = 90
export const isOld = (frozenOn: string, today: string): boolean => (Date.parse(today) - Date.parse(frozenOn)) / DAY > OLD_AFTER_DAYS

const words = (text: string) => normalizeAr(text).split(/\s+/).filter((w) => w.length > 1)

// The freezer items that match a name (e.g. a shopping item «لحم مفروم» matches «لحم مفروم مطبوخ»):
// every word of the shorter name is among the words of the other one.
export function inFreezer(items: FreezerItem[], name: string): FreezerItem[] {
  const wanted = words(name)
  if (wanted.length === 0) return []
  return items.filter((item) => {
    const have = words(item.name)
    if (have.length === 0) return false
    const [short, long] = wanted.length <= have.length ? [wanted, have] : [have, wanted]
    return short.every((w) => long.includes(w))
  })
}

// «كرات لحم ×12 كرة، صوص طماطم ×3 علبة»
export const summary = (items: FreezerItem[]): string => items.map((i) => `${i.name} ×${quantityText(i.quantity, i.unit)}`).join('، ')
