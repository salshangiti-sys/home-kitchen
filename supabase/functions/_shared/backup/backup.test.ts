// @vitest-environment node
import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'
import schema from '../../../../schema/recipe.schema.json'
import { LINK_ONLY, SALAD } from '../../../../src/library/fixtures'
import { OneNoteClient } from '../onenote/graph.ts'
import {
  KEEP_BACKUPS,
  MAX_PHOTOS_PER_RUN,
  backupName,
  buildBackupFile,
  copyPhotos,
  filesToRemove,
  isBackupName,
  photoName,
  runBackup,
  sha1Hex,
  type Bundle,
  type Drive,
  type DriveFile,
  type PhotoDeps,
  type PhotoDrive,
  type PhotoFile,
} from './backup.ts'
import { DRIVE_BASE, oneDrive } from './drive.ts'
import { recipeChecker } from './recipeCheck.ts'
import { recipeSchema } from './recipeSchema.ts'

const check = recipeChecker(Ajv2020 as never)
const NOW = new Date(Date.UTC(2026, 10, 11, 2, 30, 7))

const bundle = (overrides: Partial<Bundle> = {}): Bundle => ({
  household: { id: 'h1' },
  members: [{ user_id: 'u1', role: 'owner' }],
  recipes: [SALAD, LINK_ONLY],
  deleted_recipes: [{ doc: { ...SALAD, id: 'old-001' }, deleted_at: '2026-11-01T00:00:00Z' } as never],
  favorites: [{ user_id: 'u1', recipe_id: SALAD.id }],
  flags: [{ recipe_id: SALAD.id, flag: 'x', status: 'open' }],
  versions: [{ recipe_id: SALAD.id, version: 1 }],
  onenote_pages: [],
  ...overrides,
})

class FakeDrive implements Drive {
  files = new Map<string, string>([['unrelated.txt', 'keep me']])
  ids = new Map<string, string>()
  log: string[] = []
  corrupt: ((text: string) => string) | null = null
  failOn: string | null = null
  private n = 0
  async folderName() {
    this.log.push('folder')
    return 'home-kitchen'
  }
  async put(name: string, text: string) {
    if (this.failOn === 'put') throw new Error('OneDrive is full')
    this.files.set(name, text)
    this.ids.set(name, `id-${++this.n}`)
    this.log.push(`put ${name}`)
  }
  async get(name: string) {
    const text = this.files.get(name)!
    return new TextEncoder().encode(this.corrupt ? this.corrupt(text) : text)
  }
  async list(): Promise<DriveFile[]> {
    return [...this.files.keys()].map((name) => ({ id: this.ids.get(name) ?? `id-${name}`, name }))
  }
  async remove(id: string) {
    if (this.failOn === 'remove') throw new Error('delete refused')
    const name = [...this.files.keys()].find((n) => (this.ids.get(n) ?? `id-${n}`) === id)!
    this.files.delete(name)
    this.log.push(`remove ${name}`)
  }
}

const run = (drive: FakeDrive, b: Bundle = bundle()) => runBackup({ bundle: async () => b, drive, check, now: () => NOW })

describe('the backup file', () => {
  it('is named by time, and only such names count as backups', () => {
    expect(backupName(NOW)).toBe('hk-backup-2026-11-11-0230.json')
    expect(isBackupName('hk-backup-2026-11-11-0230.json')).toBe(true)
    expect(isBackupName('notes.txt')).toBe(false)
    expect(isBackupName('hk-backup-2026-11-11.json')).toBe(false)
  })

  it('holds the recipes in the shape of recipes.json, with counts, and no secrets', async () => {
    const file = await buildBackupFile(bundle(), NOW)
    const parsed = JSON.parse(file.text)
    expect(parsed).toMatchObject({ format: 'home-kitchen-backup', version: 1, counts: { recipes: 2, deleted_recipes: 1, favorites: 1, flags: 1, versions: 1, onenote_pages: 0 } })
    expect(parsed.recipes).toEqual([SALAD, LINK_ONLY])
    expect(file.text).not.toMatch(/refresh_token|access_token|secret|password|salshangiti/i)
    expect(file.bytes).toBe(new TextEncoder().encode(file.text).length)
  })

  it('embeds the same schema the app checks recipes against', () => {
    expect(recipeSchema).toEqual(schema)
  })
})

