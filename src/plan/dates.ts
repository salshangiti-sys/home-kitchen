// Plain dates (YYYY-MM-DD) for the plan, worked out on the calendar with no time zones: a day is
// the same day wherever the phone is. Weeks start on a chosen day of the week (0 = Sunday ...
// 6 = Saturday, Saturday by default).

const pad = (n: number) => String(n).padStart(2, '0')

export const isIsoDate = (value: string | undefined): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))

const parse = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

const format = (date: Date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`

export const addDays = (iso: string, days: number) => format(new Date(parse(iso).getTime() + days * 86_400_000))

// The date on this device today.
export const todayIso = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

export const dayOfWeek = (iso: string) => parse(iso).getUTCDay()

// The first day of the plan week that holds `iso`.
export const weekStartOf = (iso: string, startDow: number) => addDays(iso, -((dayOfWeek(iso) - startDow + 7) % 7))

export const weekDays = (start: string) => Array.from({ length: 7 }, (_, i) => addDays(start, i))

const weekdayFormat = new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', { weekday: 'long', timeZone: 'UTC' })
const dayFormat = new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', timeZone: 'UTC' })
const rangeFormat = new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

export const weekdayName = (iso: string) => weekdayFormat.format(parse(iso))
export const dayLabel = (iso: string) => dayFormat.format(parse(iso))

// "14 نوفمبر – 20 نوفمبر 2026"
export function weekRange(start: string): string {
  const end = addDays(start, 6)
  return `${dayLabel(start)} – ${rangeFormat.format(parse(end))}`
}
