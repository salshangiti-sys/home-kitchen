import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PrepTemplates from './PrepTemplates'
import type { Template } from './api'

const template = (id: string, body: string, extra: Partial<Template> = {}): Template => ({ id, recipe_id: 'mains-001', kind: 'other', timing: 'before_cooking', at_time: null, body, position: 1, ...extra })

function fakeApi(initial: Template[]) {
  let list = [...initial]
  return {
    listTemplates: vi.fn(async () => [...list]),
    saveTemplate: vi.fn(async (id: string | null, _recipe: string, t: { kind: Template['kind']; timing: Template['timing']; atTime: string | null; body: string }) => {
      if (id) list = list.map((x) => (x.id === id ? { ...x, kind: t.kind, timing: t.timing, at_time: t.atTime ? `${t.atTime}:00` : null, body: t.body } : x))
      else list = [...list, template(`n${list.length}`, t.body, { kind: t.kind, timing: t.timing, at_time: t.atTime ? `${t.atTime}:00` : null })]
      return 'id'
    }),
    removeTemplate: vi.fn(async (id: string) => void (list = list.filter((x) => x.id !== id))),
  }
}

const show = (api: ReturnType<typeof fakeApi>, canEdit: boolean, lines: string[] = []) =>
  render(<PrepTemplates recipeId="mains-001" canEdit={canEdit} ingredientLines={lines} api={api as never} />)

afterEach(cleanup)

describe('reading', () => {
  it('lists the prep steps with their kind and timing, to a reader', async () => {
    show(fakeApi([template('a', 'أخرجي الدجاج', { kind: 'defrost', timing: 'night_before' }), template('b', 'قطّعي الخضار', { kind: 'wash_chop', timing: 'at_time', at_time: '16:30:00' })]), false)
    expect(await screen.findByText('أخرجي الدجاج')).toBeTruthy()
    expect(screen.getByText('إذابة')).toBeTruthy()
    expect(screen.getByText('الليلة السابقة')).toBeTruthy()
    expect(screen.getByText('الساعة 16:30')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows nothing to a reader when the recipe has no prep steps', async () => {
    const api = fakeApi([])
    show(api, false)
    await waitFor(() => expect(api.listTemplates).toHaveBeenCalled())
    expect(screen.queryByText('تجهيزات الوصفة')).toBeNull()
  })
})

describe('writing', () => {
  it('adds a prep step with a kind and a timing', async () => {
    const api = fakeApi([])
    show(api, true)
    fireEvent.click(await screen.findByRole('button', { name: 'أضيفي تجهيزًا' }))
    fireEvent.change(screen.getByLabelText('النوع'), { target: { value: 'marinade' } })
    fireEvent.change(screen.getByLabelText('التوقيت'), { target: { value: 'night_before' } })
    fireEvent.change(screen.getByLabelText('ماذا تفعلين؟'), { target: { value: 'تتبيلة الدجاج' } })
    fireEvent.click(screen.getByRole('button', { name: 'أضيفي' }))
    await waitFor(() => expect(api.saveTemplate).toHaveBeenCalledWith(null, 'mains-001', { kind: 'marinade', timing: 'night_before', atTime: null, body: 'تتبيلة الدجاج' }))
    expect(await screen.findByText('تتبيلة الدجاج')).toBeTruthy()
  })

  it('asks for the hour only when the timing is a given time', async () => {
    const api = fakeApi([])
    show(api, true)
    fireEvent.click(await screen.findByRole('button', { name: 'أضيفي تجهيزًا' }))
    expect(screen.queryByLabelText('الساعة')).toBeNull()
    fireEvent.change(screen.getByLabelText('التوقيت'), { target: { value: 'at_time' } })
    fireEvent.change(screen.getByLabelText('ماذا تفعلين؟'), { target: { value: 'سخّني الفرن' } })
    expect((screen.getByRole('button', { name: 'أضيفي' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('الساعة'), { target: { value: '17:15' } })
    fireEvent.click(screen.getByRole('button', { name: 'أضيفي' }))
    await waitFor(() => expect(api.saveTemplate).toHaveBeenCalledWith(null, 'mains-001', { kind: 'other', timing: 'at_time', atTime: '17:15', body: 'سخّني الفرن' }))
  })

  it('edits a step', async () => {
    const api = fakeApi([template('a', 'قديم')])
    show(api, true)
    fireEvent.click(await screen.findByRole('button', { name: 'تعديل' }))
    fireEvent.change(screen.getByLabelText('ماذا تفعلين؟'), { target: { value: 'جديد' } })
    fireEvent.click(screen.getByRole('button', { name: 'احفظي التعديل' }))
    await waitFor(() => expect(api.saveTemplate).toHaveBeenCalledWith('a', 'mains-001', expect.objectContaining({ body: 'جديد' })))
    expect(await screen.findByText('جديد')).toBeTruthy()
  })

  it('asks before deleting a step, and says what happens to its tasks', async () => {
    const api = fakeApi([template('a', 'خطوة')])
    show(api, true)
    fireEvent.click(await screen.findByRole('button', { name: 'حذف' }))
    expect(screen.getByText(/تُزال مهامه التي لم تُلمس ولم تُنجَز/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء' }))
    expect(api.removeTemplate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'حذف' }))
    fireEvent.click(screen.getByRole('button', { name: 'نعم، احذفيه' }))
    await waitFor(() => expect(api.removeTemplate).toHaveBeenCalledWith('a'))
  })

  it('shows the reason when saving fails', async () => {
    const api = fakeApi([])
    api.saveTemplate.mockRejectedValueOnce(new Error('bad_timing: x'))
    show(api, true)
    fireEvent.click(await screen.findByRole('button', { name: 'أضيفي تجهيزًا' }))
    fireEvent.change(screen.getByLabelText('ماذا تفعلين؟'), { target: { value: 'س' } })
    fireEvent.click(screen.getByRole('button', { name: 'أضيفي' }))
    expect(await screen.findByText(/وقتًا محددًا/)).toBeTruthy()
  })
})

describe('suggestions', () => {
  it('suggests a step for a line that may need the freezer, and adds it only when asked', async () => {
    const api = fakeApi([])
    show(api, true, ['٥٠٠ غ لحم مفروم', 'بصل مفروم'])
    expect(await screen.findByText(/«٥٠٠ غ لحم مفروم» قد يحتاج إخراجًا من الفريزر/)).toBeTruthy()
    expect(screen.queryByText(/«بصل مفروم»/)).toBeNull()
    expect(api.saveTemplate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /^أضيفي: أخرجي/ }))
    await waitFor(() => expect(api.saveTemplate).toHaveBeenCalledWith(null, 'mains-001', { kind: 'defrost', timing: 'night_before', atTime: null, body: 'أخرجي «٥٠٠ غ لحم مفروم» من الفريزر' }))
    await waitFor(() => expect(screen.queryByText(/قد يحتاج إخراجًا من الفريزر/)).toBeNull())
  })

  it('offers no suggestions to a reader', async () => {
    const api = fakeApi([template('a', 'خطوة')])
    show(api, false, ['لحم مفروم'])
    await screen.findByText('خطوة')
    expect(screen.queryByText(/اقتراحات/)).toBeNull()
  })
})
