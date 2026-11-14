import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { failures, flush, pending, registerHandler, enqueue, subscribe } from '../offline/outbox'
import { setCacheOwner, useStore } from '../offline/readThrough'
import { memoryStore } from '../offline/store'
import type { WeekData } from '../plan/api'
import ShoppingPage, { type ShoppingApi } from './ShoppingPage'
import type { ShoppingData } from './api'
import { ADD_KIND, CLEAR_KIND, CONFIRM_KIND, MARK_KIND, PANTRY_KIND, UNCONFIRM_KIND, type Confirmation, type Mark, type PantryItem } from './model'

const WEEK = '2026-11-14'

const weekData = (meals: WeekData['meals']): WeekData => ({ weekStart: WEEK, startDow: 6, slots: [], people: [], meals, overrides: [], recipeGroups: {} })
const meal = (id: string, recipe: string | null, title: string, status: 'planned' | 'cooked' | 'skipped' = 'planned') => ({
  id, day: WEEK, slot_id: 's', recipe_id: recipe, title, free_text: null, servings: null, people: [], position: 1, status,
})

// A server that can be made unreachable. While unreachable the page gets what it last read (the copy
// kept on the device) and every send fails like a missing connection.
function server(meals: WeekData['meals'], recipes: ShoppingData['recipes']) {
  const state = { marks: [] as Mark[], pantry: [] as PantryItem[], confirmations: [] as Confirmation[], mode: 'online' as 'online' | 'offline' | 'refuse', last: null as ShoppingData | null }
  const guard = () => {
    if (state.mode === 'offline') throw new TypeError('Failed to fetch')
    if (state.mode === 'refuse') throw new Error('not allowed')
  }
  const upsert = (key: string, patch: Partial<Mark>) => {
    const old = state.marks.find((m) => m.key === key)
    state.marks = old ? state.marks.map((m) => (m.key === key ? { ...m, ...patch } : m)) : [...state.marks, { key, label: null, status: 'needed', is_manual: false, ...patch }]
  }
  registerHandler(MARK_KIND, 'علامة', async (a) => { guard(); upsert(String(a.key), { status: a.status as Mark['status'] }) })
  registerHandler(ADD_KIND, 'إضافة', async (a) => { guard(); upsert(String(a.key), { label: String(a.label), is_manual: true, status: 'needed' }) })
  registerHandler(CLEAR_KIND, 'حذف', async (a) => { guard(); state.marks = state.marks.filter((m) => m.key !== a.key) })
  registerHandler(PANTRY_KIND, 'بيت', async (a) => {
    guard()
    state.pantry = a.on === true ? [...state.pantry.filter((p) => p.key !== a.key), { key: String(a.key), label: String(a.label) }] : state.pantry.filter((p) => p.key !== a.key)
  })
  const sameLine = (c: Confirmation, a: Record<string, unknown>) => c.recipe_id === a.recipe && c.line === a.line && c.item_key === a.key
  registerHandler(CONFIRM_KIND, 'تأكيد', async (a) => {
    guard()
    state.confirmations = [...state.confirmations.filter((c) => !sameLine(c, a)), { recipe_id: String(a.recipe), line: String(a.line), item_key: String(a.key), quantity: Number(a.quantity), unit: (a.unit as Confirmation['unit']) ?? null }]
  })
  registerHandler(UNCONFIRM_KIND, 'إلغاء تأكيد', async (a) => { guard(); state.confirmations = state.confirmations.filter((c) => !sameLine(c, a)) })
  const api: ShoppingApi = {
    loadWeek: vi.fn(async () => weekData(meals)),
    loadShopping: vi.fn(async () => {
      if (state.mode === 'offline' && state.last) return state.last
      guard()
      const read: ShoppingData = { recipes, marks: [...state.marks], pantry: [...state.pantry], confirmations: [...state.confirmations] }
      state.last = read
      return read
    }),
  }
  return { state, api }
}

