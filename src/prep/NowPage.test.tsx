import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NowPage, { type NowApi } from './NowPage'
import type { MealInfo, NowData, Task } from './api'

const TODAY = '2026-11-14'

const task = (id: string, day: string, timing: Task['timing'], body: string, extra: Partial<Task> = {}): Task => ({
  id,
  planned_meal_id: null,
  day,
  timing,
  at_time: null,
  kind: 'other',
  body,
  from_template: false,
  done_at: null,
  done_by: null,
  position: 1,
  ...extra,
})

function fake(tasks: Task[], meals: Record<string, MealInfo> = {}) {
  const state = { tasks: [...tasks] }
  const api = {
    loadNow: vi.fn(async (): Promise<NowData> => ({ tasks: state.tasks.filter((t) => !('dismissed' in t)), meals })),
    generateTasks: vi.fn(async () => ({ added: 0, updated: 0, removed: 0 })),
    setDone: vi.fn(async (id: string, done: boolean) => {
      state.tasks = state.tasks.map((t) => (t.id === id ? { ...t, done_at: done ? '2026-11-14T08:00:00Z' : null } : t))
    }),
    addTask: vi.fn(async (t: { day: string; timing: Task['timing']; atTime: string | null; body: string }) => {
      state.tasks.push(task(`n${state.tasks.length}`, t.day, t.timing, t.body, { at_time: t.atTime ? `${t.atTime}:00` : null }))
    }),
    updateTask: vi.fn(async (id: string, t: { day: string; timing: Task['timing']; atTime: string | null; body: string }) => {
      state.tasks = state.tasks.map((x) => (x.id === id ? { ...x, day: t.day, timing: t.timing, at_time: t.atTime ? `${t.atTime}:00` : null, body: t.body } : x))
    }),
    dismissTask: vi.fn(async (id: string) => void (state.tasks = state.tasks.filter((t) => t.id !== id))),
  }
  return api
}

const show = (api: ReturnType<typeof fake>, canEdit: boolean) => render(<NowPage canEdit={canEdit} today={() => TODAY} api={api as unknown as NowApi} />)

afterEach(cleanup)

describe('what to do now', () => {
  it('shows what is late, then today in order, with the meal each task is for', async () => {
    const api = fake(
      [
        task('late', '2026-11-12', 'morning', 'مهمة متأخرة'),
        task('b', TODAY, 'before_cooking', 'قبل الطبخ', { planned_meal_id: 'm1' }),
        task('a', TODAY, 'morning', 'صباحًا'),
        task('c', TODAY, 'at_time', 'في الخامسة', { at_time: '17:00:00' }),
      ],
      { m1: { title: 'دجاج مشوي', day: TODAY, slot: 'غداء' } },
    )
    show(api, false)
    expect(await screen.findByText('إيش أسوي الآن؟')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'متأخرة' })).getByText('مهمة متأخرة')).toBeTruthy()
    const today = within(screen.getByRole('region', { name: 'اليوم' }))
    expect(today.getAllByRole('checkbox').map((c) => c.closest('li')?.textContent)).toEqual([
      expect.stringContaining('صباحًا'),
      expect.stringContaining('في الخامسة'),
      expect.stringContaining('قبل الطبخ'),
    ])
    expect(today.getByText('الساعة 17:00')).toBeTruthy()
    expect(today.getByText(/لوجبة: دجاج مشوي \(السبت · غداء\)/)).toBeTruthy()
  })

  it('says so when there is nothing to prepare', async () => {
    show(fake([]), false)
    expect(await screen.findByText('لا مهام تجهيز اليوم.')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'متأخرة' })).toBeNull()
  })

  it('puts tomorrow and what is done today behind a fold', async () => {
    const api = fake([task('t', '2026-11-15', 'morning', 'مهمة الغد'), task('d', TODAY, 'morning', 'مهمة منجزة', { done_at: '2026-11-14T07:00:00Z' })])
    show(api, false)
    expect(await screen.findByText('غدًا (1)')).toBeTruthy()
    expect(screen.getByText('أُنجز اليوم (1)')).toBeTruthy()
    expect(screen.getByText('أنجزتِ كل مهام اليوم.')).toBeTruthy()
  })
})

