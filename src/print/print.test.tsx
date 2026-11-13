import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseHash, href } from '../router'
import type { Person, PlannedMeal, Slot, WeekData } from '../plan/api'
import type { NowData, Task } from '../prep/api'
import PrintPage, { type PrintApi } from './PrintPage'
import { buildPrintWeek } from './model'

afterEach(cleanup)

const WEEK = '2026-11-14' // a Saturday
const slots: Slot[] = [
  { id: 'dinner', name: 'عشاء', position: 3 },
  { id: 'lunch', name: 'غداء', position: 2 },
]
const people: Person[] = [{ id: 'p1', name: 'سارة', kind: 'adult', allergies: [], notes: null, position: 1 }]
const meal = (id: string, day: string, slot_id: string, title: string, extra: Partial<PlannedMeal> = {}): PlannedMeal => ({
  id, day, slot_id, recipe_id: null, title, free_text: title, servings: null, people: [], position: 1, status: 'planned', ...extra,
})
const task = (id: string, day: string, extra: Partial<Task> = {}): Task => ({
  id, planned_meal_id: null, day, timing: 'morning', at_time: null, kind: 'other', body: id, from_template: false, done_at: null, done_by: null, position: 1, ...extra,
})

describe('the printed week', () => {
  it('lists the days of the week with their meals, slots in order, and leaves skipped meals out', () => {
    const week = buildPrintWeek({
      weekStart: WEEK,
      slots,
      people,
      tasks: null,
      meals: [
        meal('a', '2026-11-14', 'dinner', 'مكرونة بالبشاميل', { servings: 4, people: ['p1', 'gone'] }),
        meal('b', '2026-11-14', 'lunch', 'سلطة'),
        meal('c', '2026-11-15', 'lunch', 'مخطّطة ثم تخطّيناها', { status: 'skipped' }),
      ],
    })
    expect(week.days).toHaveLength(7)
    expect(week.days[0].slots.map((s) => s.name)).toEqual(['غداء', 'عشاء'])
    expect(week.days[0].slots[1].meals[0]).toMatchObject({ title: 'مكرونة بالبشاميل', servings: 4, people: ['سارة'] })
    expect(week.days[1].slots).toEqual([])
    expect(week.days.every((d) => d.tasks.length === 0)).toBe(true)
    expect(week.before).toBeNull()
  })

  it('puts each task under its day, in order, with the meal it is for, and the evening-before tasks apart', () => {
    const week = buildPrintWeek({
      weekStart: WEEK,
      slots,
      people,
      meals: [],
      tasks: [
        task('late', '2026-11-14', { timing: 'before_cooking', body: 'قطّعي الخضار', planned_meal_id: 'm1' }),
        task('early', '2026-11-14', { timing: 'morning', body: 'أخرجي الدجاج' }),
        task('timed', '2026-11-14', { timing: 'at_time', at_time: '18:30:00', body: 'ضعي الأرز', done_at: '2026-11-14T10:00:00Z' }),
        task('eve', '2026-11-13', { timing: 'night_before', body: 'انقعي الحمص' }),
        task('outside', '2026-11-30', { body: 'خارج الأسبوع' }),
      ],
      taskMeals: { m1: { title: 'كبسة', day: '2026-11-14', slot: 'غداء' } },
    })
    expect(week.days[0].tasks.map((t) => t.id)).toEqual(['early', 'timed', 'late'])
    expect(week.days[0].tasks[1]).toMatchObject({ when: 'في وقت محدد 18:30', done: true })
    expect(week.days[0].tasks[2].meal).toBe('كبسة')
    expect(week.before?.tasks.map((t) => t.id)).toEqual(['eve'])
    expect(week.days.flatMap((d) => d.tasks).some((t) => t.id === 'outside')).toBe(false)
  })
})

describe('print routes', () => {
  it('reads the week and the tasks option from the address', () => {
    expect(parseHash('#/print')).toEqual({ name: 'print', tasks: false })
    expect(parseHash('#/print/2026-11-14')).toEqual({ name: 'print', week: '2026-11-14', tasks: false })
    expect(parseHash('#/print/2026-11-14/tasks')).toEqual({ name: 'print', week: '2026-11-14', tasks: true })
    expect(href.print('2026-11-14', true)).toBe('#/print/2026-11-14/tasks')
    expect(href.print(undefined, false)).toBe('#/print')
  })
})