const meatRecipes = {
  a: { title: 'كبسة', lines: ['٥٠٠ جرام لحم', 'ملح'] },
  b: { title: 'مندي', lines: ['١ كيلو لحم'] },
}
const recipes = { soup: { title: 'شوربة عدس', lines: ['٢ بصلة', '٣ فصوص ثوم', 'ملح'] } }
const outbox = { enqueue, pending, flush, subscribe }
const show = (api: ShoppingApi, canEdit = true) => render(<ShoppingPage canEdit={canEdit} week={WEEK} today={() => WEEK} api={api} outbox={outbox} />)

beforeEach(async () => {
  useStore(memoryStore())
  await setCacheOwner(null)
  await setCacheOwner('u1')
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the shopping list screen', () => {
  it('lists the week\'s ingredients by aisle with the lines they came from', async () => {
    const { api } = server([meal('m1', 'soup', 'شوربة عدس')], recipes)
    show(api)
    const produce = await screen.findByRole('region', { name: 'خضار وفواكه' })
    expect(within(produce).getByRole('checkbox', { name: /بصل/ })).toBeTruthy()
    expect(within(produce).getByRole('checkbox', { name: /ثوم/ })).toBeTruthy()
    expect(screen.getByText('٢ بصلة')).toBeTruthy() // the line as written, in the details
    expect(screen.getAllByText(/شوربة عدس/).length).toBeGreaterThan(0)
  })

  it('says so when the week has no meals, and names recipes with no ingredients', async () => {
    const empty = server([], {})
    show(empty.api)
    expect(await screen.findByText(/لا وجبات مخططة في هذا الأسبوع/)).toBeTruthy()
    cleanup()
    const noLines = server([meal('m1', 'x', 'وصفة بلا مقادير')], { x: { title: 'وصفة بلا مقادير', lines: [] } })
    show(noLines.api)
    expect(await screen.findByText(/لا مقادير مسجّلة لهذه الوصفات/)).toBeTruthy()
  })

  it('ticking an item as bought moves it to "bought or at home" and is saved', async () => {
    const { state, api } = server([meal('m1', 'soup', 'شوربة عدس')], recipes)
    show(api)
    fireEvent.click(await screen.findByRole('checkbox', { name: /بصل/ }))
    expect(await screen.findByText('تم شراؤه أو متوفر (1)')).toBeTruthy()
    await waitFor(() => expect(state.marks).toEqual([{ key: 'بصل', label: null, status: 'bought', is_manual: false }]))
    expect(await pending()).toEqual([])
    expect(screen.queryByText('لم تُرسل بعد')).toBeNull()
  })

  it('ticking with no connection shows it "not sent yet", keeps it in the outbox, and sends it when the connection returns', async () => {
    const { state, api } = server([meal('m1', 'soup', 'شوربة عدس')], recipes)
    show(api)
    await screen.findByRole('checkbox', { name: /بصل/ })
    state.mode = 'offline'
    fireEvent.click(screen.getByRole('checkbox', { name: /بصل/ }))
    expect(await screen.findByText('تم شراؤه أو متوفر (1)')).toBeTruthy()
    expect(await screen.findByText('لم تُرسل بعد')).toBeTruthy()
    expect((await pending()).map((op) => op.args)).toEqual([{ week: WEEK, key: 'بصل', status: 'bought' }])
    expect(screen.queryByText(/تعذّر/)).toBeNull()

    state.mode = 'online'
    await act(async () => void (await flush()))
    await waitFor(() => expect(screen.queryByText('لم تُرسل بعد')).toBeNull())
    expect(state.marks.find((m) => m.key === 'بصل')?.status).toBe('bought')
    expect(await pending()).toEqual([])
    expect(screen.getByText('تم شراؤه أو متوفر (1)')).toBeTruthy()
  })

  it('the last change to an item wins while offline', async () => {
    const { state, api } = server([meal('m1', 'soup', 'شوربة عدس')], recipes)
    show(api)
    await screen.findByRole('checkbox', { name: /بصل/ })
    state.mode = 'offline'
    fireEvent.click(screen.getByRole('checkbox', { name: /بصل/ })) // bought
    await screen.findByText('تم شراؤه أو متوفر (1)')
    fireEvent.click(screen.getByText('تم شراؤه أو متوفر (1)'))
    fireEvent.click(await screen.findByRole('checkbox', { name: /بصل/ })) // back to "to buy"
    await waitFor(async () => expect((await pending()).map((op) => op.args.status)).toEqual(['needed']))
    state.mode = 'online'
    await act(async () => void (await flush()))
    expect(state.marks.find((m) => m.key === 'بصل')?.status).toBe('needed')
  })

  it('"always at home" marks the item for this week and for every week', async () => {
    const { state, api } = server([meal('m1', 'soup', 'شوربة عدس')], recipes)
    show(api)
    const row = (await screen.findByRole('checkbox', { name: /^ملح/ })).closest('li') as HTMLElement
    fireEvent.click(within(row).getByText('دائمًا عندي (كل الأسابيع)'))
    await waitFor(() => expect(state.pantry.map((p) => p.key)).toEqual(['ملح']))
    expect(state.marks.find((m) => m.key === 'ملح')?.status).toBe('have')
    expect(await screen.findByText('دائمًا في البيت (1)')).toBeTruthy()
  })

  it('adds an item by hand (with no connection too) and removes it', async () => {
    const { state, api } = server([], {})
    show(api)
    const input = await screen.findByLabelText('صنف تضيفينه بيدك')
    state.mode = 'offline'
    fireEvent.change(input, { target: { value: 'حفاضات' } })
    fireEvent.click(screen.getByRole('button', { name: 'أضيفي' }))
    expect(await screen.findByRole('checkbox', { name: /حفاضات/ })).toBeTruthy()
    expect(await screen.findByText('لم تُرسل بعد')).toBeTruthy()
    state.mode = 'online'
    await act(async () => void (await flush()))
    await waitFor(() => expect(state.marks.map((m) => m.key)).toEqual(['حفاضات']))
    expect(state.marks[0]).toMatchObject({ is_manual: true, label: 'حفاضات' })

    fireEvent.click(await screen.findByText('احذفيه'))
    await waitFor(() => expect(state.marks).toEqual([]))
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: /حفاضات/ })).toBeNull())
  })

  it('a reader sees the list but cannot tick, add or change anything', async () => {
    const { api } = server([meal('m1', 'soup', 'شوربة عدس')], recipes)
    show(api, false)
    const box = (await screen.findByRole('checkbox', { name: /بصل/ })) as HTMLInputElement
    expect(box.disabled).toBe(true)
    expect(screen.queryByLabelText('صنف تضيفينه بيدك')).toBeNull()
    expect(screen.queryByText('عندي في البيت')).toBeNull()
  })

  it('a change the server refuses is taken out of the waiting list and reported, not shown as saved', async () => {
    const { state, api } = server([meal('m1', 'soup', 'شوربة عدس')], recipes)
    show(api)
    await screen.findByRole('checkbox', { name: /بصل/ })
    state.mode = 'refuse'
    fireEvent.click(screen.getByRole('checkbox', { name: /بصل/ }))
    await waitFor(async () => expect((await failures()).length).toBe(1))
    expect(await pending()).toEqual([])
    await waitFor(() => expect(screen.queryByText('تم شراؤه أو متوفر (1)')).toBeNull())
  })

  describe('confirming quantities', () => {
    const twoMeals = [meal('m1', 'a', 'كبسة'), meal('m2', 'b', 'مندي')]
    const openMeat = async () => {
      const row = (await screen.findByRole('checkbox', { name: /لحم/ })).closest('li') as HTMLElement
      return row
    }

    it('shows what was read as a suggestion that is not added, and adds a quantity only after it is confirmed', async () => {
      const { state, api } = server(twoMeals, meatRecipes)
      show(api)
      const row = await openMeat()
      expect(within(row).queryByText(/المجموع المؤكَّد/)).toBeNull()
      expect(within(row).getByText(/قُرئت: 500 جرام/)).toBeTruthy()

      fireEvent.click(within(row).getAllByRole('button', { name: 'أكّدي', hidden: true })[0])
      await waitFor(() => expect(state.confirmations).toEqual([{ recipe_id: 'a', line: '٥٠٠ جرام لحم', item_key: 'لحم', quantity: 500, unit: 'g' }]))
      expect(await within(row).findByText('500 جرام')).toBeTruthy()
      expect(within(row).getByText(/غير محسوبة: سطر واحد/)).toBeTruthy() // the kilo of the other recipe is not confirmed
    })

    it('adds 500 g and 1 kg to 1.5 kg once both are confirmed, with one tap for all that were read', async () => {
      const { api } = server(twoMeals, meatRecipes)
      show(api)
      const row = await openMeat()
      fireEvent.click(within(row).getByRole('button', { name: 'أكّدي كل الكميات المقروءة', hidden: true }))
      expect(await within(row).findByText('1.5 كيلو')).toBeTruthy()
      expect(within(row).queryByText(/غير محسوبة/)).toBeNull()
    })

    it('lets her correct a quantity (digits in Arabic, another unit) and take a confirmation back', async () => {
      const { state, api } = server(twoMeals, meatRecipes)
      show(api)
      const row = await openMeat()
      fireEvent.click(within(row).getAllByRole('button', { name: 'عدّلي', hidden: true })[0])
      fireEvent.change(within(row).getByLabelText('الكمية'), { target: { value: '٢' } })
      fireEvent.change(within(row).getByLabelText('الوحدة'), { target: { value: 'kg' } })
      fireEvent.click(within(row).getByRole('button', { name: 'احفظي وأكّدي' }))
      await waitFor(() => expect(state.confirmations[0]).toMatchObject({ quantity: 2, unit: 'kg' }))
      expect(await within(row).findByText('2 كيلو')).toBeTruthy()
      fireEvent.click(within(row).getByRole('button', { name: 'تراجعي', hidden: true }))
      await waitFor(() => expect(state.confirmations).toEqual([]))
      await waitFor(() => expect(within(row).queryByText(/المجموع المؤكَّد/)).toBeNull())
    })

    it('does not accept a quantity that is not a positive number', async () => {
      const { state, api } = server(twoMeals, meatRecipes)
      show(api)
      const row = await openMeat()
      fireEvent.click(within(row).getAllByRole('button', { name: 'عدّلي', hidden: true })[0])
      fireEvent.change(within(row).getByLabelText('الكمية'), { target: { value: 'كثير' } })
      expect((within(row).getByRole('button', { name: 'احفظي وأكّدي' }) as HTMLButtonElement).disabled).toBe(true)
      expect(state.confirmations).toEqual([])
    })

    it('confirming with no connection shows the total at once as "not sent yet" and sends it later', async () => {
      const { state, api } = server(twoMeals, meatRecipes)
      show(api)
      const row = await openMeat()
      state.mode = 'offline'
      fireEvent.click(within(row).getAllByRole('button', { name: 'أكّدي', hidden: true })[0])
      expect(await within(row).findByText('500 جرام')).toBeTruthy()
      await waitFor(async () => expect((await pending()).length).toBe(1))
      expect(within(row).getAllByText('لم تُرسل بعد').length).toBeGreaterThan(0)
      state.mode = 'online'
      await act(async () => void (await flush()))
      await waitFor(() => expect(state.confirmations.length).toBe(1))
      await waitFor(() => expect(within(row).queryByText('لم تُرسل بعد')).toBeNull())
    })

    it('a reader sees the totals but cannot confirm or change a quantity', async () => {
      const { api } = server(twoMeals, meatRecipes)
      show(api, false)
      const row = await openMeat()
      expect(within(row).queryByRole('button', { name: 'أكّدي', hidden: true })).toBeNull()
      expect(within(row).queryByRole('button', { name: 'عدّلي', hidden: true })).toBeNull()
    })
  })
})