describe('a backup run', () => {
  it('writes the file, reads it back, checks it, and succeeds', async () => {
    const drive = new FakeDrive()
    const record = await run(drive)
    expect(record).toMatchObject({ ok: true, verified: true, file_name: 'hk-backup-2026-11-11-0230.json', folder_name: 'home-kitchen', recipes: 2, deleted_recipes: 1, old_files_removed: 0, error: null })
    expect(drive.files.has('hk-backup-2026-11-11-0230.json')).toBe(true)
  })

  it('asks for the app folder before uploading, so OneDrive has created it', async () => {
    const drive = new FakeDrive()
    await run(drive)
    expect(drive.log.slice(0, 2)).toEqual(['folder', 'put hk-backup-2026-11-11-0230.json'])
  })

  it("passes on OneDrive's own explanation of a failure", async () => {
    const drive = new FakeDrive()
    drive.put = async () => {
      throw Object.assign(new Error('PUT /x failed with 404'), { body: '{"error":{"code":"itemNotFound","message":"The resource could not be found."}}' })
    }
    expect((await run(drive)).error).toBe('PUT /x failed with 404 (itemNotFound: The resource could not be found.)')
  })

  it('fails when the file read back is not what was written, and removes nothing', async () => {
    const drive = new FakeDrive()
    for (let i = 1; i <= 35; i++) drive.files.set(`hk-backup-2026-10-${String(i).padStart(2, '0')}-0230.json`, '{}')
    drive.corrupt = (text) => text.slice(0, -10)
    const record = await run(drive)
    expect(record).toMatchObject({ ok: false, verified: false, old_files_removed: 0 })
    expect(record.error).toMatch(/differs|not valid JSON/)
    expect(drive.log.filter((entry) => entry.startsWith('remove'))).toEqual([])
  })

  it('fails when a recipe in the file is not valid against the schema', async () => {
    const record = await run(new FakeDrive(), bundle({ recipes: [SALAD, { id: 'bad-001', title: 'x' }] }))
    expect(record.ok).toBe(false)
    expect(record.error).toMatch(/bad-001/)
  })

  it('fails when the same recipe appears twice', async () => {
    const record = await run(new FakeDrive(), bundle({ recipes: [SALAD, SALAD] }))
    expect(record.ok).toBe(false)
    expect(record.error).toMatch(/appears twice/)
  })

  it('reports a failed upload instead of throwing', async () => {
    const drive = new FakeDrive()
    drive.failOn = 'put'
    expect(await run(drive)).toMatchObject({ ok: false, verified: false, error: 'OneDrive is full' })
  })

  it('keeps the newest 30 backups, removes older ones, and never touches other files', async () => {
    const drive = new FakeDrive()
    for (let i = 1; i <= 33; i++) drive.files.set(`hk-backup-2026-10-${String(i).padStart(2, '0')}-0230.json`, '{}')
    const record = await run(drive)
    expect(record).toMatchObject({ ok: true, old_files_removed: 4 })
    const backups = [...drive.files.keys()].filter(isBackupName)
    expect(backups).toHaveLength(KEEP_BACKUPS)
    expect(backups).toContain('hk-backup-2026-11-11-0230.json')
    expect(backups).not.toContain('hk-backup-2026-10-01-0230.json')
    expect(drive.files.has('unrelated.txt')).toBe(true)
  })

  it('still counts a good backup as good when clearing old ones fails', async () => {
    const drive = new FakeDrive()
    for (let i = 1; i <= 33; i++) drive.files.set(`hk-backup-2026-10-${String(i).padStart(2, '0')}-0230.json`, '{}')
    drive.failOn = 'remove'
    const record = await run(drive)
    expect(record).toMatchObject({ ok: true, verified: true })
    expect(record.error).toMatch(/removing old files failed/)
  })

  it('picks files to remove by name, newest kept', () => {
    const files = ['hk-backup-2026-01-01-0000.json', 'hk-backup-2026-03-01-0000.json', 'hk-backup-2026-02-01-0000.json', 'other.json'].map((name) => ({ id: name, name }))
    expect(filesToRemove(files, 2).map((f) => f.name)).toEqual(['hk-backup-2026-01-01-0000.json'])
  })
})