describe('ticking', () => {
  it('lets anyone, a reader too, tick a task and untick it', async () => {
    const api = fake([task('a', TODAY, 'morning', 'صباحًا')])
    show(api, false)
    fireEvent.click(await screen.findByRole('checkbox', { name: /صباحًا/ }))
    await waitFor(() => expect(api.setDone).toHaveBeenCalledWith('a', true))
    expect(await screen.findByText('أُنجز اليوم (1)')).toBeTruthy()
    expect(api.generateTasks).not.toHaveBeenCalled() // a reader does not change the tasks, only ticks them
  })

  it('shows no editing buttons to a reader', async () => {
    show(fake([task('a', TODAY, 'morning', 'اشتري الخبز')]), false)
    await screen.findByText('اشتري الخبز')
    expect(screen.queryByRole('button', { name: 'تعديل' })).toBeNull()
    expect(screen.queryByRole('button', { name: '+ مهمة جديدة' })).toBeNull()
  })
})

describe('owners and editors', () => {
  it('bring the tasks up to date with the plan when they open the page', async () => {
    const api = fake([])
    show(api, true)
    await screen.findByText('إيش أسوي الآن؟')
    expect(api.generateTasks).toHaveBeenCalledWith(TODAY)
    expect(api.generateTasks).toHaveBeenCalledTimes(1)
  })

  it('still show the tasks if bringing them up to date fails', async () => {
    const api = fake([task('a', TODAY, 'morning', 'اشتري الخبز')])
    api.generateTasks.mockRejectedValueOnce(new Error('boom'))
    show(api, true)
    expect(await screen.findByText('اشتري الخبز')).toBeTruthy()
  })

  it('add a task of their own', async () => {
    const api = fake([])
    show(api, true)
    fireEvent.click(await screen.findByRole('button', { name: '+ مهمة جديدة' }))
    expect((screen.getByRole('button', { name: 'أضيفي المهمة' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('ماذا تفعلين؟'), { target: { value: 'اشتري ليمون' } })
    fireEvent.change(screen.getByLabelText('التوقيت'), { target: { value: 'morning' } })
    fireEvent.click(screen.getByRole('button', { name: 'أضيفي المهمة' }))
    await waitFor(() => expect(api.addTask).toHaveBeenCalledWith({ day: TODAY, timing: 'morning', atTime: null, body: 'اشتري ليمون' }))
    expect(await screen.findByText('اشتري ليمون')).toBeTruthy()
  })

  it('change a task, including its time', async () => {
    const api = fake([task('a', TODAY, 'morning', 'صباحًا')])
    show(api, true)
    fireEvent.click(await screen.findByRole('button', { name: 'تعديل' }))
    fireEvent.change(screen.getByLabelText('التوقيت'), { target: { value: 'at_time' } })
    fireEvent.change(screen.getByLabelText('الساعة'), { target: { value: '18:45' } })
    fireEvent.change(screen.getByLabelText('ماذا تفعلين؟'), { target: { value: 'معدّلة' } })
    fireEvent.click(screen.getByRole('button', { name: 'احفظي التعديل' }))
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith('a', { day: TODAY, timing: 'at_time', atTime: '18:45', body: 'معدّلة' }))
    expect(await screen.findByText('الساعة 18:45')).toBeTruthy()
  })

  it('dismiss a task after a question that says it will not come back', async () => {
    const api = fake([task('a', TODAY, 'morning', 'صباحًا')])
    show(api, true)
    fireEvent.click(await screen.findByRole('button', { name: 'إخفاء' }))
    expect(screen.getByText(/ولا تعود حتى لو حدّثتِ الخطة/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء' }))
    expect(api.dismissTask).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'إخفاء' }))
    fireEvent.click(screen.getByRole('button', { name: 'نعم، أخفيها' }))
    await waitFor(() => expect(api.dismissTask).toHaveBeenCalledWith('a'))
    await waitFor(() => expect(screen.queryByText('صباحًا')).toBeNull())
  })

  it('see the reason in Arabic when a change is refused', async () => {
    const api = fake([task('a', TODAY, 'morning', 'صباحًا')])
    api.dismissTask.mockRejectedValueOnce(new Error('not allowed to change the plan'))
    show(api, true)
    fireEvent.click(await screen.findByRole('button', { name: 'إخفاء' }))
    fireEvent.click(screen.getByRole('button', { name: 'نعم، أخفيها' }))
    expect(await screen.findByText('لا تملكين صلاحية تعديل المهام.')).toBeTruthy()
  })
})
