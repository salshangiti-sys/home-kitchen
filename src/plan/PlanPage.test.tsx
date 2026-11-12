import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecipeSummary } from '../library/api'
import { normalizeAr } from '../library/normalize'
import type { FoodGroup } from '../nutrition/api'
import PlanPage, { type PlanApi } from './PlanPage'
import { addDays, weekDays, weekStartOf } from './dates'
import type { Override, Person, PlannedMeal, Slot, WeekData } from './api'

const TODAY = '2026-11-14' // a Saturday: the week starts today

const slot = (id: string, name: string, position: number): Slot => ({ id, name, position })
const person = (id: string, name: string, kind: 'adult' | 'child' = 'adult'): Person => ({ id, name, kind, allergies: [], notes: null, position: 1 })
const recipe = (id: string, title: string, section: string): RecipeSummary => ({
  id,
  title,
  section,
  status: 'complete',
  search_norm: normalizeAr(title), // the database keeps the title normalised for searching
  meal_types: [],
  kid_friendly: null,
  lunchbox: null,
  updated_at: '2026-11-12T00:00:00Z',
})

interface State {
  startDow: number
  slots: Slot[]
  people: Person[]
  meals: PlannedMeal[]
  overrides: Override[]
  recipeGroups: Record<string, FoodGroup[]>
}

function fake(initial: Partial<State> = {}) {
  const state: State = { startDow: 6, slots: [slot('lunch', 'غداء', 2), slot('dinner', 'عشاء', 3)], people: [person('p1', 'سارة'), person('p2', 'أحمد', 'child')], meals: [], overrides: [], recipeGroups: {}, ...initial }
  let counter = 0
  const api = {
    loadWeek: vi.fn(async (anyDay: string): Promise<WeekData> => {
      const weekStart = weekStartOf(anyDay, state.startDow)
      const days = weekDays(weekStart)
      return {
        weekStart,
        startDow: state.startDow,
        slots: [...state.slots],
        people: [...state.people],
        meals: state.meals.filter((m) => days.includes(m.day)),
        overrides: state.overrides.filter((o) => days.includes(o.day)),
        recipeGroups: state.recipeGroups,
      }
    }),
    planDefaults: vi.fn(async () => {
      if (!state.slots.length) state.slots = [slot('lunch', 'غداء', 2), slot('dinner', 'عشاء', 3)]
    }),
    addMeal: vi.fn(async (m: { day: string; slot: string; recipeId: string | null; freeText: string | null; servings: number | null; people: string[] }) => {
      state.meals.push({ id: `m${++counter}`, day: m.day, slot_id: m.slot, recipe_id: m.recipeId, title: m.freeText ?? 'سلطة خضراء', free_text: m.freeText, servings: m.servings, people: m.people, position: counter, status: 'planned' })
    }),
    updateMeal: vi.fn(async (id: string, servings: number | null, people: string[], status: PlannedMeal['status']) => {
      state.meals = state.meals.map((m) => (m.id === id ? { ...m, servings, people, status } : m))
    }),
    moveMeal: vi.fn(async (id: string, day: string, slotId: string) => {
      state.meals = state.meals.map((m) => (m.id === id ? { ...m, day, slot_id: slotId } : m))
    }),
    removeMeal: vi.fn(async (id: string) => void (state.meals = state.meals.filter((m) => m.id !== id))),
    copyWeek: vi.fn(async () => ({ copied: 3, skipped: 1 })),
    setSlotGroups: vi.fn(async (day: string, slotId: string, add: FoodGroup[], remove: FoodGroup[]) => {
      state.overrides = [
        ...state.overrides.filter((o) => !(o.day === day && o.slot_id === slotId)),
        ...add.map((g) => ({ day, slot_id: slotId, food_group: g, mode: 'add' as const })),
        ...remove.map((g) => ({ day, slot_id: slotId, food_group: g, mode: 'remove' as const })),
      ]
    }),
    setWeekStart: vi.fn(async (dow: number) => void (state.startDow = dow)),
    saveSlot: vi.fn(async (id: string | null, name: string, position: number | null) => {
      if (id) state.slots = state.slots.map((s) => (s.id === id ? { ...s, name, position: position ?? s.position } : s))
      else state.slots.push(slot(`s${++counter}`, name, 9))
      state.slots.sort((a, b) => a.position - b.position)
    }),
    removeSlot: vi.fn(async (id: string) => void (state.slots = state.slots.filter((s) => s.id !== id))),
    savePerson: vi.fn(async (id: string | null, name: string, kind: 'adult' | 'child') => {
      if (id) state.people = state.people.map((p) => (p.id === id ? { ...p, name, kind } : p))
      else state.people.push(person(`q${++counter}`, name, kind))
    }),
    removePerson: vi.fn(async (id: string) => void (state.people = state.people.filter((p) => p.id !== id))),
    loadRecipes: vi.fn(async () => [recipe('salads-001', 'سلطة خضراء', 'سلطات'), recipe('soups-001', 'شوربة عدس', 'شوربات')]),
  }
  return { state, api }
}

