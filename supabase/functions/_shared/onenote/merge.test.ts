import { describe, expect, it } from 'vitest'
import { planMerge } from './merge.ts'
import { withValue, type PageState } from './sections.ts'

const BASE: PageState = {
  title: 'كبسة دجاج',
  sections: {
    src: [{ text: 'يوتيوب', url: 'https://youtu.be/x' }],
    ing: [{ name: null, items: ['دجاج', 'رز'] }],
    steps: ['نحمر البصل', 'نضيف الدجاج'],
    notes: ['بهارات أقل'],
  },
}

const steps = (state: PageState, value: string[]) => withValue(state, 'steps', value)

describe('planMerge', () => {
  it('does nothing when no side changed', () => {
    const plan = planMerge(BASE, BASE, BASE)
    expect(plan.toPush).toEqual([])
    expect(plan.toPull).toEqual([])
    expect(plan.conflicts).toEqual([])
  })

  it('pushes a section changed only in the app', () => {
    const local = steps(BASE, ['نحمر البصل', 'نضيف الدجاج', 'نطبخ ساعة'])
    const plan = planMerge(BASE, local, BASE)
    expect(plan.toPush).toEqual(['steps'])
    expect(plan.nextBase.sections.steps).toEqual(local.sections.steps)
    expect(plan.merged).toEqual(local)
  })

  it('pulls a section changed only in OneNote', () => {
    const remote = withValue(BASE, 'notes', ['بهارات أقل', 'تكفي 6'])
    const plan = planMerge(BASE, BASE, remote)
    expect(plan.toPull).toEqual(['notes'])
    expect(plan.merged.sections.notes).toEqual(['بهارات أقل', 'تكفي 6'])
    expect(plan.nextBase.sections.notes).toEqual(['بهارات أقل', 'تكفي 6'])
  })

  it('merges different sections changed on different sides', () => {
    const local = steps(BASE, ['نحمر البصل'])
    const remote = withValue(BASE, 'title', 'كبسة دجاج بالفرن')
    const plan = planMerge(BASE, local, remote)
    expect(plan.toPush).toEqual(['steps'])
    expect(plan.toPull).toEqual(['title'])
    expect(plan.conflicts).toEqual([])
    expect(plan.merged.title).toBe('كبسة دجاج بالفرن')
    expect(plan.merged.sections.steps).toEqual(['نحمر البصل'])
  })

  it('reports a conflict and overwrites neither side when both changed the same section differently', () => {
    const local = steps(BASE, ['من التطبيق'])
    const remote = steps(BASE, ['من OneNote'])
    const plan = planMerge(BASE, local, remote)
    expect(plan.conflicts).toEqual(['steps'])
    expect(plan.toPush).toEqual([])
    expect(plan.toPull).toEqual([])
    expect(plan.merged.sections.steps).toEqual(['من التطبيق'])
    expect(plan.nextBase.sections.steps).toEqual(BASE.sections.steps)
  })

  it('treats the same change on both sides as agreement', () => {
    const changed = steps(BASE, ['واحد'])
    const plan = planMerge(BASE, changed, changed)
    expect(plan.decisions.steps).toBe('same')
    expect(plan.conflicts).toEqual([])
  })

  it('ignores whitespace and bidi marks that OneNote clients add', () => {
    const remote = steps(BASE, ['نحمر البصل‏', '  نضيف الدجاج'])
    expect(planMerge(BASE, BASE, remote).decisions.steps).toBe('unchanged')
  })

  it('restores a section that was deleted from the page instead of emptying it in the app', () => {
    const remote = withValue(BASE, 'notes', [])
    const plan = planMerge(BASE, BASE, remote, { notes: 'missing' })
    expect(plan.decisions.notes).toBe('restore')
    expect(plan.toPush).toEqual(['notes'])
    expect(plan.merged.sections.notes).toEqual(['بهارات أقل'])
  })

  it('on first sync of an existing page pushes only what differs from OneNote', () => {
    const local = steps(BASE, ['جديد'])
    const plan = planMerge(null, local, BASE)
    expect(plan.toPush).toEqual(['steps'])
    expect(plan.toPull).toEqual([])
  })
})
