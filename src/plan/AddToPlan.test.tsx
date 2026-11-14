import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AddToPlan, { type AddToPlanApi } from './AddToPlan'
import type { WeekData } from './api'

afterEach(cleanup)

const week = (slots = [{ id: 'lunch', name: 'غداء', position: 1 }, { id: 'dinner', name: 'عشاء', position: 2 }]): WeekData => ({ weekStart: '2026-11-14', startDow: 6, slots, people: [], meals: [], overrides: [], recipeGroups: {} })

function api(options: { slots?: Parameters<typeof week>[0]; fail?: string } = {}) {
  return {
    loadWeek: vi.fn(async () => week(options.slots)),
    addMeal: vi.fn(async () => {
      if (options.fail) throw new Error(options.fail)
    }),
    generateTasks: vi.fn(async () => ({ added: 0, updated: 0, removed: 0 })),
  } satisfies AddToPlanApi
}

const open = async () => {
  fireEvent.click(screen.getByRole('button', { name: '+ أضيفي إلى الخطة' }))
  await screen.findByRole('option', { name: 'غداء' })
}

describe('adding a recipe to the plan from its page', () => {
  it('adds it to the chosen day and slot with the servings, then tells her where, with a link to the plan', async () => {
    const a = api()
    render(<AddToPlan recipeId="rice-1" today={() => '2026-11-15'} api={a} />)
    await open()
    fireEvent.change(screen.getByLabelText('اليوم'), { target: { value: '2026-11-17' } })
    fireEvent.change(screen.getByLabelText('الوجبة'), { target: { value: 'dinner' } })
    fireEvent.change(screen.getByLabelText('عدد الحصص (اختياري)'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'أضيفي' }))
    await waitFor(() => expect(a.addMeal).toHaveBeenCalledWith({ day: '2026-11-17', slot: 'dinner', recipeId: 'rice-1', freeText: null, servings: 4, people: [] }))
    expect(a.generateTasks).toHaveBeenCalledWith('2026-11-17')
    expect(await screen.findByText(/أُضيفت إلى الخطة/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'افتحي الخطة' }).getAttribute('href')).toBe('#/plan/2026-11-14')
  })

  it('starts on today and the first slot, and the servings may be left empty', async () => {
    const a = api()
    render(<AddToPlan recipeId="rice-1" today={() => '2026-11-15'} api={a} />)
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'أضيفي' }))
    await waitFor(() => expect(a.addMeal).toHaveBeenCalledWith({ day: '2026-11-15', slot: 'lunch', recipeId: 'rice-1', freeText: null, servings: null, people: [] }))
  })

  it('refuses servings that are not a whole number from 1 to 100', async () => {
    const a = api()
    render(<AddToPlan recipeId="rice-1" api={a} />)
    await open()
    for (const bad of ['0', '2.5', 'كثير', '101']) {
      fireEvent.change(screen.getByLabelText('عدد الحصص (اختياري)'), { target: { value: bad } })
      expect((screen.getByRole('button', { name: 'أضيفي' }) as HTMLButtonElement).disabled).toBe(true)
    }
    expect(a.addMeal).not.toHaveBeenCalled()
  })

  it('shows the reason when the plan refuses, and does not say it was added', async () => {
    const a = api({ fail: 'not allowed' })
    render(<AddToPlan recipeId="rice-1" api={a} />)
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'أضيفي' }))
    expect(await screen.findByText('لا تملكين صلاحية تعديل الخطة.')).toBeTruthy()
    expect(screen.queryByText(/أُضيفت إلى الخطة/)).toBeNull()
  })

  it('says to make meal slots first when there are none', async () => {
    render(<AddToPlan recipeId="rice-1" api={api({ slots: [] })} />)
    fireEvent.click(screen.getByRole('button', { name: '+ أضيفي إلى الخطة' }))
    expect(await screen.findByText(/لا خانات وجبات بعد/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'أضيفي' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