const meal = (id: string, day: string, slotId: string, title: string, extra: Partial<PlannedMeal> = {}): PlannedMeal => ({
  id,
  day,
  slot_id: slotId,
  recipe_id: null,
  title,
  free_text: title,
  servings: null,
  people: [],
  position: 1,
  status: 'planned',
  ...extra,
})

const show = (api: ReturnType<typeof fake>['api'], canEdit: boolean, week?: string) =>
  render(<PlanPage canEdit={canEdit} week={week} today={() => TODAY} api={api as unknown as PlanApi} />)

const day = (name: string) => screen.getByRole('region', { name: new RegExp(name) })

beforeEach(() => {
  window.location.hash = '#/plan'
})
afterEach(cleanup)

describe('reading the plan', () => {
  it('shows the seven days of the week with today marked, and each meal in its slot', async () => {
    const { api } = fake({ meals: [meal('a', TODAY, 'lunch', 'أرز أبيض', { servings: 4, people: ['p1'] }), meal('b', addDays(TODAY, 2), 'dinner', 'شوربة', { recipe_id: 'soups-001', title: 'شوربة عدس' })] })
    show(api, false)
    expect(await screen.findByText('الخطة الأسبوعية')).toBeTruthy()
    expect(screen.getAllByRole('region')).toHaveLength(7)
    expect(within(day('السبت')).getByText('اليوم')).toBeTruthy()
    expect(within(day('السبت')).getByText('أرز أبيض')).toBeTruthy()
    expect(within(day('السبت')).getByText('4 حصص')).toBeTruthy()
    expect(within(day('السبت')).getByText('سارة')).toBeTruthy()
    const link = within(day('الاثنين')).getByRole('link', { name: 'شوربة عدس' })
    expect(link.getAttribute('href')).toBe('#/r/soups-001')
  })

  it('gives a reader no buttons, and hides slots that are empty', async () => {
    const { api } = fake({ meals: [meal('a', TODAY, 'lunch', 'أرز أبيض')] })
    show(api, false)
    await screen.findByText('أرز أبيض')
    expect(screen.queryByRole('button', { name: /أضيفي/ })).toBeNull()
    expect(screen.queryByText('إعدادات الخطة')).toBeNull()
    expect(within(day('السبت')).queryByText('عشاء')).toBeNull()
    expect(api.planDefaults).not.toHaveBeenCalled()
  })

  it('says so when nothing is planned', async () => {
    const { api } = fake()
    show(api, false)
    expect(await screen.findByText('لم تُخطَّط وجبات لهذا الأسبوع بعد.')).toBeTruthy()
  })

  it('goes to the next and the previous week, and back to this week', async () => {
    const { api } = fake()
    show(api, false)
    fireEvent.click(await screen.findByRole('button', { name: 'الأسبوع التالي ←' }))
    expect(window.location.hash).toBe('#/plan/2026-11-21')
    fireEvent.click(screen.getByRole('button', { name: '→ الأسبوع السابق' }))
    expect(window.location.hash).toBe('#/plan/2026-11-07')
  })

  it('shows the week that holds a given date, and offers the way back to this week', async () => {
    const { api } = fake()
    show(api, false, '2026-11-25')
    await screen.findByText('الخطة الأسبوعية')
    expect(api.loadWeek).toHaveBeenCalledWith('2026-11-25')
    expect(within(screen.getAllByRole('region')[0]).getByText(/السبت/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'إلى هذا الأسبوع' }))
    expect(window.location.hash).toBe('#/plan')
  })
})

