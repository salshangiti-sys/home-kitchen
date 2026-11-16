// Playful colours for section and tag chips. A name always gets the same tint, so a tag keeps its colour
// everywhere. Full class names are written out so the stylesheet generator can see them.
export const TINTS = [
  'bg-t1 text-t1-fg',
  'bg-t2 text-t2-fg',
  'bg-t3 text-t3-fg',
  'bg-t4 text-t4-fg',
  'bg-t5 text-t5-fg',
  'bg-t6 text-t6-fg',
] as const

export function tintFor(name: string): (typeof TINTS)[number] {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0
  return TINTS[hash % TINTS.length]
}
