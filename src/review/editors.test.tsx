import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TagsEditor } from './editors'

describe('TagsEditor', () => {
  it('offers the usual tags as one-tap chips, including the snack tag, and hides the ones already on', () => {
    const onChange = vi.fn()
    render(<TagsEditor tags={['دجاج']} busy={false} onChange={onChange} />)
    expect(screen.queryByRole('button', { name: 'أضيفي الوسم دجاج' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'أضيفي الوسم سناك/خفايف' }))
    expect(onChange).toHaveBeenCalledWith(['دجاج', 'سناك/خفايف'])
    fireEvent.click(screen.getByRole('button', { name: 'أضيفي الوسم تجهيز مُسبق' }))
    expect(onChange).toHaveBeenCalledWith(['دجاج', 'تجهيز مُسبق'])
    fireEvent.click(screen.getByRole('button', { name: 'أضيفي الوسم قلاش' }))
    expect(onChange).toHaveBeenCalledWith(['دجاج', 'قلاش'])
    fireEvent.click(screen.getByRole('button', { name: 'أضيفي الوسم صوص طماطم' }))
    expect(onChange).toHaveBeenCalledWith(['دجاج', 'صوص طماطم'])
  })
})