describe('planning meals', () => {
  it('prepares the default slots the first time an editor opens it', async () => {
    const { api } = fake({ slots: [] })
    show(api, true)
    expect(await screen.findAllByRole('button', { name: /^\+ أضيفي إلى غداء$/ })).toHaveLength(7)
    expect(api.planDefaults).toHaveBeenCalledTimes(1)
  })

  it('adds a recipe found by search, with servings and people', async () => {
    const { api } = fake()
    show(api, true)
    fireEvent.click((await screen.findAllByRole('button', { name: '+ أضيفي إلى غداء' }))[0])
    fireEvent.change(screen.getByLabelText('بحث عن وصفة'), { target: { value: 'سلطه' } })
    fireEvent.click(await screen.findByRole('button', { name: /سلطة خضراء/ }))
    fireEvent.change(screen.getByLabelText(/عدد الحصص/), { target: { value: '3' } })
    fireEvent.click(screen.getByLabelText('أحمد'))
    fireEvent.click(screen.getByRole('button', { name: 'أضيفي إلى الخطة' }))
    await waitFor(() => expect(api.addMeal).toHaveBeenCalledWith({ day: TODAY, slot: 'lunch', recipeId: 'salads-001', freeText: null, servings: 3, people: ['p2'] }))
    expect(await within(day('السبت')).findByText('3 حصص')).toBeTruthy()
  })

  it('adds free text', async () => {
    const { api } = fake()
    show(api, true)
    fireEvent.click((await screen.findAllByRole('button', { name: '+ أضيفي إلى عشاء' }))[0])
    fireEvent.click(screen.getByRole('tab', { name: 'نص حر' }))
    expect((screen.getByRole('button', { name: 'أضيفي إلى الخطة' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('الوجبة'), { target: { value: 'بيتزا' } })
    fireEvent.click(screen.getByRole('button', { name: 'أضيفي إلى الخطة' }))
    await waitFor(() => expect(api.addMeal).toHaveBeenCalledWith({ day: TODAY, slot: 'dinner', recipeId: null, freeText: 'بيتزا', servings: null, people: [] }))
    expect(await within(day('السبت')).findByText('بيتزا')).toBeTruthy()
  })

  it('says when the library has no recipes yet', async () => {
    const { api } = fake()
    api.loadRecipes.mockResolvedValue([])
    show(api, true)
    fireEvent.click((await screen.findAllByRole('button', { name: '+ أضيفي إلى غداء' }))[0])
    expect(await screen.findByText(/لا وصفات في المكتبة بعد/)).toBeTruthy()
  })

  it('changes servings, people and status of a meal', async () => {
    const { api } = fake({ meals: [meal('a', TODAY, 'lunch', 'أرز أبيض')] })
    show(api, true)
    fireEvent.click(await screen.findByRole('button', { name: 'تعديل' }))
    fireEvent.change(screen.getByLabelText(/عدد الحصص/), { target: { value: '6' } })
    fireEvent.click(screen.getByLabelText('سارة'))
    fireEvent.change(screen.getByLabelText('الحالة'), { target: { value: 'cooked' } })
    fireEvent.click(screen.getByRole('button', { name: 'احفظي' }))
    await waitFor(() => expect(api.updateMeal).toHaveBeenCalledWith('a', 6, ['p1'], 'cooked'))
    expect(await within(day('السبت')).findByText('تم طبخها')).toBeTruthy()
  })

  it('moves a meal to another day and slot', async () => {
    const { api } = fake({ meals: [meal('a', TODAY, 'lunch', 'أرز أبيض')] })
    show(api, true)
    fireEvent.click(await screen.findByRole('button', { name: 'نقل' }))
    fireEvent.change(screen.getByLabelText('إلى يوم'), { target: { value: addDays(TODAY, 3) } })
    fireEvent.change(screen.getByLabelText('وإلى خانة'), { target: { value: 'dinner' } })
    fireEvent.click(screen.getByRole('button', { name: 'انقلي' }))
    await waitFor(() => expect(api.moveMeal).toHaveBeenCalledWith('a', addDays(TODAY, 3), 'dinner'))
    expect(within(day('السبت')).queryByText('أرز أبيض')).toBeNull()
    expect(await within(day('الثلاثاء')).findByText('أرز أبيض')).toBeTruthy()
  })

  it('asks before removing a meal, and removing can be cancelled', async () => {
    const { api } = fake({ meals: [meal('a', TODAY, 'lunch', 'أرز أبيض')] })
    show(api, true)
    fireEvent.click(await screen.findByRole('button', { name: 'حذف' }))
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء' }))
    expect(api.removeMeal).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'حذف' }))
    fireEvent.click(screen.getByRole('button', { name: 'نعم، احذفيها' }))
    await waitFor(() => expect(api.removeMeal).toHaveBeenCalledWith('a'))
    await waitFor(() => expect(screen.queryByText('أرز أبيض')).toBeNull())
  })

  it('shows the database refusal in Arabic', async () => {
    const { api } = fake({ meals: [meal('a', TODAY, 'lunch', 'أرز أبيض')] })
    api.removeMeal.mockRejectedValueOnce(new Error('not allowed to change the plan'))
    show(api, true)
    fireEvent.click(await screen.findByRole('button', { name: 'حذف' }))
    fireEvent.click(screen.getByRole('button', { name: 'نعم، احذفيها' }))
    expect(await screen.findByText('لا تملكين صلاحية تعديل الخطة.')).toBeTruthy()
  })
})

