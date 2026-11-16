import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Menu, { type MenuItem } from './Menu'

const items: MenuItem[] = [
  { label: 'الوصفات', hint: 'كل وصفاتكِ', to: '#/', icon: '📖', active: true },
  { label: 'مراجعة', hint: 'راجعي الجديد', to: '#/overview', icon: '✅', active: false, badge: 3 },
]

describe('Menu', () => {
  afterEach(cleanup)

  it('shows nothing while closed', () => {
    render(<Menu open={false} items={items} pref="system" onTheme={() => undefined} onClose={() => undefined} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('lists the sections with what each is for, marks the current one and the waiting count', () => {
    render(<Menu open items={items} pref="system" onTheme={() => undefined} onClose={() => undefined} />)
    expect(screen.getByRole('link', { name: /الوصفات/ }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByText('راجعي الجديد')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('closes on the backdrop, on Escape and when a section is chosen; picks the theme', () => {
    const onClose = vi.fn()
    const onTheme = vi.fn()
    render(<Menu open items={items} pref="system" onTheme={onTheme} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('menu-backdrop'))
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('link', { name: /مراجعة/ }))
    expect(onClose).toHaveBeenCalledTimes(3)
    fireEvent.click(screen.getByRole('radio', { name: 'داكن' }))
    expect(onTheme).toHaveBeenCalledWith('dark')
  })
})
