// Arabic search normalization, the same as public.normalize_ar in the database (migration
// fix_normalize_ar). For matching only: the text people see is never changed.
// - removes diacritics, tatweel and bidi marks
// - أ إ آ ٱ → ا, ة → ه, ى → ي
// - Arabic-Indic digits → 0-9
// - lowercases Latin letters and collapses spaces

const MARKS = /[ً-ٰٟـ‌-‏‪-‮⁦-⁩]/g
const FROM = 'أإآٱةى٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹'
const TO = 'ااااهي01234567890123456789'
const MAP = new Map([...FROM].map((char, i) => [char, TO[i]]))
const MAPPED = new RegExp(`[${FROM}]`, 'g')

export function normalizeAr(input: string): string {
  return input
    .replace(MARKS, '')
    .replace(MAPPED, (char) => MAP.get(char) ?? char)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// True when every word of the query appears in the text (both normalized).
export function matchesQuery(normalizedText: string, query: string): boolean {
  const words = normalizeAr(query).split(' ').filter(Boolean)
  return words.every((word) => normalizedText.includes(word))
}
