// The photos of a recipe: the cover large, the others small, tap to enlarge. Owners and editors can
// add photos (several at once, from the camera or the gallery), choose the cover, and remove a
// photo. Everyone in the family can look.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Notice } from '../ui'
import { MAX_PHOTOS, addPhoto, listPhotos, makeCover, photoMessage, removePhoto, signedUrls, forgetSignedUrls, type Photo } from './api'

interface Api {
  listPhotos: typeof listPhotos
  signedUrls: typeof signedUrls
  addPhoto: typeof addPhoto
  removePhoto: typeof removePhoto
  makeCover: typeof makeCover
}

const real: Api = { listPhotos, signedUrls, addPhoto, removePhoto, makeCover }

export default function PhotoGallery({ recipeId, title, canEdit, api = real }: { recipeId: string; title: string; canEdit: boolean; api?: Api }) {
  const [photos, setPhotos] = useState<Photo[] | null>(null)
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const retried = useRef(false)

  const load = useCallback(async () => {
    try {
      const list = await api.listPhotos(recipeId)
      setPhotos(list)
      setUrls(await api.signedUrls(list.flatMap((p) => [p.path, p.thumb_path])))
    } catch (e) {
      setPhotos((current) => current ?? [])
      setError(photoMessage(e))
    }
  }, [api, recipeId])

  useEffect(() => {
    void load()
  }, [load])

  // A signed address lasts an hour; if a picture fails to load after a long visit, ask for new ones once.
  const refreshOnError = () => {
    if (retried.current) return
    retried.current = true
    forgetSignedUrls()
    void load()
  }

  const add = async (files: FileList | null) => {
    if (!files?.length) return
    setError(null)
    const chosen = [...files]
    let added = 0
    for (const [index, file] of chosen.entries()) {
      setProgress(chosen.length > 1 ? `جارٍ رفع الصورة ${index + 1} من ${chosen.length}…` : 'جارٍ تجهيز الصورة ورفعها…')
      try {
        await api.addPhoto(recipeId, file)
        added += 1
      } catch (e) {
        setError(photoMessage(e))
        break // the same problem would repeat for the rest
      }
    }
    setProgress(null)
    if (added) await load()
  }

  const act = async (work: () => Promise<void>, after?: () => void) => {
    setBusy(true)
    setError(null)
    try {
      await work()
      await load()
      after?.()
    } catch (e) {
      setError(photoMessage(e))
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  const list = photos ?? []
  const current = open !== null ? list[open] : null
  const step = (delta: number) => {
    setConfirming(false)
    setOpen((o) => (o === null ? o : (o + delta + list.length) % list.length))
  }

  useEffect(() => {
    if (open === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null)
      if (list.length > 1 && event.key === 'ArrowLeft') step(1) // the page is right to left
      if (list.length > 1 && event.key === 'ArrowRight') step(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, list.length])

  if (photos === null) return null
  if (list.length === 0 && !canEdit && !error) return null

  const room = list.length < MAX_PHOTOS
  return (
    <section aria-label="صور الوصفة" className="flex flex-col gap-3">
      {list.length > 0 && (
        <>
          <button type="button" onClick={() => setOpen(0)} className="overflow-hidden rounded-2xl border border-line bg-surface" aria-label="تكبير الصورة الرئيسية">
            <img
              src={urls.get(list[0].path)}
              alt={`صورة ${title}`}
              width={list[0].width}
              height={list[0].height}
              onError={refreshOnError}
              className="max-h-80 w-full object-cover"
            />
          </button>
          {list.length > 1 && (
            <ul className="flex gap-2 overflow-x-auto pb-1">
              {list.slice(1).map((photo, i) => (
                <li key={photo.id} className="shrink-0">
                  <button type="button" onClick={() => setOpen(i + 1)} aria-label={`تكبير الصورة ${i + 2}`} className="overflow-hidden rounded-xl border border-line">
                    <img src={urls.get(photo.thumb_path)} alt="" onError={refreshOnError} className="size-20 object-cover" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {room ? (
            <label className={`inline-flex min-h-11 cursor-pointer items-center rounded-xl border border-line px-4 text-sm font-medium ${progress ? 'pointer-events-none opacity-50' : ''}`}>
              {list.length === 0 ? 'أضيفي صورة' : 'أضيفي صورة أخرى'}
              <input type="file" accept="image/*" multiple className="sr-only" disabled={!!progress} onChange={(e) => { void add(e.target.files); e.target.value = '' }} />
            </label>
          ) : (
            <span className="text-sm text-muted">وصلتِ إلى الحد: {MAX_PHOTOS} صور لكل وصفة.</span>
          )}
          {progress && <span role="status" className="text-sm text-muted">{progress}</span>}
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      {current && (
        <div role="dialog" aria-modal="true" aria-label="عرض الصورة" className="fixed inset-0 z-50 flex flex-col bg-black/95 p-4 text-white">
          <div className="flex items-center justify-between">
            <span className="text-sm">{open! + 1} من {list.length}</span>
            <button type="button" onClick={() => { setOpen(null); setConfirming(false) }} aria-label="إغلاق" className="min-h-11 min-w-11 rounded-xl border border-white/40 text-xl">×</button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <img src={urls.get(current.path)} alt={`صورة ${open! + 1} من ${list.length} لوصفة ${title}`} onError={refreshOnError} className="max-h-full max-w-full object-contain" />
          </div>
          <div className="flex flex-col items-center gap-3 pt-3">
            {list.length > 1 && (
              <div className="flex gap-3">
                <button type="button" onClick={() => step(-1)} className="min-h-12 min-w-24 rounded-xl border border-white/40">السابقة</button>
                <button type="button" onClick={() => step(1)} className="min-h-12 min-w-24 rounded-xl border border-white/40">التالية</button>
              </div>
            )}
            {canEdit && !confirming && (
              <div className="flex flex-wrap justify-center gap-3">
                {open !== 0 && (
                  <button type="button" disabled={busy} onClick={() => act(() => api.makeCover(current.id), () => setOpen(0))} className="min-h-11 rounded-xl border border-white/40 px-4 text-sm">
                    اجعليها الصورة الرئيسية
                  </button>
                )}
                <button type="button" disabled={busy} onClick={() => setConfirming(true)} className="min-h-11 rounded-xl border border-red-400 px-4 text-sm text-red-300">
                  احذفي الصورة
                </button>
              </div>
            )}
            {canEdit && confirming && (
              <div className="flex flex-col items-center gap-2">
                <p className="text-sm">تُحذف هذه الصورة من الوصفة. هل أنتِ متأكدة؟</p>
                <div className="flex gap-3">
                  <Button kind="danger" disabled={busy} onClick={() => act(() => api.removePhoto(current.id), () => setOpen(null))}>نعم، احذفيها</Button>
                  <button type="button" onClick={() => setConfirming(false)} className="min-h-11 rounded-xl border border-white/40 px-4 text-sm">إلغاء</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