describe('the OneDrive app folder', () => {
  function drive(responses: Response[]) {
    const calls: Array<{ method: string; url: string; body?: unknown }> = []
    const client = new OneNoteClient({
      baseUrl: DRIVE_BASE,
      getAccessToken: async () => 'token',
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ method: init.method ?? 'GET', url, body: init.body })
        return responses.shift()!
      }) as never,
      sleep: async () => {},
    })
    return { drive: oneDrive(client), calls }
  }
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

  it('uploads into the app folder by name, and reads the folder name', async () => {
    const { drive: d, calls } = drive([new Response('{}', { status: 201 }), json({ name: 'home-kitchen' })])
    await d.put('hk-backup-2026-11-11-0230.json', '{"a":"م"}')
    expect(await d.folderName()).toBe('home-kitchen')
    expect(calls[0]).toMatchObject({ method: 'PUT', url: `${DRIVE_BASE}/special/approot:/hk-backup-2026-11-11-0230.json:/content`, body: '{"a":"م"}' })
    expect(calls[1].url).toBe(`${DRIVE_BASE}/special/approot?$select=name`)
  })

  it('downloads the bytes, lists every page of files, and deletes by id', async () => {
    const { drive: d, calls } = drive([
      new Response('{"x":1}', { status: 200 }),
      json({ value: [{ id: 'a', name: 'one' }], '@odata.nextLink': `${DRIVE_BASE}/special/approot/children?$skiptoken=2` }),
      json({ value: [{ id: 'b', name: 'two' }] }),
      new Response(null, { status: 204 }),
    ])
    expect(new TextDecoder().decode(await d.get('f.json'))).toBe('{"x":1}')
    expect(await d.list()).toEqual([{ id: 'a', name: 'one' }, { id: 'b', name: 'two' }])
    await d.remove('b')
    expect(calls.map((c) => `${c.method} ${c.url.replace(DRIVE_BASE, '')}`)).toEqual([
      'GET /special/approot:/f.json:/content',
      'GET /special/approot/children?$select=id,name&$top=200',
      'GET /special/approot/children?$skiptoken=2',
      'DELETE /items/b',
    ])
  })
})

// ---- Photos ----

const bytesOf = (text: string) => new TextEncoder().encode(text)

class FakePhotoDrive extends FakeDrive implements PhotoDrive {
  photos = new Map<string, Uint8Array>()
  fail: string | null = null
  wrongSize = false
  wrongHash = false
  async photoNames() {
    return new Set(this.photos.keys())
  }
  async putPhoto(name: string, data: Uint8Array): Promise<{ size: number; sha1: string | null }> {
    if (this.fail === name) throw new Error('OneDrive is full')
    this.photos.set(name, data)
    this.log.push(`photo ${name}`)
    return { size: this.wrongSize ? data.length + 1 : data.length, sha1: this.wrongHash ? 'ab'.repeat(20) : await sha1Hex(data) }
  }
}

const photo = (n: number): PhotoFile => ({ id: `p${n}`, path: `h/r/p${n}.jpg`, bytes: 5 })
const storage = (files: PhotoFile[]) => ({
  list: async () => files,
  read: async (path: string) => bytesOf(`bytes of ${path}`),
})

function copy(drive: FakePhotoDrive, files: PhotoFile[], extra: Partial<PhotoDeps> = {}) {
  return copyPhotos({ ...storage(files), drive, now: () => 0, ...extra })
}

