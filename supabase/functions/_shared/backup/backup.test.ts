// @vitest-environment node
import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'
import schema from '../../../../schema/recipe.schema.json'
import { LINK_ONLY, SALAD } from '../../../../src/library/fixtures'
import { OneNoteClient } from '../onenote/graph.ts'
import {
  KEEP_BACKUPS,
  backupName,
  buildBackupFile,
  filesToRemove,
  isBackupName,
  runBackup,
  type Bundle,
  type Drive,
  type DriveFile,
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
