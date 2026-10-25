// Three-way merge of a recipe page, one section at a time.
// base   = the page as both sides last agreed on it (stored after every successful sync)
// local  = the recipe in the app now
// remote = the page in OneNote now
// A section changed on one side only is taken from that side. A section changed on both sides
// to different values is a conflict: neither side is overwritten and the owner chooses.

import { MERGE_KEYS, sameValue, valueOf, withValue, type MergeKey, type PageState, type SectionKey } from './sections.ts'
import type { FoundBy } from './parse.ts'

export type Decision =
  | 'unchanged' // no side changed
  | 'push' // app changed: write it to OneNote
  | 'pull' // OneNote changed: take it into the app
  | 'same' // both changed to the same value
  | 'conflict' // both changed differently
  | 'restore' // section missing from the OneNote page: write the app's version back

export interface MergePlan {
  decisions: Record<MergeKey, Decision>
  // What the app should hold after the merge (conflicted sections keep the app's value).
  merged: PageState
  // What the next base should be (conflicted sections keep the old base so they stay open).
  nextBase: PageState
  toPush: MergeKey[]
  toPull: MergeKey[]
  conflicts: MergeKey[]
}

export function planMerge(
  base: PageState | null,
  local: PageState,
  remote: PageState,
  foundBy: Partial<Record<SectionKey, FoundBy>> = {},
): MergePlan {
  const decisions = {} as Record<MergeKey, Decision>
  let merged = local
  // Without a base (first sync of an existing page), treat OneNote as the base so that only
  // the app's differences are pushed and nothing in OneNote is assumed to be a fresh edit.
  const effectiveBase = base ?? remote
  let nextBase = effectiveBase

  for (const key of MERGE_KEYS) {
    if (key !== 'title' && foundBy[key] === 'missing') {
      // A deleted section is never treated as "the author emptied it": restoring is reversible,
      // pulling an empty section into the app would not be.
      decisions[key] = 'restore'
      nextBase = withValue(nextBase, key, valueOf(key, local))
      continue
    }

    const localChanged = !sameValue(key, effectiveBase, local)
    const remoteChanged = !sameValue(key, effectiveBase, remote)

    let decision: Decision
    if (!localChanged && !remoteChanged) decision = 'unchanged'
    else if (localChanged && !remoteChanged) decision = 'push'
    else if (!localChanged && remoteChanged) decision = 'pull'
    else decision = sameValue(key, local, remote) ? 'same' : 'conflict'
    decisions[key] = decision

    if (decision === 'pull') {
      merged = withValue(merged, key, valueOf(key, remote))
      nextBase = withValue(nextBase, key, valueOf(key, remote))
    } else if (decision === 'push' || decision === 'same') {
      nextBase = withValue(nextBase, key, valueOf(key, local))
    }
    // unchanged: base already equals both sides. conflict: keep the old base.
  }

  const pick = (...wanted: Decision[]) => MERGE_KEYS.filter((key) => wanted.includes(decisions[key]))
  return {
    decisions,
    merged,
    nextBase,
    toPush: pick('push', 'restore'),
    toPull: pick('pull'),
    conflicts: pick('conflict'),
  }
}
