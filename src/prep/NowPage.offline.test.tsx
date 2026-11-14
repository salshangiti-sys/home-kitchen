import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OutboxNotice } from '../offline/Status'
import { enqueue, failures, flush, pending, registerHandler } from '../offline/outbox'
import { setCacheOwner, useStore } from '../offline/readThrough'
import { memoryStore } from '../offline/store'
import NowPage, { type NowApi } from './NowPage'
import { TICK_KIND, tickKey, type NowData, type Task } from './api'

const TODAY = '2026-11-14'

const task = (id: string, body: string, extra: Partial<Task> = {}): Task => ({
  id, planned_meal_id: null, day: TODAY, timing: 'morning', at_time: null, kind: 'other', body, from_template: false, done_at: null, done_by: null, position: 1, ...extra,
})

// A server that can be made unreachable or refuse.
function server(tasks: Task[]) {
  const state = { tasks: [...tasks], mode: 'offline' as 'offline' | 'online' | 'refuse' }
  const api = {
    loadNow: vi.fn(async (): Promise<NowData> => {
      if (state.mode === 'offline') return { tasks: [...tasks], meals: {} } // the copy kept on the device: what it last read
      return { tasks: [...state.tasks], meals: {} }
    }),
    generateTasks: vi.fn(async () => ({ added: 0, updated: 0, removed: 0 })),
    setDone: vi.fn(async (id: string, done: boolean) => {
      if (state.mode === 'offline') throw new TypeError('Failed to fetch')
      if (state.mode === 'refuse') throw new Error('not allowed')
      state.tasks = state.tasks.map((t) => (t.id === id ? { ...t, done_at: done ? '2026-11-14T10:00:00Z' : null } : t))
    }),
    addTask: vi.fn(),
    updateTask: vi.fn(),
    dismissTask: vi.fn(),
  }
  // How a waiting tick is sent: through this server.
  registerHandler(TICK_KIND, 'تعليم مهمة', (args) => api.setDone(String(args.id), args.done === true))
  return { state, api }
}

const show = (api: ReturnType<typeof server>['api']) => render(<NowPage canEdit={false} today={() => TODAY} api={api as unknown as NowApi} />)

beforeEach(async () => {
  useStore(memoryStore())
  await setCacheOwner(null)
  await setCacheOwner('u1')
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ticking a task with no connection', () => {
  it('shows it done as "not sent yet", keeps it in the outbox, and sends it when the connection returns', async () => {
    const { state, api } = server([task('a', 'انقعي الأرز')])
    show(api)
    const box = (await screen.findByRole('checkbox', { name: /انقعي الأرز/ })) as HTMLInputElement
    fireEvent.click(box)

    expect(await screen.findByText('لم تُرسل بعد')).toBeTruthy()
    expect(await screen.findByText('أُنجز اليوم (1)')).toBeTruthy()
    expect((await pending()).map((op) => op.args)).toEqual([{ id: 'a', done: true }])
    expect(screen.queryByText(/تعذّر/)).toBeNull() // no error message: it is saved on the device

    state.mode = 'online'
    await act(async () => void (await flush()))
    await waitFor(() => expect(screen.queryByText('لم تُرسل بعد')).toBeNull())
    expect(state.tasks[0].done_at).not.toBeNull()
    expect(await pending()).toEqual([])
    expect(screen.getByText('أُنجز اليوم (1)')).toBeTruthy()
  })

  it('keeps only the last tick of a task: ticking and unticking offline sends one change', async () => {
    const { api } = server([task('a', 'انقعي الأرز')])
    show(api)
    const tick = async () => fireEvent.click(await screen.findByRole('checkbox', { name: /انقعي الأرز/ }))
    await tick()
    await screen.findByText('لم تُرسل بعد')
    await tick()
    await waitFor(async () => expect((await pending()).map((op) => op.args)).toEqual([{ id: 'a', done: false }]))
  })

  it('still shows the waiting tick when the page is opened again with no connection', async () => {
    await enqueue(TICK_KIND, tickKey('a'), { id: 'a', done: true }, '2026-11-14T09:00:00Z')
    const { api } = server([task('a', 'انقعي الأرز')])
    show(api)
    expect(await screen.findByText('لم تُرسل بعد')).toBeTruthy()
    expect(screen.getByText('أُنجز اليوم (1)')).toBeTruthy()
  })

  it('tells the person when the server refused the change, and shows the task as the server has it', async () => {
    const { state, api } = server([task('a', 'انقعي الأرز')])
    show(api)
    fireEvent.click(await screen.findByRole('checkbox', { name: /انقعي الأرز/ }))
    await screen.findByText('لم تُرسل بعد')
    state.mode = 'refuse'
    await act(async () => void (await flush()))
    await waitFor(() => expect(screen.queryByText('لم تُرسل بعد')).toBeNull())
    expect(screen.queryByText('أُنجز اليوم (1)')).toBeNull() // back to open: the server never accepted it
    expect((await failures())[0]).toMatchObject({ label: 'تعليم مهمة', message: 'not allowed' })
  })

  it('does not queue a real error (only a missing connection waits)', async () => {
    const { state, api } = server([task('a', 'انقعي الأرز')])
    state.mode = 'refuse'
    show(api)
    fireEvent.click(await screen.findByRole('checkbox', { name: /انقعي الأرز/ }))
    expect(await screen.findByText(/صلاحية تعديل المهام/)).toBeTruthy() // the server's refusal, in words
    expect(await pending()).toEqual([])
  })
})

describe('the notice about waiting changes', () => {
  it('counts what is waiting and shows what was refused until it is dismissed', async () => {
    const { state } = server([])
    render(<OutboxNotice />)
    expect(screen.queryByText(/لم تُرسل بعد/)).toBeNull()

    await act(async () => void (await enqueue(TICK_KIND, tickKey('a'), { id: 'a', done: true })))
    expect(await screen.findByText(/تغيير واحد لم يُرسل بعد/)).toBeTruthy()
    await act(async () => void (await enqueue(TICK_KIND, tickKey('b'), { id: 'b', done: true })))
    expect(await screen.findByText(/2 تغييرات لم تُرسل بعد/)).toBeTruthy()

    state.mode = 'refuse'
    await act(async () => void (await flush()))
    expect((await screen.findAllByText(/تعليم مهمة.*not allowed/)).length).toBe(2) // one for each refused change
    fireEvent.click(screen.getAllByRole('button', { name: 'تم' })[0])
    await waitFor(() => expect(screen.queryAllByText(/تعذّر إرسال تغيير/).length).toBe(1))
  })
})
