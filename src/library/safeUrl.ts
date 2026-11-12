// A recipe's source link comes from text someone typed or from a OneNote page. Only web addresses
// are made into links: a "javascript:" or "data:" address would run code when tapped, so it is
// shown as text instead.

export function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url.trim())
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  } catch {
    return null
  }
}
