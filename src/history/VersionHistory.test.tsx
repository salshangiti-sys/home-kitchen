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

const show = (list: RecipeVersion[], restore: 'yes' | 'linked' | 'no' = 'no', restoreVersion: () => Promise<{ version: number; result: 'updated' | 'unchanged' }> = vi.fn(async () => ({ version: 4, result: 'updated' as const }))) => {
  const api = { listVersions: vi.fn(async () => list), restoreVersion }
  const onRestored = vi.fn()
  render(<VersionHistory recipeId="salads-007" currentVersion={list[0]?.version ?? 1} restore={restore} onRestored={onRestored} today={() => '2026-11-12'} api={api as never} />)
  return { api, onRestored }
}

afterEach(cleanup)

describe('earlier versions', () => {
  it('shows nothing for a recipe with a single version', async () => {
    const { api } = show([history[2]])
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

describe('restoring a version', () => {
  const open = async (n: number) => fireEvent.click(await screen.findByRole('button', { name: new RegExp(`الإصدار ${n}`) }))

  it('offers no restore to someone who can only read', async () => {
    show(history, 'no')
    await open(2)
    expect(screen.queryByRole('button', { name: 'استرجعي هذا الإصدار' })).toBeNull()
  })

  it('explains why a recipe whose text is in OneNote cannot be restored here', async () => {
    show(history, 'linked')
    await open(2)
    expect(screen.getByText(/يُقرأ من صفحتها في OneNote/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'استرجعي هذا الإصدار' })).toBeNull()
  })

  it('does not offer to restore the current version', async () => {
    show(history, 'yes')
    await open(3)
    expect(screen.queryByRole('button', { name: 'استرجعي هذا الإصدار' })).toBeNull()
  })

  it('asks first, says nothing is lost, then restores as a new version and reloads the recipe', async () => {
    const { api, onRestored } = show(history, 'yes')
    await open(2)
    fireEvent.click(screen.getByRole('button', { name: 'استرجعي هذا الإصدار' }))
    expect(screen.getByText(/كما كانت في الإصدار 2، وتُحفظ كإصدار جديد \(4\)/)).toBeTruthy()
    expect(screen.getByText(/لا يضيع شيء/)).toBeTruthy()
    expect(api.restoreVersion).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'نعم، استرجعيه' }))
    await waitFor(() => expect(api.restoreVersion).toHaveBeenCalledWith('salads-007', 2, 3))
    expect(await screen.findByText('استُرجع الإصدار 2، وحُفظ كإصدار جديد (4).')).toBeTruthy()
    expect(onRestored).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the question is cancelled', async () => {
    const { api, onRestored } = show(history, 'yes')
    await open(1)
    fireEvent.click(screen.getByRole('button', { name: 'استرجعي هذا الإصدار' }))
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء' }))
    expect(screen.getByRole('button', { name: 'استرجعي هذا الإصدار' })).toBeTruthy()
    expect(api.restoreVersion).not.toHaveBeenCalled()
    expect(onRestored).not.toHaveBeenCalled()
  })

  it('says so when the old version is the same as the current one', async () => {
    const { onRestored } = show(history, 'yes', vi.fn(async () => ({ version: 3, result: 'unchanged' as const })))
    await open(2)
    fireEvent.click(screen.getByRole('button', { name: 'استرجعي هذا الإصدار' }))
    fireEvent.click(screen.getByRole('button', { name: 'نعم، استرجعيه' }))
    expect(await screen.findByText('الإصدار 2 مطابق للوصفة الحالية، فلم يتغير شيء.')).toBeTruthy()
    expect(onRestored).not.toHaveBeenCalled()
  })

  it('shows the reason and keeps the list when the database refuses', async () => {
    const { onRestored } = show(history, 'yes', vi.fn(async () => Promise.reject(new Error('version_conflict'))))
    await open(2)
    fireEvent.click(screen.getByRole('button', { name: 'استرجعي هذا الإصدار' }))
    fireEvent.click(screen.getByRole('button', { name: 'نعم، استرجعيه' }))
    expect(await screen.findByText(/تغيّرت الوصفة بعد أن فتحتِ هذه الصفحة/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /الإصدار 1/ })).toBeTruthy()
    expect(onRestored).not.toHaveBeenCalled()
  })
})