describe('food groups of a meal', () => {
  const planned = meal('a', TODAY, 'lunch', 'سلطة خضراء', { recipe_id: 'salads-001' })

  it('shows the groups of the recipes to a reader as plain text', async () => {
    const { api } = fake({ meals: [planned], recipeGroups: { 'salads-001': ['vegetables', 'dairy'] } })
    show(api, false)
    expect(await screen.findByText('العناصر الغذائية: خضار، ألبان')).toBeTruthy()
  })

  it('lets an editor take one out and put another in, saved as changes on top of the recipes', async () => {
    const { api } = fake({ meals: [planned], recipeGroups: { 'salads-001': ['vegetables', 'dairy'] } })
    show(api, true)
    const group = await screen.findByRole('group', { name: 'العناصر الغذائية: السبت غداء' })
    expect(within(group).getByRole('button', { name: 'خضار' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(group).getByRole('button', { name: 'ألبان' }))
    await waitFor(() => expect(api.setSlotGroups).toHaveBeenLastCalledWith(TODAY, 'lunch', [], ['dairy']))
    fireEvent.click(await within(await screen.findByRole('group', { name: 'العناصر الغذائية: السبت غداء' })).findByRole('button', { name: 'فواكه' }))
    await waitFor(() => expect(api.setSlotGroups).toHaveBeenLastCalledWith(TODAY, 'lunch', ['fruit'], ['dairy']))
  })

  it('clears the changes when the person puts back what the recipes have', async () => {
    const { api } = fake({ meals: [planned], recipeGroups: { 'salads-001': ['vegetables'] }, overrides: [{ day: TODAY, slot_id: 'lunch', food_group: 'vegetables', mode: 'remove' }] })
    show(api, true)
    const group = await screen.findByRole('group', { name: 'العناصر الغذائية: السبت غداء' })
    expect(within(group).getByRole('button', { name: 'خضار' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(within(group).getByRole('button', { name: 'خضار' }))
    await waitFor(() => expect(api.setSlotGroups).toHaveBeenLastCalledWith(TODAY, 'lunch', [], []))
  })
})

describe('copying the week before', () => {
  it('offers it for an empty week and says what was copied and skipped', async () => {
    const { api } = fake()
    show(api, true)
    fireEvent.click(await screen.findByRole('button', { name: 'انسخي الأسبوع السابق' }))
    await waitFor(() => expect(api.copyWeek).toHaveBeenCalledWith('2026-11-07', '2026-11-14'))
    expect(await screen.findByText(/نُسخت 3 وجبات من الأسبوع السابق، وتُخطّيت 1 لأن وصفتها في سلة المحذوفات/)).toBeTruthy()
  })

  it('does not offer it when the week already has meals, or to a reader', async () => {
    const { api } = fake({ meals: [meal('a', TODAY, 'lunch', 'أرز')] })
    show(api, true)
    await screen.findByText('أرز')
    expect(screen.queryByRole('button', { name: 'انسخي الأسبوع السابق' })).toBeNull()
    cleanup()
    show(fake().api, false)
    await screen.findByText('لم تُخطَّط وجبات لهذا الأسبوع بعد.')
    expect(screen.queryByRole('button', { name: 'انسخي الأسبوع السابق' })).toBeNull()
  })

  it('shows why when the copy is refused', async () => {
    const { api } = fake()
    api.copyWeek.mockRejectedValueOnce(new Error('nothing_to_copy: that week has no meals'))
    show(api, true)
    fireEvent.click(await screen.findByRole('button', { name: 'انسخي الأسبوع السابق' }))
    expect(await screen.findByText('الأسبوع السابق لا وجبات فيه.')).toBeTruthy()
  })
})

describe('plan settings', () => {
  it('changes the day the week starts', async () => {
    const { api } = fake()
    show(api, true)
    fireEvent.change(await screen.findByLabelText('يبدأ الأسبوع يوم'), { target: { value: '0' } })
    await waitFor(() => expect(api.setWeekStart).toHaveBeenCalledWith(0))
    await waitFor(() => expect(screen.getAllByRole('region')[0].getAttribute('aria-label')).toMatch(/الأحد/))
  })

  it('adds, renames and removes a slot', async () => {
    const { api } = fake()
    show(api, true)
    const settings = await screen.findByRole('region', { name: 'خانات الوجبات' })
    fireEvent.change(within(settings).getByLabelText('اسم خانة جديدة'), { target: { value: 'تحلية' } })
    fireEvent.click(within(settings).getByRole('button', { name: 'أضيفي خانة' }))
    await waitFor(() => expect(api.saveSlot).toHaveBeenCalledWith(null, 'تحلية', null))
    expect(await within(await screen.findByRole('region', { name: 'خانات الوجبات' })).findByLabelText('اسم الخانة تحلية')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('اسم الخانة غداء'), { target: { value: 'الغداء' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'احفظي الاسم' })[0])
    await waitFor(() => expect(api.saveSlot).toHaveBeenCalledWith('lunch', 'الغداء', 2))

    fireEvent.click(screen.getByRole('button', { name: 'حذف عشاء' }))
    fireEvent.click(screen.getByRole('button', { name: 'نعم، احذفيها' }))
    await waitFor(() => expect(api.removeSlot).toHaveBeenCalledWith('dinner'))
  })

  it('reorders slots by swapping positions', async () => {
    const { api } = fake()
    show(api, true)
    fireEvent.click(await screen.findByRole('button', { name: '↓ غداء' }))
    await waitFor(() => expect(api.saveSlot).toHaveBeenCalledWith('lunch', 'غداء', 3))
    expect(api.saveSlot).toHaveBeenCalledWith('dinner', 'عشاء', 2)
  })

  it('shows why a slot with meals cannot be removed', async () => {
    const { api } = fake()
    api.removeSlot.mockRejectedValueOnce(new Error('slot_in_use: this slot has planned meals'))
    show(api, true)
    fireEvent.click(await screen.findByRole('button', { name: 'حذف غداء' }))
    fireEvent.click(screen.getByRole('button', { name: 'نعم، احذفيها' }))
    expect(await screen.findByText(/في هذه الخانة وجبات مخطَّطة/)).toBeTruthy()
  })

  it('adds, changes and removes a person', async () => {
    const { api } = fake()
    show(api, true)
    const people = await screen.findByRole('region', { name: 'أفراد الأسرة' })
    fireEvent.change(within(people).getByLabelText('الاسم (جديد)'), { target: { value: 'ليلى' } })
    fireEvent.change(within(people).getByLabelText('النوع (جديد)'), { target: { value: 'child' } })
    fireEvent.change(within(people).getByLabelText('الحساسية (جديد)'), { target: { value: 'فول سوداني، حليب' } })
    fireEvent.click(within(people).getByRole('button', { name: 'أضيفي شخصًا' }))
    await waitFor(() => expect(api.savePerson).toHaveBeenCalledWith(null, 'ليلى', 'child', ['فول سوداني', 'حليب'], ''))
    expect(await within(await screen.findByRole('region', { name: 'أفراد الأسرة' })).findByLabelText('الاسم (ليلى)')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'حذف سارة' }))
    fireEvent.click(screen.getByRole('button', { name: 'نعم، احذفيه' }))
    await waitFor(() => expect(api.removePerson).toHaveBeenCalledWith('p1'))
  })
})
