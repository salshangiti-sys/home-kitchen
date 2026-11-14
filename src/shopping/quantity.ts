// Adding quantities together, by the rule agreed for the shopping list (docs/01): only quantities the
// person CONFIRMED are added, and only when their units are compatible. 500 g + 1 kg = 1.5 kg. Units that
// cannot be turned into each other without guessing (a cup of flour and grams of flour, a spoon and a
// cup) stay separate, each added only to its own kind. Nothing here reads a line: it works on numbers
// and units the person already confirmed.

import type { UnitKind } from './ingredient'

export type Unit = UnitKind | null // null: a plain count («٣ بصلات»)

export interface Quantity {
  quantity: number
  unit: Unit
}

// Only exact conversions: kilos and grams, litres and millilitres. Everything else is its own kind.
const BASE: Partial<Record<UnitKind, { kind: string; factor: number }>> = {
  g: { kind: 'g', factor: 1 },
  kg: { kind: 'g', factor: 1000 },
  ml: { kind: 'ml', factor: 1 },
  l: { kind: 'ml', factor: 1000 },
}

const kindOf = (unit: Unit): string => (unit === null ? 'count' : (BASE[unit]?.kind ?? unit))
const toBase = (q: Quantity): number => q.quantity * (q.unit ? (BASE[q.unit]?.factor ?? 1) : 1)

// The units a quantity can be in (the confirm form offers exactly these).
export const UNITS: Array<{ unit: Unit; name: string }> = [
  { unit: null, name: 'عدد (بلا وحدة)' },
  { unit: 'g', name: 'جرام' },
  { unit: 'kg', name: 'كيلو' },
  { unit: 'ml', name: 'مل' },
  { unit: 'l', name: 'لتر' },
  { unit: 'cup', name: 'كوب' },
  { unit: 'tbsp', name: 'ملعقة كبيرة' },
  { unit: 'tsp', name: 'ملعقة صغيرة' },
  { unit: 'spoon', name: 'ملعقة' },
  { unit: 'pinch', name: 'رشة' },
  { unit: 'piece', name: 'حبة' },
  { unit: 'clove', name: 'فص' },
  { unit: 'can', name: 'علبة' },
  { unit: 'pack', name: 'عبوة' },
  { unit: 'bunch', name: 'حزمة' },
]

// singular, dual, plural (3-10); 11 and above take the singular again.
const FORMS: Partial<Record<UnitKind, [string, string, string]>> = {
  cup: ['كوب', 'كوبان', 'أكواب'],
  tbsp: ['ملعقة كبيرة', 'ملعقتان كبيرتان', 'ملاعق كبيرة'],
  tsp: ['ملعقة صغيرة', 'ملعقتان صغيرتان', 'ملاعق صغيرة'],
  spoon: ['ملعقة', 'ملعقتان', 'ملاعق'],
  pinch: ['رشة', 'رشتان', 'رشات'],
  piece: ['حبة', 'حبتان', 'حبات'],
  clove: ['فص', 'فصان', 'فصوص'],
  can: ['علبة', 'علبتان', 'علب'],
  pack: ['عبوة', 'عبوتان', 'عبوات'],
  bunch: ['حزمة', 'حزمتان', 'حزم'],
}
const FIXED: Partial<Record<UnitKind, string>> = { g: 'جرام', kg: 'كيلو', ml: 'مل', l: 'لتر' }

const round = (n: number) => Math.round(n * 100) / 100
const digits = (n: number) => String(round(n))

// «٣ فصوص», «1.5 كيلو», «2 كوب» as the list shows them.
export function formatQuantity(q: Quantity): string {
  const n = round(q.quantity)
  if (q.unit === null) return digits(n)
  const fixed = FIXED[q.unit]
  if (fixed) return `${digits(n)} ${fixed}`
  const forms = FORMS[q.unit]
  if (!forms) return digits(n)
  if (n === 2) return forms[1]
  if (Number.isInteger(n) && n >= 3 && n <= 10) return `${n} ${forms[2]}`
  return `${digits(n)} ${forms[0]}`
}

export const unitName = (unit: Unit): string => (unit === null ? 'عدد' : (FIXED[unit] ?? FORMS[unit]?.[0] ?? unit))

// Adds quantities of the same kind (grams with kilos, ml with litres, the same unit with itself) and
// keeps the other kinds as their own totals. Big amounts are shown in kilos and litres.
export function sumQuantities(items: Quantity[]): Quantity[] {
  const totals = new Map<string, number>()
  const order: string[] = []
  for (const item of items) {
    if (!(item.quantity > 0) || !Number.isFinite(item.quantity)) continue
    const kind = kindOf(item.unit)
    if (!totals.has(kind)) order.push(kind)
    totals.set(kind, (totals.get(kind) ?? 0) + toBase(item))
  }
  return order.map((kind): Quantity => {
    const total = totals.get(kind) ?? 0
    if (kind === 'g') return total >= 1000 ? { quantity: total / 1000, unit: 'kg' } : { quantity: total, unit: 'g' }
    if (kind === 'ml') return total >= 1000 ? { quantity: total / 1000, unit: 'l' } : { quantity: total, unit: 'ml' }
    return { quantity: total, unit: kind === 'count' ? null : (kind as UnitKind) }
  })
}

// «1.5 كيلو + 3 حبات»
export const formatTotals = (totals: Quantity[]): string => totals.map(formatQuantity).join(' + ')

// A quantity as typed in the confirm form: Western or Arabic-Indic digits, «.» or «,» or «٫» as the
// decimal mark, or a simple fraction («1/2»). Null when it is not a positive number.
export function parseAmount(text: string): number | null {
  const western = text
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/g, '.')
  const frac = western.match(/^(\d+)\s*\/\s*(\d+)$/)
  const value = frac ? (Number(frac[2]) > 0 ? Number(frac[1]) / Number(frac[2]) : NaN) : /^\d+(\.\d+)?$/.test(western) ? Number(western) : NaN
  return Number.isFinite(value) && value > 0 && value <= 100000 ? value : null
}