function api(options: { meals?: PlannedMeal[]; tasks?: Task[]; tasksFail?: boolean } = {}): PrintApi {
  const week: WeekData = { weekStart: WEEK, startDow: 6, slots, people, meals: options.meals ?? [], overrides: [], recipeGroups: {} }
  const tasks: NowData = { tasks: options.tasks ?? [], meals: {} }
  return {
    loadWeek: vi.fn(async () => week),
    loadWeekTasks: vi.fn(async () => {
      if (options.tasksFail) throw new Error('boom')
      return tasks
    }),
  }
}

describe('the print page', () => {
  it('shows the week with its meals, and prints when asked', async () => {
    const print = vi.fn()
    const a = api({ meals: [meal('a', '2026-11-14', 'lunch', 'كبسة دجاج', { servings: 4, people: ['p1'] })] })
    render(<PrintPage week={WEEK} withTasks={false} api={a} print={print} today={() => WEEK} />)
    const sheet = await screen.findByRole('article', { name: 'الخطة المطبوعة' })
    expect(within(sheet).getByText('خطة الأسبوع')).toBeTruthy()
    const saturday = within(sheet).getByRole('region', { name: /السبت/ })
    expect(within(saturday).getByText('غداء')).toBeTruthy()
    expect(within(saturday).getByText(/كبسة دجاج/)).toBeTruthy()
    expect(within(saturday).getByText(/4 حصص — سارة/)).toBeTruthy()
    expect(a.loadWeekTasks).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'اطبعي' }))
    expect(print).toHaveBeenCalledTimes(1)
  })

  it('links the two versions, and the buttons are left out of the print', async () => {
    render(<PrintPage week={WEEK} withTasks={false} api={api()} today={() => WEEK} />)
    const withTasks = await screen.findByRole('link', { name: 'الوجبات مع التجهيز' })
    expect(withTasks.getAttribute('href')).toBe('#/print/2026-11-14/tasks')
    expect(screen.getByRole('link', { name: 'الوجبات فقط' }).getAttribute('href')).toBe('#/print/2026-11-14')
    expect(screen.getByRole('button', { name: 'اطبعي' }).closest('.print\\:hidden')).not.toBeNull()
    expect(screen.getByText('لا وجبات في هذا الأسبوع بعد.')).toBeTruthy()
  })

  it('adds the prep tasks of each day when asked', async () => {
    const a = api({
      meals: [meal('a', '2026-11-14', 'lunch', 'كبسة')],
      tasks: [task('t1', '2026-11-14', { body: 'أخرجي الدجاج' }), task('t0', '2026-11-13', { timing: 'night_before', body: 'انقعي الأرز' })],
    })
    render(<PrintPage week={WEEK} withTasks api={a} today={() => WEEK} />)
    await screen.findByText('أخرجي الدجاج')
    expect(screen.getByText('انقعي الأرز')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'قبل بداية الأسبوع' })).toBeTruthy()
    expect(a.loadWeekTasks).toHaveBeenCalledWith(WEEK)
  })

  it('still prints the meals when the tasks cannot be loaded, and says so', async () => {
    render(<PrintPage week={WEEK} withTasks api={api({ meals: [meal('a', '2026-11-14', 'lunch', 'كبسة')], tasksFail: true })} today={() => WEEK} />)
    await waitFor(() => expect(screen.getByText(/تعذّر تحميل مهام التجهيز/)).toBeTruthy())
    expect(screen.getByText('كبسة')).toBeTruthy()
  })

  it('shows an error when the week cannot be loaded', async () => {
    const broken: PrintApi = { loadWeek: vi.fn(async () => { throw new Error('boom') }), loadWeekTasks: vi.fn() as never }
    render(<PrintPage week={WEEK} withTasks={false} api={broken} today={() => WEEK} />)
    await screen.findByText('boom')
  })
})
