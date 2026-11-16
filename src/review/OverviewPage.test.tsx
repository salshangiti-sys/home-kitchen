import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import OverviewPage from './OverviewPage'
import type { OverviewData } from './overview'

const data: OverviewData = {
  recipes: [
    { id: 'a', title: 'إيدام دجاج بالكريمة', section: 'صواني وايدامات', custom_tags: ['دجاج'] },
    { id: 'b', title: 'حلا الاوريو', section: 'الحلا', custom_tags: [] },
  ],
  lines: [{ recipe_id: 'a', position: 1, text: 'كريمة طبخ' }],
  suggestions: [{ recipe_id: 'b', position: 1, text: '٢٤ اوريو' }],
  templates: [{ recipe_id: 'a', kind: 'wash_chop', timing: 'before_cooking', body: 'تقطيع الخضار: بصل، جزر (مبشور)', position: 1 }],
  groups: [{ recipe_id: 'a', food_group: 'dairy' }],
}
const api = { loadOverview: async () => data }

afterEach(cleanup)

describe('the review page', () => {
  it('lists every recipe with its tags and what is missing', async () => {
    render(<OverviewPage api={api} />)
    expect(await screen.findByText('إيدام دجاج بالكريمة')).toBeTruthy()
    expect(screen.getByText('حلا الاوريو')).toBeTruthy()
    expect(screen.getByText('2 وصفة')).toBeTruthy()
    expect(screen.getAllByText('دجاج').length).toBeGreaterThan(0) // the tag
  })

  it('shows the ingredients, the prep and the vegetables with no cutting method', async () => {
    render(<OverviewPage api={api} />)
    await screen.findByText('إيدام دجاج بالكريمة')
    fireEvent.click(screen.getByText('افتحي الكل'))
    expect(screen.getByText('كريمة طبخ')).toBeTruthy()
    expect(screen.getByText('تقطيع الخضار: بصل، جزر (مبشور)')).toBeTruthy()
    expect(screen.getByText('بلا طريقة تقطيع: بصل')).toBeTruthy()
    expect(screen.getByText('٢٤ اوريو')).toBeTruthy() // the ones she confirmed in the app
    expect(screen.getAllByRole('link', { name: 'افتحي الوصفة للتعديل' })[0].getAttribute('href')).toBe('#/r/a')
  })

  it('narrows the list by what is missing', async () => {
    render(<OverviewPage api={api} />)
    await screen.findByText('إيدام دجاج بالكريمة')
    const missing = screen.getByRole('group', { name: 'ما ينقص' })
    fireEvent.click(within(missing).getByRole('button', { name: /بلا وسوم/ }))
    expect(screen.queryByText('إيدام دجاج بالكريمة')).toBeNull()
    expect(screen.getByText('حلا الاوريو')).toBeTruthy()
    expect(screen.getByText('1 وصفة')).toBeTruthy()
  })

  it('searches by name', async () => {
    render(<OverviewPage api={api} />)
    await screen.findByText('إيدام دجاج بالكريمة')
    fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'الاوريو' } })
    expect(screen.queryByText('إيدام دجاج بالكريمة')).toBeNull()
    expect(screen.getByText('حلا الاوريو')).toBeTruthy()
  })

  it('says so when nothing matches, and shows an error when loading fails', async () => {
    render(<OverviewPage api={api} />)
    await screen.findByText('إيدام دجاج بالكريمة')
    fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'غير موجودة' } })
    expect(screen.getByText('لا وصفات بهذه الاختيارات.')).toBeTruthy()
    cleanup()
    render(<OverviewPage api={{ loadOverview: async () => { throw new Error('تعذّر التحميل') } }} />)
    expect(await screen.findByText('تعذّر التحميل')).toBeTruthy()
  })
})
