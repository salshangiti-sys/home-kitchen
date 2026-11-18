import { describe, expect, it } from 'vitest'
import { KINDS, KIND_LABELS, groupNow, sortByKind, overlayTicks, prepMessage, shortTime, sortTasks, suggestPrep, type Task } from './api'

const task = (id: string, day: string, timing: Task['timing'], at_time: string | null = null, extra: Partial<Task> = {}): Task => ({
  id,
  planned_meal_id: null,
  day,
  timing,
  at_time,
  kind: 'other',
  body: id,
  from_template: false,
  done_at: null,
  done_by: null,
  position: 1,
  ...extra,
})

describe('the kinds of prep task', () => {
  it('has «للزينة» before «أخرى», and a label for each kind', () => {
    expect(KINDS.indexOf('garnish')).toBe(KINDS.indexOf('other') - 1)
    expect(KIND_LABELS.garnish).toBe('للزينة')
    for (const kind of KINDS) expect(KIND_LABELS[kind]).toBeTruthy()
  })

  it('lists them thawing, dough, chopping, seasoning, sauces, garnish, then the rest', () => {
    expect(KINDS).toEqual(['defrost', 'dough', 'wash_chop', 'marinade', 'sauce', 'garnish', 'other'])
    expect(KIND_LABELS.dough).toBe('العجينة')
  })

  it('sorts a recipe\'s tasks by kind, keeping the written order inside a kind', () => {
    const items = [
      { id: 'o', kind: 'other' as const, position: 1 },
      { id: 'g', kind: 'garnish' as const, position: 2 },
      { id: 's2', kind: 'sauce' as const, position: 4 },
      { id: 's1', kind: 'sauce' as const, position: 3 },
      { id: 'd', kind: 'dough' as const, position: 5 },
      { id: 'm', kind: 'marinade' as const, position: 6 },
      { id: 'w', kind: 'wash_chop' as const, position: 7 },
      { id: 'f', kind: 'defrost' as const, position: 8 },
    ]
    expect(sortByKind(items).map((i) => i.id)).toEqual(['f', 'd', 'w', 'm', 's1', 's2', 'g', 'o'])
  })
})

describe('sortTasks', () => {
  it('orders a day: morning, the timed ones by time, before cooking, then tonight for tomorrow', () => {
    const tasks = [
      task('tonight', '2026-11-14', 'night_before'),
      task('cook', '2026-11-14', 'before_cooking'),
      task('five', '2026-11-14', 'at_time', '17:00:00'),
      task('morning', '2026-11-14', 'morning'),
      task('noon', '2026-11-14', 'at_time', '12:30:00'),
      task('yesterday', '2026-11-13', 'before_cooking'),
    ]
    expect(sortTasks(tasks).map((t) => t.id)).toEqual(['yesterday', 'morning', 'noon', 'five', 'cook', 'tonight'])
  })

  it('puts tasks of the same time in kind order, thawing first and «أخرى» last', () => {
    const tasks = [
      task('other', '2026-11-14', 'before_cooking', null, { kind: 'other', position: 1 }),
      task('sauce', '2026-11-14', 'before_cooking', null, { kind: 'sauce', position: 2 }),
      task('chop', '2026-11-14', 'before_cooking', null, { kind: 'wash_chop', position: 3 }),
      task('thaw', '2026-11-14', 'before_cooking', null, { kind: 'defrost', position: 4 }),
    ]
    expect(sortTasks(tasks).map((t) => t.id)).toEqual(['thaw', 'chop', 'sauce', 'other'])
  })

  it('does not change the list it was given', () => {
    const tasks = [task('b', '2026-11-15', 'morning'), task('a', '2026-11-14', 'morning')]
    sortTasks(tasks)
    expect(tasks.map((t) => t.id)).toEqual(['b', 'a'])
  })
})

