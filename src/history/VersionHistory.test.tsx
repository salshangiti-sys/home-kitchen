import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RecipeDoc } from '../library/types'
import VersionHistory from './VersionHistory'
import type { RecipeVersion } from './versions'

const doc = (steps: string[], notes: string[] = []): RecipeDoc => ({
  id: 'salads-007',
  title: 'سلطة خضراء',
  status: 'complete',
  category: { section: 'سلطات' },
  sources: [],
  ingredient_groups: [{ name: null, items: [{ text: 'خس' }] }],
  steps: steps.map((text, i) => ({ order: i + 1, text })),
  notes,
  onenote: {},
  raw_text: 'x',
})

const v = (version: number, origin: RecipeVersion['origin'], changed_at: string, snapshot: RecipeDoc): RecipeVersion => ({ version, origin, changed_at, snapshot })

const history = [
  v(3, 'onenote', '2026-11-11T10:00:00Z', doc(['قطّعي', 'قلّبي جيدًا'])),
  v(2, 'app', '2026-11-05T10:00:00Z', doc(['قطّعي', 'قلّبي'], ['باردة'])),
  v(1, 'app', '2026-10-01T10:00:00Z', doc(['قطّعي'])),
]

const show = (list: RecipeVersion[]) => {
  const api = { listVersions: vi.fn(async () => list) }
  render(<VersionHistory recipeId="salads-007" currentVersion={list[0]?.version ?? 1} today={() => '2026-11-12'} api={api as never} />)
  return api
}

afterEach(cleanup)

describe('earlier versions', () => {
  it('shows nothing for a recipe with a single version', async () => {
    const api = show([history[2]])
    await waitFor(() => expect(api.listVersions).toHaveBeenCalled())
    expect(screen.queryByText('الإصدارات السابقة')).toBeNull()
  })

  it('lists the versions newest first with when and where each change came from', async () => {
    show(history)
    expect(await screen.findByText('الإصدارات السابقة')).toBeTruthy()
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual([
      expect.stringContaining('الإصدار 3 (الحالي)'),
      expect.stringContaining('الإصدار 2'),
      expect.stringContaining('الإصدار 1'),
    ])
    expect(buttons[0].textContent).toContain('أمس')
    expect(buttons[0].textContent).toContain('تغيّرت صفحتها في OneNote')
    expect(buttons[2].textContent).toContain('أُنشئت في التطبيق')
  })

  it('shows what changed against the version before it', async () => {
    show(history)
    fireEvent.click(await screen.findByRole('button', { name: /الإصدار 3/ }))
    expect(screen.getByText('ما تغيّر عن الإصدار 2')).toBeTruthy()
    expect(screen.getByText('أُضيف · الطريقة')).toBeTruthy()
    expect(screen.getAllByText('قلّبي جيدًا')).toHaveLength(2) // in the changes, and in the full text below
    expect(screen.getByText('حُذف · الطريقة')).toBeTruthy()
    expect(screen.getByText('حُذف · ملاحظاتي')).toBeTruthy()
    expect(screen.getByRole('button', { name: /الإصدار 3/ }).getAttribute('aria-expanded')).toBe('true')
  })

  it('says the first version has nothing before it, and closes again', async () => {
    show(history)
    const first = await screen.findByRole('button', { name: /الإصدار 1/ })
    fireEvent.click(first)
    expect(screen.getByText('هذا أول إصدار محفوظ للوصفة.')).toBeTruthy()
    fireEvent.click(first)
    expect(screen.queryByText('هذا أول إصدار محفوظ للوصفة.')).toBeNull()
  })

  it('offers the full text of a version', async () => {
    show(history)
    fireEvent.click(await screen.findByRole('button', { name: /الإصدار 2/ }))
    expect(screen.getByText('نص هذا الإصدار كاملًا')).toBeTruthy()
    expect(screen.getByText('أُضيف · ملاحظاتي')).toBeTruthy() // the note is new in version 2
    expect(screen.getAllByText('باردة')).toHaveLength(2) // in the changes, and in the full text of version 2
  })

  it('says when two versions read the same', async () => {
    show([v(2, 'onenote', '2026-11-11T10:00:00Z', history[2].snapshot), v(1, 'app', '2026-10-01T10:00:00Z', history[2].snapshot)])
    fireEvent.click(await screen.findByRole('button', { name: /الإصدار 2/ }))
    expect(screen.getByText(/لا فرق في النص الظاهر/)).toBeTruthy()
  })

  it('shows a message when the versions cannot be read', async () => {
    const api = { listVersions: vi.fn(async () => Promise.reject(new Error('Failed to fetch'))) }
    render(<VersionHistory recipeId="salads-007" currentVersion={2} api={api as never} />)
    expect(await screen.findByText(/يحتاج هذا إلى اتصال بالإنترنت/)).toBeTruthy()
  })
})
