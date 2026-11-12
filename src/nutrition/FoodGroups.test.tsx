import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toggleGroup, type FoodGroup } from './api'
import FoodGroups from './FoodGroups'

function fakeApi(initial: FoodGroup[]) {
  let groups = [...initial]
  return {
    listFoodGroups: vi.fn(async () => [...groups]),
    setFoodGroups: vi.fn(async (_id: string, next: FoodGroup[]) => void (groups = next)),
  }
}

const show = (api: ReturnType<typeof fakeApi>, canEdit: boolean) => render(<FoodGroups recipeId="salads-007" canEdit={canEdit} api={api as never} />)

afterEach(cleanup)

describe('toggleGroup', () => {
  it('adds and removes a group, always in the same order', () => {
    expect(toggleGroup([], 'protein')).toEqual(['protein'])
    expect(toggleGroup(['protein'], 'vegetables')).toEqual(['vegetables', 'protein'])
    expect(toggleGroup(['vegetables', 'protein'], 'vegetables')).toEqual(['protein'])
  })
})

describe('reading', () => {
  it('shows the chosen groups to someone who cannot edit', async () => {
    show(fakeApi(['vegetables', 'dairy']), false)
    expect(await screen.findByText('خضار')).toBeTruthy()
    expect(screen.getByText('ألبان')).toBeTruthy()
    expect(screen.queryByText('بروتين')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows nothing at all to a reader when nothing was chosen', async () => {
    const api = fakeApi([])
    show(api, false)
    await waitFor(() => expect(api.listFoodGroups).toHaveBeenCalled())
    expect(screen.queryByText('العناصر الغذائية')).toBeNull()
  })
})

describe('choosing', () => {
  it('shows every group as a chip with the chosen ones pressed, and says it is the person\'s own estimate', async () => {
    show(fakeApi(['protein']), true)
    expect((await screen.findByRole('button', { name: 'بروتين' })).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'خضار' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getAllByRole('button')).toHaveLength(5)
    expect(screen.getByText(/وليس تقييمًا غذائيًا أو طبيًا/)).toBeTruthy()
  })

  it('saves at once on every tap', async () => {
    const api = fakeApi([])
    show(api, true)
    fireEvent.click(await screen.findByRole('button', { name: 'نشويات' }))
    await waitFor(() => expect(api.setFoodGroups).toHaveBeenCalledWith('salads-007', ['carbs']))
    fireEvent.click(screen.getByRole('button', { name: 'خضار' }))
    await waitFor(() => expect(api.setFoodGroups).toHaveBeenLastCalledWith('salads-007', ['vegetables', 'carbs']))
    expect(screen.getByRole('button', { name: 'خضار' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'نشويات' }))
    await waitFor(() => expect(api.setFoodGroups).toHaveBeenLastCalledWith('salads-007', ['vegetables']))
  })

  it('keeps the old choice and says why when saving fails', async () => {
    const api = fakeApi(['fruit'])
    api.setFoodGroups.mockRejectedValueOnce(new Error('recipe not found or not allowed'))
    show(api, true)
    fireEvent.click(await screen.findByRole('button', { name: 'ألبان' }))
    expect(await screen.findByText('لا تملكين صلاحية تعديل هذه الوصفة.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'ألبان' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'فواكه' }).getAttribute('aria-pressed')).toBe('true')
  })
})