describe('copying photos to OneDrive', () => {
  it('copies the photos that are not there yet, under photos/<id>.jpg names, once', async () => {
    const drive = new FakePhotoDrive()
    drive.photos.set(photoName('p1'), bytesOf('already there'))
    const result = await copy(drive, [photo(1), photo(2), photo(3)])
    expect(result).toEqual({ total: 3, copied: 2, pending: 0, error: null })
    expect([...drive.photos.keys()].sort()).toEqual(['p1.jpg', 'p2.jpg', 'p3.jpg'])
    expect(new TextDecoder().decode(drive.photos.get('p1.jpg'))).toBe('already there') // not copied again
    expect(await copy(drive, [photo(1), photo(2), photo(3)])).toEqual({ total: 3, copied: 0, pending: 0, error: null })
  })

  it('has nothing to do for no photos', async () => {
    expect(await copy(new FakePhotoDrive(), [])).toEqual({ total: 0, copied: 0, pending: 0, error: null })
  })

  it('spreads a big first copy over several runs', async () => {
    const drive = new FakePhotoDrive()
    const files = Array.from({ length: MAX_PHOTOS_PER_RUN + 10 }, (_, i) => photo(i))
    expect(await copy(drive, files)).toMatchObject({ total: 50, copied: 40, pending: 10, error: null })
    expect(await copy(drive, files)).toMatchObject({ copied: 10, pending: 0 })
    expect(drive.photos.size).toBe(50)
  })

  it('stops starting new copies when the time is used up', async () => {
    const drive = new FakePhotoDrive()
    let t = 0
    const result = await copy(drive, [photo(1), photo(2), photo(3)], { now: () => (t += 40_000), budgetMs: 100_000 })
    expect(result.copied).toBe(2)
    expect(result.pending).toBe(1)
    expect(result.error).toBeNull()
  })

  it('stops at the first problem, keeps what was copied, and says what went wrong', async () => {
    const drive = new FakePhotoDrive()
    drive.fail = 'p2.jpg'
    const result = await copy(drive, [photo(1), photo(2), photo(3)])
    expect(result).toEqual({ total: 3, copied: 1, pending: 2, error: 'OneDrive is full' })
    expect(drive.photos.has('p3.jpg')).toBe(false)
  })

  it('does not count a copy whose size or content differs from the original', async () => {
    const drive = new FakePhotoDrive()
    drive.wrongSize = true
    expect((await copy(drive, [photo(1)])).error).toMatch(/stored 20 bytes, expected 19/)
    drive.wrongSize = false
    drive.wrongHash = true
    const result = await copy(drive, [photo(2)])
    expect(result.error).toMatch(/does not match the original/)
    expect(result.copied).toBe(0)
  })

  it('accepts a copy when OneDrive gives no hash but the size is right', async () => {
    const drive = new FakePhotoDrive()
    drive.putPhoto = (async (name: string, data: Uint8Array) => (drive.photos.set(name, data), { size: data.length, sha1: null })) as never
    expect(await copy(drive, [photo(1)])).toMatchObject({ copied: 1, error: null })
  })

  it('reports a problem with storage or the list instead of throwing', async () => {
    const result = await copyPhotos({ list: async () => { throw new Error('could not list') }, read: async () => bytesOf('x'), drive: new FakePhotoDrive(), now: () => 0 })
    expect(result).toMatchObject({ copied: 0, error: 'could not list' })
  })
})

describe('photos in a backup run', () => {
  const withPhotos = (drive: FakePhotoDrive, files: PhotoFile[]) =>
    runBackup({ bundle: async () => bundle(), drive, check, now: () => NOW, photos: storage(files) })

  it('copies the photos after the data is safe and records how it went', async () => {
    const drive = new FakePhotoDrive()
    const record = await withPhotos(drive, [photo(1), photo(2)])
    expect(record).toMatchObject({ ok: true, verified: true, photos_total: 2, photos_copied: 2, photos_pending: 0, photos_error: null })
    expect(drive.log.indexOf('put hk-backup-2026-11-11-0230.json')).toBeLessThan(drive.log.indexOf('photo p1.jpg'))
  })

  it('stays a good backup when a photo cannot be copied, and shows the problem', async () => {
    const drive = new FakePhotoDrive()
    drive.fail = 'p1.jpg'
    const record = await withPhotos(drive, [photo(1)])
    expect(record).toMatchObject({ ok: true, verified: true, error: null, photos_copied: 0, photos_pending: 1, photos_error: 'OneDrive is full' })
  })

  it('does not touch photos when the data backup failed', async () => {
    const drive = new FakePhotoDrive()
    drive.failOn = 'put'
    const record = await withPhotos(drive, [photo(1)])
    expect(record).toMatchObject({ ok: false, photos_total: null })
    expect(drive.photos.size).toBe(0)
  })

  it('leaves the photo fields empty when no photos are offered, or the drive cannot hold them', async () => {
    expect(await run(new FakeDrive())).toMatchObject({ photos_total: null, photos_copied: null })
    const record = await runBackup({ bundle: async () => bundle(), drive: new FakeDrive(), check, now: () => NOW, photos: storage([photo(1)]) })
    expect(record.photos_total).toBeNull()
  })
})

