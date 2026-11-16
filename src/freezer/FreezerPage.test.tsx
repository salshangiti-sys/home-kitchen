import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import FreezerPage, { type FreezerApi } from './FreezerPage'
import type { FreezerItem } from './api'

const meatballs: FreezerItem = { id: 'i1', name: 'كرات لحم', quantity: 12, unit: 'كرة', frozen_on: '2026-11-01', recipe_id: 'f-1', note: 'كيس 500 غ' }
const sauce: FreezerItem = { id: 'i2', name: 'صوص طماطم', quantity: 3, unit: 'علبة', frozen_on: '2026-07-01', recipe_id: null, note: null }

function fake(start: FreezerItem[] = [meatballs, sauce]): FreezerApi & { calls: string[] } {
  let items = start
  const calls: string[] = []
  return {
    calls,
    loadFreezer: async () => items,
    loadFrozenRecipes: async () => [{ id: 'f-1', title: 'كرات لحم', section: 'مفرزنات › كفتة' }],
    saveItem: async (id, input) => {
      calls.push(`save ${id ?? 'new'} ${input.name} ${input.quantity} ${input.unit} ${input.frozenOn} ${input.recipeId ?? '-'} ${input.note ?? '-'}`)
      items = id ? items.map((i) => (i.id === id ? { ...i, name: input.name, quantity: input.quantity } : i)) : [...items, { id: 'new1', name: input.name, quantity: input.quantity, unit: input.unit, frozen_on: input.frozenOn ?? '2026-11-16', recipe_id: input.recipeId, note: input.note }]
      return id ?? 'new1'
    },
    useItem: async (id) => {
      calls.push(`use ${id}`)
      const found = items.find((i) => i.id === id)!
      const left = found.quantity - 1
      items = left > 0 ? items.map((i) => (i.id === id ? { ...i, quantity: left } : i)) : items.filter((i) => i.id !== id)
      return Math.max(left, 0)
    },
    removeItem: async (id) => {
      calls.push(`remove ${id}`)
      items = items.filter((i) => i.id !== id)
    },
  }
}

const today = () => '2026-11-16'
afterEach(cleanup)

describe('the freezer page', () => {
  it('lists what is there with quantity, age and its link to the recipe page', async () => {
    render(<FreezerPage canEdit api={fake()} today={today} />)
    expect(await screen.findByText('في الفريزر (2)')).toBeTruthy()
    expect(screen.getByText('12 كرة')).toBeTruthy()
    expect(screen.getByText('جُمّد قبل أسبوعين')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'كرات لحم' }).getAttribute('href')).toBe('#/r/f-1')
    expect(screen.getByText('قديم')).toBeTruthy() // the sauce is from July
    expect(screen.getByText(/كيس 500 غ/)).toBeTruthy()
  })

  it('takes one off with «استعملت», and removes the item when nothing is left', async () => {
    const api = fake([{ ...sauce, quantity: 2 }])
    render(<FreezerPage canEdit api={api} today={today} />)
    fireEvent.click(await screen.findByRole('button', { name: 'استعملت' }))
    expect(await screen.findByText('بقي من «صوص طماطم» 1 علبة.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'استعملت' }))
    expect(await screen.findByText('انتهى «صوص طماطم» وحُذف من الفريزر.')).toBeTruthy()
    expect(await screen.findByText('الفريزر فارغ في التطبيق.')).toBeTruthy()
    expect(api.calls).toEqual(['use i2', 'use i2'])
  })

  it('adds an item, with the unit, the day and a link to a recipe page', async () => {
    const api = fake([])
    render(<FreezerPage canEdit api={api} today={today} />)
    fireEvent.click(await screen.findByRole('button', { name: '+ صنف جديد' }))
    fireEvent.change(screen.getByLabelText('الصنف'), { target: { value: 'معجنات جبنة' } })
    fireEvent.change(screen.getByLabelText('الكمية'), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText('صفحة المفرزنات (اختياري)'), { target: { value: 'f-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'أضيفي إلى الفريزر' }))
    expect(await screen.findByText('أُضيف «معجنات جبنة» إلى الفريزر.')).toBeTruthy()
    expect(api.calls).toEqual(['save new معجنات جبنة 20 قطعة 2026-11-16 f-1 -'])
    expect(await screen.findByText('20 قطعة')).toBeTruthy()
  })

  it('does not accept an empty name or a zero quantity', async () => {
    const api = fake([])
    render(<FreezerPage canEdit api={api} today={today} />)
    fireEvent.click(await screen.findByRole('button', { name: '+ صنف جديد' }))
    const add = screen.getByRole('button', { name: 'أضيفي إلى الفريزر' }) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('الصنف'), { target: { value: 'س' } })
    fireEvent.change(screen.getByLabelText('الكمية'), { target: { value: '0' } })
    expect(add.disabled).toBe(true)
  })

  it('removes an item only after she confirms', async () => {
    const api = fake()
    render(<FreezerPage canEdit api={api} today={today} />)
    await screen.findByText('في الفريزر (2)')
    fireEvent.click(screen.getAllByRole('button', { name: 'حذف' })[0])
    expect(api.calls).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'نعم، احذفيه' }))
    await waitFor(() => expect(api.calls).toEqual(['remove i1']))
    expect(await screen.findByText('في الفريزر (1)')).toBeTruthy()
  })

  it('changes an item\'s details', async () => {
    const api = fake()
    render(<FreezerPage canEdit api={api} today={today} />)
    await screen.findByText('في الفريزر (2)')
    fireEvent.click(screen.getAllByRole('button', { name: 'تعديل' })[0])
    expect(screen.getByText('تعديل «كرات لحم»')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('الكمية'), { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: 'احفظي التعديل' }))
    expect(await screen.findByText('حُفظ تعديل «كرات لحم».')).toBeTruthy()
    expect(api.calls[0]).toBe('save i1 كرات لحم 8 كرة 2026-11-01 f-1 كيس 500 غ')
  })

  it('shows a reader the list with no buttons to change it', async () => {
    render(<FreezerPage canEdit={false} api={fake()} today={today} />)
    expect(await screen.findByText('في الفريزر (2)')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'استعملت' })).toBeNull()
    expect(screen.queryByRole('button', { name: '+ صنف جديد' })).toBeNull()
    within(document.body).getByText('صوص طماطم')
  })

  it('shows an error when a change fails', async () => {
    const api = fake()
    api.useItem = async () => {
      throw new Error('item_not_found')
    }
    render(<FreezerPage canEdit api={api} today={today} />)
    fireEvent.click((await screen.findAllByRole('button', { name: 'استعملت' }))[0])
    expect(await screen.findByText('هذا الصنف لم يعد في الفريزر. حدّثي الصفحة.')).toBeTruthy()
  })
})
