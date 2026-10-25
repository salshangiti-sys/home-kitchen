import { describe, expect, it } from 'vitest'
import { parseHTML } from 'linkedom'
import { FakeOneNote } from './fakeOneNote.ts'
import { PATCH_TRIALS, buildPatchProbePage, runPatchProbe } from './patchProbe.ts'

describe('PATCH probe (round 5: line by line)', () => {
  it('writes v2 paragraphs for src, steps and notes and real lists for ing', () => {
    const { document } = parseHTML(buildPatchProbePage())
    for (const id of ['hk-src', 'hk-ing', 'hk-steps', 'hk-notes', 'hk-ref']) {
      expect(document.querySelector(`[data-id="${id}"]`)).not.toBeNull()
    }
    expect(document.querySelectorAll('[data-id="hk-ing"] li').length).toBe(3)
    expect(document.querySelectorAll('[data-id="hk-steps"] li').length).toBe(0)
  })

  it('writes the paragraph sections, refuses the list section, and finds the page clean after each trial', async () => {
    const onenote = new FakeOneNote({ s: 'nb' })
    const { trials } = await runPatchProbe(onenote, 's')
    expect(trials).toHaveLength(PATCH_TRIALS.length)
    expect(trials.map((t) => t.requests.length)).toEqual([1, 1, 1, 1, 1, 1, 1, 0])
    for (const trial of trials) expect({ name: trial.name, mismatched: trial.mismatched }).toEqual({ name: trial.name, mismatched: [] })
    expect(trials.at(-1)).toMatchObject({ ok: false, error: expect.stringContaining('a OneNote list') })
  })

  it('reports a section that does not read back as written', async () => {
    const onenote = new FakeOneNote({ s: 'nb' })
    // This OneNote accepts every request but changes nothing.
    onenote.patchPage = async () => {}
    const { trials } = await runPatchProbe(onenote, 's')
    expect(trials[0]).toMatchObject({ ok: true, clean: false, mismatched: ['steps'] })
  })
})
