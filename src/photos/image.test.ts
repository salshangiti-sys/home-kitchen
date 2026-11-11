import { describe, expect, it } from 'vitest'
import { FULL_MAX, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES, PhotoError, THUMB_MAX, fitWithin, processPhoto, type Codec, type Decoded, type Size } from './image'

const blob = (bytes: number, type = 'image/jpeg') => new Blob([new Uint8Array(bytes)], { type })

// A stand-in for the browser: `sizes` gives the byte size of each encoding attempt, in order.
function fakeCodec(source: Size, sizeFor: (quality: number, size: Size) => number = () => 200_000) {
  const calls: Array<{ size: Size; quality: number }> = []
  let closed = false
  const codec: Codec = {
    decode: async () => ({ ...source, close: () => void (closed = true) }) as Decoded,
    encode: async (_image, size, quality) => {
      calls.push({ size, quality })
      return blob(sizeFor(quality, size))
    },
  }
  return { codec, calls, closed: () => closed }
}

describe('fitWithin', () => {
  it('shrinks the longest side to the limit, keeping proportions', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 })
    expect(fitWithin(4000, 4000, 480)).toEqual({ width: 480, height: 480 })
  })

  it('never enlarges a small photo', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 })
  })

  it('keeps at least one pixel on a very thin photo', () => {
    expect(fitWithin(10000, 1, 1600)).toEqual({ width: 1600, height: 1 })
  })
})

describe('processing a photo', () => {
  it('makes a full-size and a small version, from one decode', async () => {
    const { codec, calls, closed } = fakeCodec({ width: 4000, height: 3000 })
    const result = await processPhoto(blob(5_000_000), codec)
    expect(result).toMatchObject({ width: 1600, height: 1200 })
    expect(calls).toEqual([
      { size: { width: 1600, height: 1200 }, quality: 0.82 },
      { size: { width: 480, height: 360 }, quality: 0.78 },
    ])
    expect(result.full.type).toBe('image/jpeg')
    expect(closed()).toBe(true) // the decoded picture is released
    expect(FULL_MAX).toBe(1600)
    expect(THUMB_MAX).toBe(480)
  })

  it('lowers the quality until the photo fits the 3 MB the storage accepts', async () => {
    const { codec, calls } = fakeCodec({ width: 4000, height: 3000 }, (quality) => (quality > 0.65 ? MAX_OUTPUT_BYTES + 1 : 900_000))
    const result = await processPhoto(blob(9_000_000), codec)
    expect(result.full.size).toBe(900_000)
    expect(calls.map((c) => c.quality)).toEqual([0.82, 0.7, 0.6, 0.78])
  })

  it('gives up with a clear message when no quality is small enough, and still releases the picture', async () => {
    const { codec, closed } = fakeCodec({ width: 4000, height: 3000 }, () => MAX_OUTPUT_BYTES + 1)
    await expect(processPhoto(blob(9_000_000), codec)).rejects.toMatchObject({ problem: 'cannot_shrink' })
    expect(closed()).toBe(true)
  })

  it('refuses a file that is not an image, or is far too big, before reading it', async () => {
    const { codec, calls } = fakeCodec({ width: 10, height: 10 })
    await expect(processPhoto(blob(100, 'application/pdf'), codec)).rejects.toMatchObject({ problem: 'not_image' })
    await expect(processPhoto(blob(MAX_INPUT_BYTES + 1), codec)).rejects.toMatchObject({ problem: 'too_big' })
    expect(calls).toEqual([])
  })

  it('accepts a file whose type the browser did not report (some phones leave it empty)', async () => {
    const { codec } = fakeCodec({ width: 800, height: 600 })
    expect((await processPhoto(blob(1000, ''), codec)).width).toBe(800)
  })

  it('reports a picture the device cannot read, or one without a size', async () => {
    const broken: Codec = { decode: async () => Promise.reject(new Error('bad image')), encode: async () => blob(1) }
    await expect(processPhoto(blob(1000), broken)).rejects.toBeInstanceOf(PhotoError)
    await expect(processPhoto(blob(1000), broken)).rejects.toMatchObject({ problem: 'unreadable' })
    const empty = fakeCodec({ width: 0, height: 0 })
    await expect(processPhoto(blob(1000), empty.codec)).rejects.toMatchObject({ problem: 'unreadable' })
  })

  it('speaks Arabic to the person', async () => {
    const { codec } = fakeCodec({ width: 1, height: 1 })
    await expect(processPhoto(blob(10, 'text/plain'), codec)).rejects.toThrow('هذا الملف ليس صورة.')
  })
})
