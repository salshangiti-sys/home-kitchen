import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SALAD } from '../library/fixtures'
import type { LoadedRecipe } from '../library/api'
import type { RecipeDoc } from '../library/types'
import CookMode from './CookMode'
import { loadProgress } from './cookState'

const loaded = (doc: RecipeDoc): (() => Promise<LoadedRecipe | null>) => async () => ({ doc, version: 1, trashedAt: null, favorite: false, flags: [] })

const THREE_STEPS: RecipeDoc = { ...SALAD, steps: [{ order: 1, text: 'نغسل الخضار' }, { order: 2, text: 'نقطع الخيار' }, { order: 3, text: 'نخلط الصوص ونصبه' }] }

async function open(doc: RecipeDoc = THREE_STEPS) {
  render(<CookMode id={doc.id} load={loaded(doc)} />)
  await screen.findByText(doc.title)
}

beforeEach(() => {
  localStorage.clear()
  window.location.hash = '#/r/salads-007/cook'
})
afterEach(cleanup)

describe('cook mode', () => {
  it('starts with the ingredients, grouped, and counts what you have ready', async () => {
    await open()
    expect(screen.getByText('الصوص')).toBeTruthy()
    expect(screen.getByText('زيت زيتون')).toBeTruthy()
    expect(screen.getByText('جهّزتِ 0 من 4')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('checkbox')[1])
    expect(screen.getByText('جهّزتِ 1 من 4')).toBeTruthy()
    expect(screen.getByText('خيار مقطع').className).toContain('line-through')
    fireEvent.click(screen.getAllByRole('checkbox')[1])
    expect(screen.getByText('جهّزتِ 0 من 4')).toBeTruthy()
  })

  it('shows one step at a time, with the next one previewed, and moves with the buttons', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'ابدئي الخطوات' }))
    expect(screen.getByText('الخطوة 1 من 3')).toBeTruthy()
    expect(screen.getByText('نغسل الخضار')).toBeTruthy()
    expect(screen.getByText('بعدها: نقطع الخيار')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'السابقة' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'التالية' }))
    expect(screen.getByText('الخطوة 2 من 3')).toBeTruthy()
    expect(screen.queryByText('نغسل الخضار')).toBeNull()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('2')

    fireEvent.click(screen.getByRole('button', { name: 'السابقة' }))
    expect(screen.getByText('الخطوة 1 من 3')).toBeTruthy()
  })

  it('moves with the arrow keys, next toward the left because the page is right to left', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'ابدئي الخطوات' }))
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByText('الخطوة 2 من 3')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText('الخطوة 1 من 3')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'ArrowRight' }) // already at the first step
    expect(screen.getByText('الخطوة 1 من 3')).toBeTruthy()
  })

  it('ends with "done", which clears your place and returns to the recipe', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'ابدئي الخطوات' }))
    fireEvent.click(screen.getByRole('button', { name: 'التالية' }))
    fireEvent.click(screen.getByRole('button', { name: 'التالية' }))
    expect(screen.getByText('الخطوة 3 من 3')).toBeTruthy()
    expect(screen.queryByText(/^بعدها/)).toBeNull()
    expect(loadProgress('salads-007', 3)?.step).toBe(2)

    fireEvent.click(screen.getByRole('button', { name: 'تم الطبخ ✓' }))
    expect(window.location.hash).toBe('#/r/salads-007')
    expect(loadProgress('salads-007', 3)).toBeNull()
  })

  it('remembers your place after a reload', async () => {
    await open()
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getByRole('button', { name: 'ابدئي الخطوات' }))
    fireEvent.click(screen.getByRole('button', { name: 'التالية' }))
    cleanup()

    await open()
    expect(screen.getByText('الخطوة 2 من 3')).toBeTruthy() // back on the steps, on step 2
    fireEvent.click(screen.getByRole('tab', { name: 'المقادير' }))
    expect(screen.getByText('جهّزتِ 1 من 4')).toBeTruthy()
  })

  it('changes the text size within its limits and keeps it', async () => {
    await open()
    const text = () => screen.getByText('خيار مقطع').className
    expect(text()).toContain('text-3xl')
    fireEvent.click(screen.getByRole('button', { name: 'تكبير الخط' }))
    fireEvent.click(screen.getByRole('button', { name: 'تكبير الخط' }))
    expect(text()).toContain('text-5xl')
    expect((screen.getByRole('button', { name: 'تكبير الخط' }) as HTMLButtonElement).disabled).toBe(true)
    cleanup()

    await open()
    expect(text()).toContain('text-5xl')
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole('button', { name: 'تصغير الخط' }))
    expect(text()).toContain('text-2xl')
  })

  it('shows the notes in their own tab, and leaves out tabs the recipe has nothing for', async () => {
    await open()
    fireEvent.click(screen.getByRole('tab', { name: 'ملاحظاتي' }))
    expect(screen.getByText('أزيد الليمون شوي')).toBeTruthy()

    cleanup()
    localStorage.clear()
    await open({ ...THREE_STEPS, ingredient_groups: [], notes: [] })
    expect(screen.queryByRole('tab')).toBeNull() // only steps: no tabs to choose between
    expect(screen.getByText('الخطوة 1 من 3')).toBeTruthy()
  })

  it('says nothing about the screen until the device has answered', async () => {
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: () => new Promise(() => {}) } })
    try {
      await open()
      expect(screen.queryByText(/الشاشة/)).toBeNull()
    } finally {
      delete (navigator as { wakeLock?: unknown }).wakeLock
    }
  })

  it('says so when the device cannot keep the screen awake', async () => {
    await open()
    await waitFor(() => expect(screen.getByText(/لا يدعم إبقاء الشاشة مضاءة/)).toBeTruthy())
  })

  it('keeps the screen awake where the device allows it, and lets go on leaving', async () => {
    let released = false
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request: async () => ({ release: async () => void (released = true), addEventListener: () => {} }) },
    })
    try {
      await open()
      await waitFor(() => expect(screen.getByText('الشاشة تبقى مضاءة أثناء الطبخ.')).toBeTruthy())
      await act(async () => cleanup())
      expect(released).toBe(true)
    } finally {
      delete (navigator as { wakeLock?: unknown }).wakeLock
    }
  })

  it('reports a recipe that is not found, and one that cannot be loaded', async () => {
    render(<CookMode id="nope-001" load={async () => null} />)
    expect(await screen.findByText('لم تُعثر على هذه الوصفة.')).toBeTruthy()
    cleanup()
    render(<CookMode id="x-001" load={() => Promise.reject(new TypeError('Failed to fetch'))} />)
    expect(await screen.findByText(/يحتاج هذا إلى اتصال بالإنترنت/)).toBeTruthy()
  })
})
