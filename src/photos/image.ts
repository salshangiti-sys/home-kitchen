// Shrinks a photo on the device before it is uploaded: a phone photo is often 4-8 MB, and a recipe
// photo needs about 300 KB. Each photo becomes a JPEG at most 1600 px on its longest side, plus a
// small 480 px one for lists. The photo is never enlarged, transparent areas become white, and the
// camera's rotation is applied. The browser does the drawing; the rest is plain logic, so it is
// tested without a browser by passing in a stand-in for the drawing part.

export const FULL_MAX = 1600
export const THUMB_MAX = 480
export const MAX_INPUT_BYTES = 30 * 1024 * 1024
// The storage bucket refuses files over 3 MB (3145728 bytes).
export const MAX_OUTPUT_BYTES = 3 * 1024 * 1024
const QUALITIES = [0.82, 0.7, 0.6, 0.5]

export type PhotoProblem = 'not_image' | 'too_big' | 'unreadable' | 'cannot_shrink'

const MESSAGES: Record<PhotoProblem, string> = {
  not_image: 'هذا الملف ليس صورة.',
  too_big: 'حجم الصورة أكبر من 30 ميغابايت. اختاري صورة أصغر.',
  unreadable: 'تعذّرت قراءة هذه الصورة. جرّبي صورة أخرى من المعرض.',
  cannot_shrink: 'تعذّر تصغير هذه الصورة بما يكفي. جرّبي صورة أخرى.',
}

export class PhotoError extends Error {
  constructor(readonly problem: PhotoProblem) {
    super(MESSAGES[problem])
  }
}

export interface Size {
  width: number
  height: number
}

// The size that fits in a square of `max`, keeping the proportions. Never larger than the original.
export function fitWithin(width: number, height: number, max: number): Size {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export interface Decoded extends Size {
  close?(): void
}

// The part that needs a browser: reading the image and drawing it as a JPEG.
export interface Codec {
  decode(file: Blob): Promise<Decoded>
  encode(image: Decoded, size: Size, quality: number): Promise<Blob>
}

export interface ProcessedPhoto extends Size {
  full: Blob
  thumb: Blob
}

export async function processPhoto(file: Blob, codec: Codec = browserCodec): Promise<ProcessedPhoto> {
  if (file.type && !file.type.startsWith('image/')) throw new PhotoError('not_image')
  if (file.size > MAX_INPUT_BYTES) throw new PhotoError('too_big')

  let image: Decoded
  try {
    image = await codec.decode(file)
  } catch {
    throw new PhotoError('unreadable')
  }
  if (!(image.width > 0 && image.height > 0)) throw new PhotoError('unreadable')

  try {
    const size = fitWithin(image.width, image.height, FULL_MAX)
    let full: Blob | null = null
    for (const quality of QUALITIES) {
      const attempt = await codec.encode(image, size, quality)
      if (attempt.size <= MAX_OUTPUT_BYTES) {
        full = attempt
        break
      }
    }
    if (!full) throw new PhotoError('cannot_shrink')
    const thumb = await codec.encode(image, fitWithin(image.width, image.height, THUMB_MAX), 0.78)
    return { full, thumb, ...size }
  } finally {
    image.close?.()
  }
}

// The real thing, in the browser. createImageBitmap applies the camera's rotation, and handles the
// photo formats the device itself can show (including iPhone HEIC in Safari).
export const browserCodec: Codec = {
  async decode(file) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      return await createImageBitmap(file)
    }
  },

  async encode(image, size, quality) {
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no canvas')
    context.fillStyle = '#ffffff' // JPEG has no transparency
    context.fillRect(0, 0, size.width, size.height)
    context.imageSmoothingQuality = 'high'
    context.drawImage(image as unknown as CanvasImageSource, 0, 0, size.width, size.height)
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode failed'))), 'image/jpeg', quality))
  },
}