describe('the OneDrive photo folder', () => {
  const sent: Array<{ method: string; url: string; body?: unknown; type?: string }> = []
  const drive = (responses: Response[]) => {
    sent.length = 0
    const client = new OneNoteClient({
      baseUrl: DRIVE_BASE,
      getAccessToken: async () => 't',
      fetch: (async (url: string, init: { method: string; body?: unknown; headers: Record<string, string> }) => {
        sent.push({ method: init.method, url, body: init.body, type: init.headers['Content-Type'] })
        return responses.shift()!
      }) as never,
      sleep: async () => {},
    })
    return oneDrive(client)
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

  it('uploads the bytes to photos/<name> as image/jpeg and returns the size and SHA-1', async () => {
    const d = drive([json({ size: 3, file: { hashes: { sha1Hash: 'ABC' } } }, 201)])
    expect(await d.putPhoto('p1.jpg', new Uint8Array([1, 2, 3]))).toEqual({ size: 3, sha1: 'ABC' })
    expect(sent[0]).toMatchObject({ method: 'PUT', url: `${DRIVE_BASE}/special/approot:/photos/p1.jpg:/content`, type: 'image/jpeg' })
    expect(sent[0].body).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('returns no hash when OneDrive gives none', async () => {
    expect(await drive([json({ size: 3 })]).putPhoto('p1.jpg', new Uint8Array(3))).toEqual({ size: 3, sha1: null })
  })

  it('lists every page of names, and treats a missing folder as empty', async () => {
    const d = drive([
      json({ value: [{ name: 'a.jpg' }], '@odata.nextLink': `${DRIVE_BASE}/special/approot:/photos:/children?$skiptoken=2` }),
      json({ value: [{ name: 'b.jpg' }] }),
    ])
    expect([...(await d.photoNames())]).toEqual(['a.jpg', 'b.jpg'])
    expect(sent[0].url).toBe(`${DRIVE_BASE}/special/approot:/photos:/children?$select=name&$top=200`)
    expect(await drive([json({ error: { code: 'itemNotFound' } }, 404)]).photoNames()).toEqual(new Set())
  })

  it('does not hide other errors', async () => {
    await expect(drive([json({}, 403)]).photoNames()).rejects.toThrow(/403/)
  })
})

describe('reading the backup file back from OneDrive', () => {
  const responses = (list: Response[]) => {
    const waits: number[] = []
    let calls = 0
    const client = new OneNoteClient({
      baseUrl: DRIVE_BASE,
      getAccessToken: async () => 't',
      fetch: (async () => (calls++, list.shift()!)) as never,
      sleep: async () => {},
    })
    return { d: oneDrive(client, async (ms) => void waits.push(ms)), waits, calls: () => calls }
  }
  const failure = (status: number) => new Response('<html>An unexpected error has occurred.</html>', { status })

  it('tries again after a passing 401 from the download servers, and then succeeds', async () => {
    const { d, waits } = responses([failure(401), failure(401), failure(401), failure(401), new Response('{"ok":1}')]) // each try spends two 401s: the client renews the token once
    expect(new TextDecoder().decode(await d.get('f.json'))).toBe('{"ok":1}')
    expect(waits).toEqual([2000, 5000])
  })

  it('tries again when the file is not there yet', async () => {
    const { d } = responses([failure(404), new Response('x')])
    expect(new TextDecoder().decode(await d.get('f.json'))).toBe('x')
  })

  it('gives up after three tries, with the last error', async () => {
    const { d, waits } = responses([failure(401), failure(401), failure(401), failure(401), failure(401), failure(401), failure(401), failure(401)])
    await expect(d.get('f.json')).rejects.toThrow(/401/)
    expect(waits).toEqual([2000, 5000])
  })

  it('does not retry a real mistake', async () => {
    const { d, waits } = responses([failure(400)])
    await expect(d.get('f.json')).rejects.toThrow(/400/)
    expect(waits).toEqual([])
  })
})
