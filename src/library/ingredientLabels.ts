// OneNote pages often write a sub-heading as an ordinary line («الحشوة:», «وصوص التغميس:»), not as a
// heading element, so the page reader keeps it among the ingredient lines. Shown as they are, the
// reading order (starch, protein, spices …) would mix the lines of the different parts together.
// This splits a group at such label lines, only for SHOWING: the stored lines and OneNote stay as they
// are. A label is a short line that ends with a colon and has nothing after it.

import type { IngredientItem } from './types'

const COLON = /[:：]$/
const MAX_LABEL_WORDS = 4

export const isLabelLine = (text: string): boolean => {
  const line = text.trim()
  return COLON.test(line) && line.replace(COLON, '').trim().split(/\s+/).filter(Boolean).length <= MAX_LABEL_WORDS && line.replace(COLON, '').trim() !== ''
}

export interface ShownGroup {
  name: string | null
  items: IngredientItem[]
}

// The group's lines in parts: the lines before the first label under the group's own name, then each
// label (without its colon) with the lines that follow it. A part with no lines is left out.
export function splitByLabels(group: { name: string | null; items: IngredientItem[] }): ShownGroup[] {
  const parts: ShownGroup[] = [{ name: group.name, items: [] }]
  for (const item of group.items) {
    if (isLabelLine(item.text)) parts.push({ name: item.text.trim().replace(COLON, '').trim(), items: [] })
    else parts[parts.length - 1].items.push(item)
  }
  return parts.filter((part) => part.items.length > 0)
}