describe('groupNow', () => {
  const today = '2026-11-14'
  const tasks = [
    task('late', '2026-11-12', 'morning'),
    task('late-done', '2026-11-12', 'morning', null, { done_at: '2026-11-12T10:00:00Z' }),
    task('now-2', today, 'before_cooking'),
    task('now-1', today, 'morning'),
    task('now-done', today, 'morning', null, { done_at: '2026-11-14T07:00:00Z' }),
    task('soon', '2026-11-15', 'morning'),
    task('soon-done', '2026-11-15', 'morning', null, { done_at: '2026-11-14T07:00:00Z' }),
  ]

  it('splits the tasks into late, today, tomorrow and done today, open ones in order', () => {
    const g = groupNow(tasks, today)
    expect(g.overdue.map((t) => t.id)).toEqual(['late'])
    expect(g.today.map((t) => t.id)).toEqual(['now-1', 'now-2'])
    expect(g.tomorrow.map((t) => t.id)).toEqual(['soon'])
    expect(g.doneToday.map((t) => t.id)).toEqual(['now-done'])
  })

  it('does not call a done task late', () => {
    expect(groupNow(tasks, today).overdue.some((t) => t.id === 'late-done')).toBe(false)
  })
})

describe('suggestPrep', () => {
  it('suggests the freezer for a line that says frozen', () => {
    const [s] = suggestPrep(['٢ كوب خضار مجمدة'])
    expect(s).toMatchObject({ kind: 'defrost', timing: 'night_before' })
    expect(s.body).toContain('أخرجي')
    expect(s.body).toContain('مجمدة')
  })

  it('suggests it for minced, breast or fillet of meat, chicken or fish, whatever the spelling of ة and ه', () => {
    expect(suggestPrep(['500 غ لحم مفروم'])).toHaveLength(1)
    expect(suggestPrep(['صدور دجاج'])).toHaveLength(1)
    expect(suggestPrep(['فيليه سمك'])).toHaveLength(1)
    expect(suggestPrep(['كفتة مفرومه'])).toHaveLength(1)
  })

  it('does not suggest it for chopped vegetables or things that are not meat', () => {
    expect(suggestPrep(['بصل مفروم', 'ثوم مفروم', 'زيت زيتون', 'ملح'])).toEqual([])
  })

  it('suggests once for a repeated line, and invents no duration', () => {
    const found = suggestPrep(['دجاج مجمد', 'دجاج مجمد', ' '])
    expect(found).toHaveLength(1)
    expect(found[0].body).not.toMatch(/\d/)
  })

  it('shortens a very long line', () => {
    const [s] = suggestPrep([`دجاج مجمد ${'ا'.repeat(200)}`])
    expect(s.body.length).toBeLessThan(120)
  })
})

describe('helpers', () => {
  it('shows a database time as hours and minutes', () => {
    expect(shortTime('16:30:00')).toBe('16:30')
    expect(shortTime(null)).toBeNull()
  })

  it('explains the database refusals in Arabic', () => {
    expect(prepMessage(new Error('bad_timing: x'))).toContain('وقتًا محددًا')
    expect(prepMessage(new Error('not allowed to change the plan'))).toContain('صلاحية')
    expect(prepMessage(new Error('Failed to fetch'))).toContain('الإنترنت')
  })
})

describe('ticks waiting to be sent (overlayTicks)', () => {
  const open = (id: string) => ({ id, planned_meal_id: null, day: '2026-11-14', timing: 'morning' as const, at_time: null, kind: 'other' as const, body: id, from_template: false, done_at: null, done_by: null, position: 1 })
  const op = (id: string, done: boolean, at: string) => ({ id: `op-${id}`, key: `task_done:${id}`, kind: 'task_done', args: { id, done }, at })

  it('puts waiting ticks on top of what was read, and says which tasks are waiting', () => {
    const tasks = [open('a'), { ...open('b'), done_at: '2026-11-14T07:00:00Z' }, open('c')]
    const { tasks: shown, waiting } = overlayTicks(tasks, [op('a', true, '2026-11-14T09:00:00Z'), op('b', false, '2026-11-14T09:05:00Z')])
    expect(shown.map((t) => t.done_at)).toEqual(['2026-11-14T09:00:00Z', null, null])
    expect([...waiting].sort()).toEqual(['a', 'b'])
  })

  it('ignores other kinds of waiting changes and leaves the tasks untouched without any', () => {
    const tasks = [open('a')]
    expect(overlayTicks(tasks, []).tasks).toEqual(tasks)
    expect(overlayTicks(tasks, [{ id: 'x', key: 'k', kind: 'shopping', args: { id: 'a', done: true }, at: 'now' }]).waiting.size).toBe(0)
  })
})
