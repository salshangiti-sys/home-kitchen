import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_PHOTOS, photoMessage, photoPath, type Photo } from './api'
import PhotoGallery from './PhotoGallery'
import { PhotoError } from './image'

const photo = (n: number): Photo => ({
  id: `p${n}`,
  recipe_id: 'salads-007',
  path: `h/salads-007/p${n}.jpg`,
  thumb_path: `h/salads-007/p${n}-thumb.jpg`,
  width: 1600,
  height: 1200,
  bytes: 200000,
  position: n,
  created_at: '2026-11-12T00:00:00Z',
})

function fakeApi(initial: Photo[]) {
  let photos = [...initial]
  const api = {
    listPhotos: vi.fn(async () => [...photos]),
    signedUrls: vi.fn(async (paths: string[]) => new Map(paths.map((p) => [p, `https://files.example/${p}?token=1`]))),
    addPhoto: vi.fn(async () => {
      const added = photo(photos.length + 1)
      photos = [...photos, added]
      return added
    }),
    removePhoto: vi.fn(async (id: string) => void (photos = photos.filter((p) => p.id !== id))),
    makeCover: vi.fn(async (id: string) => {
      const chosen = photos.find((p) => p.id === id)!
      photos = [chosen, ...photos.filter((p) => p.id !== id)]
    }),
  }
  return api
}

const show = (api: ReturnType<typeof fakeApi>, canEdit: boolean) =>
  render(<PhotoGallery recipeId="salads-007" title="سلطة خضراء" canEdit={canEdit} api={api as never} />)

const file = () => new File([new Uint8Array(10)], 'dish.jpg', { type: 'image/jpeg' })

afterEach(cleanup)

describe('looking at photos', () => {
  it('shows the cover large and the others small, and opens any of them', async () => {
    show(fakeApi([photo(1), photo(2), photo(3)]), false)
    const cover = (await screen.findByAltText('صورة سلطة خضراء')) as HTMLImageElement
    expect(cover.src).toContain('p1.jpg')
    expect(screen.getAllByRole('button', { name: /تكبير الصورة [23]/ })).toHaveLength(2)
    expect(screen.queryByText('أضيفي صورة')).toBeNull() // the family can look but not add

    fireEvent.click(screen.getByRole('button', { name: 'تكبير الصورة 3' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('3 من 3')).toBeTruthy()
    expect((screen.getByAltText('صورة 3 من 3 لوصفة سلطة خضراء') as HTMLImageElement).src).toContain('p3.jpg')
    expect(screen.queryByText('احذفي الصورة')).toBeNull()
  })

  it('moves between photos with the buttons and the arrow keys, and closes with Escape', async () => {
    show(fakeApi([photo(1), photo(2), photo(3)]), false)
    fireEvent.click(await screen.findByRole('button', { name: 'تكبير الصورة الرئيسية' }))
    fireEvent.click(screen.getByRole('button', { name: 'التالية' }))
    expect(screen.getByText('2 من 3')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'ArrowLeft' }) // left is forward on a right-to-left page
    expect(screen.getByText('3 من 3')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByText('1 من 3')).toBeTruthy() // wraps around
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows nothing when there are no photos and you can only look', async () => {
    const api = fakeApi([])
    const { container } = show(api, false)
    await waitFor(() => expect(api.listPhotos).toHaveBeenCalled())
    await waitFor(() => expect(container.querySelector('section')).toBeNull())
  })
})

describe('adding photos', () => {
  it('offers to add a first photo, uploads each chosen file, and shows the new photos', async () => {
    const api = fakeApi([])
    show(api, true)
    const input = (await screen.findByText('أضيفي صورة')).querySelector('input') as HTMLInputElement
    expect(input.accept).toBe('image/*')
    expect(input.multiple).toBe(true)

    fireEvent.change(input, { target: { files: [file(), file()] } })
    await waitFor(() => expect(api.addPhoto).toHaveBeenCalledTimes(2))
    expect(await screen.findByAltText('صورة سلطة خضراء')).toBeTruthy()
    expect(screen.getByText('أضيفي صورة أخرى')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('stops at the first problem and says what it is, in Arabic', async () => {
    const api = fakeApi([])
    api.addPhoto.mockRejectedValueOnce(new PhotoError('not_image'))
    show(api, true)
    const input = (await screen.findByText('أضيفي صورة')).querySelector('input') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file(), file()] } })
    expect(await screen.findByText('هذا الملف ليس صورة.')).toBeTruthy()
    expect(api.addPhoto).toHaveBeenCalledTimes(1)
  })

  it('stops offering to add at the limit', async () => {
    show(fakeApi(Array.from({ length: MAX_PHOTOS }, (_, i) => photo(i + 1))), true)
    expect(await screen.findByText(/وصلتِ إلى الحد/)).toBeTruthy()
    expect(screen.queryByText('أضيفي صورة أخرى')).toBeNull()
  })
})

