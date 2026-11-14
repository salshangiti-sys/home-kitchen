import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TitleLinker from './TitleLinker'
import type { TitleLinkResult } from './onenote'

afterEach(cleanup)

const result = (over: Partial<TitleLinkResult> = {}): TitleLinkResult => ({
  dry_run: true,
  linked: 2,
  pairs: [
    { recipe_id: 'a', recipe_title: 'سلطة سيزر', page_title: 'سلطة سيزر ', section_name: 'سلطات' },
    { recipe_id: 'b', recipe_title: 'فتة باذنجان', page_title: 'فتة باذنجان', section_name: 'سلطات' },
  ],
  pages_without_recipe: 3,
  recipes_without_page: 5,
  ambiguous_titles: ['دجاج مشوي'],
  ...over,
})

describe('linking recipes to pages by title', () => {
  it('shows what would be linked before changing anything, and links only after a yes', async () => {
    const link = vi.fn(async (dry: boolean) => (dry ? result() : result({ dry_run: false })))
    const onLinked = vi.fn()
    render(<TitleLinker link={link} onLinked={onLinked} />)

    fireEvent.click(screen.getByRole('button', { name: 'اربطي الوصفات بصفحاتها (بالعنوان)' }))
    expect(await screen.findByText(/سيُربط 2 وصفة بصفحة لها العنوان نفسه/)).toBeTruthy()
    expect(screen.getByText(/3 صفحة في الدفتر ليست لها وصفة/)).toBeTruthy()
    expect(screen.getByText(/5 وصفة في التطبيق ليست لها صفحة/)).toBeTruthy()
    expect(screen.getByText(/1 عنوان مكرر لا يُربط تلقائيًا/)).toBeTruthy()
    expect(link).toHaveBeenCalledTimes(1)
    expect(link).toHaveBeenCalledWith(true) // only a preview so far
    expect(onLinked).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'نعم، اربطي 2' }))
    await waitFor(() => expect(onLinked).toHaveBeenCalledTimes(1))
    expect(link).toHaveBeenLastCalledWith(false)
    expect(onLinked.mock.calls[0][0]).toMatch(/رُبطت 2 وصفة بصفحاتها/)
    // back to the first button
    expect(screen.getByRole('button', { name: 'اربطي الوصفات بصفحاتها (بالعنوان)' })).toBeTruthy()
  })

  it('lists the pairs and the repeated titles for checking', async () => {
    render(<TitleLinker link={async () => result()} onLinked={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'اربطي الوصفات بصفحاتها (بالعنوان)' }))
    await screen.findByText(/سيُربط 2 وصفة/)
    expect(screen.getByText('سلطة سيزر')).toBeTruthy()
    expect(screen.getByText('فتة باذنجان')).toBeTruthy()
    expect(screen.getByText('دجاج مشوي')).toBeTruthy()
  })

  it('does not offer to link when nothing matches', async () => {
    render(<TitleLinker link={async () => result({ linked: 0, pairs: [], ambiguous_titles: [] })} onLinked={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'اربطي الوصفات بصفحاتها (بالعنوان)' }))
    const yes = (await screen.findByRole('button', { name: 'نعم، اربطي 0' })) as HTMLButtonElement
    expect(yes.disabled).toBe(true)
  })

  it('cancels without linking', async () => {
    const link = vi.fn(async () => result())
    render(<TitleLinker link={link} onLinked={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'اربطي الوصفات بصفحاتها (بالعنوان)' }))
    await screen.findByText(/سيُربط 2 وصفة/)
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء' }))
    expect(screen.getByRole('button', { name: 'اربطي الوصفات بصفحاتها (بالعنوان)' })).toBeTruthy()
    expect(link).toHaveBeenCalledTimes(1)
  })

  it('shows the reason when it cannot preview or link', async () => {
    const link = vi.fn(async () => {
      throw new Error('اربطي مكان الوصفات أولًا.')
    })
    render(<TitleLinker link={link} onLinked={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'اربطي الوصفات بصفحاتها (بالعنوان)' }))
    expect(await screen.findByText('اربطي مكان الوصفات أولًا.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'اربطي الوصفات بصفحاتها (بالعنوان)' })).toBeTruthy()
  })
})