describe('managing photos', () => {
  it('makes a photo the cover', async () => {
    const api = fakeApi([photo(1), photo(2)])
    show(api, true)
    fireEvent.click(await screen.findByRole('button', { name: 'تكبير الصورة 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'اجعليها الصورة الرئيسية' }))
    await waitFor(() => expect(api.makeCover).toHaveBeenCalledWith('p2'))
    await waitFor(() => expect(screen.getByText('1 من 2')).toBeTruthy())
    expect((screen.getByAltText('صورة 1 من 2 لوصفة سلطة خضراء') as HTMLImageElement).src).toContain('p2.jpg')
    expect(screen.queryByRole('button', { name: 'اجعليها الصورة الرئيسية' })).toBeNull() // already the cover
  })

  it('asks before removing a photo, and removing closes the view', async () => {
    const api = fakeApi([photo(1), photo(2)])
    show(api, true)
    fireEvent.click(await screen.findByRole('button', { name: 'تكبير الصورة الرئيسية' }))
    fireEvent.click(screen.getByRole('button', { name: 'احذفي الصورة' }))
    expect(api.removePhoto).not.toHaveBeenCalled()
    expect(screen.getByText(/هل أنتِ متأكدة/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'إلغاء' }))
    expect(api.removePhoto).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'احذفي الصورة' }))
    fireEvent.click(screen.getByRole('button', { name: 'نعم، احذفيها' }))
    await waitFor(() => expect(api.removePhoto).toHaveBeenCalledWith('p1'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByRole('button', { name: 'تكبير الصورة 2' })).toBeNull() // only one photo left
  })
})

describe('a picture that stops loading', () => {
  it('asks for fresh addresses once, not in a loop', async () => {
    const api = fakeApi([photo(1)])
    show(api, false)
    const cover = await screen.findByAltText('صورة سلطة خضراء')
    expect(api.listPhotos).toHaveBeenCalledTimes(1)
    fireEvent.error(cover)
    await waitFor(() => expect(api.listPhotos).toHaveBeenCalledTimes(2))
    fireEvent.error(await screen.findByAltText('صورة سلطة خضراء'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(api.listPhotos).toHaveBeenCalledTimes(2)
  })
})

describe('messages and paths', () => {
  it('names the files the same way the database does', () => {
    expect(photoPath('h1', 'salads-007', 'abc', false)).toBe('h1/salads-007/abc.jpg')
    expect(photoPath('h1', 'salads-007', 'abc', true)).toBe('h1/salads-007/abc-thumb.jpg')
  })

  it('explains the usual problems in Arabic', () => {
    expect(photoMessage(new Error('photo_limit: a recipe can have at most 10 photos'))).toContain('10')
    expect(photoMessage(new Error('new row violates row-level security policy'))).toContain('صلاحية')
    expect(photoMessage(new Error('photo_files_missing: upload both files first'))).toContain('لم يكتمل')
    expect(photoMessage(new TypeError('Failed to fetch'))).toContain('اتصال')
    expect(photoMessage(new Error('something unexpected'))).toBe('something unexpected')
  })
})
