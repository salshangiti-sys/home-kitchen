// The backup's folder in the owner's OneDrive: the app folder (Apps/<app name>), which the app's
// Microsoft permission (Files.ReadWrite.AppFolder) is limited to. The app can see nothing else in
// OneDrive. Uses the same Graph client as OneNote, pointed at the drive.

import type { Drive, DriveFile, PhotoDrive } from './backup.ts'
import { OneNoteClient } from '../onenote/graph.ts'

export const DRIVE_BASE = 'https://graph.microsoft.com/v1.0/me/drive'

const at = (name: string) => `/special/approot:/${encodeURIComponent(name)}`

// Statuses worth another try when reading a file back: a file just written can be briefly missing
// (404), and OneDrive's servers sometimes answer a good request with a passing 401/403 or a server
// error (seen with an HTML "unexpected error" page). One more try only: every failed Graph call can
// take 25 seconds, and the whole run has 150.
const PASSING = (status: number | undefined) => status === 401 || status === 403 || status === 404 || (status !== undefined && status >= 500)
const RETRY_WAITS_MS = [2000]

interface Extras {
  sleep?: (ms: number) => Promise<void>
  // Used for the temporary download address (which needs no sign-in header).
  fetch?: typeof fetch
}

export function oneDrive(client: OneNoteClient, extras: Extras = {}): Drive & PhotoDrive {
  const sleep = extras.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const plainFetch = extras.fetch ?? fetch
  // The file's own pre-signed, short-lived download address (documented: @microsoft.graph.downloadUrl).
  const downloadUrl = async (name: string): Promise<string | null> => {
    // The item itself carries the address (asking for it with $select leaves it out: seen in the real answer).
    const response = await client.request('GET', at(name))
    return ((await response.json()) as { '@microsoft.graph.downloadUrl'?: string })['@microsoft.graph.downloadUrl'] ?? null
  }
  return {
    async folderName() {
      const response = await client.request('GET', '/special/approot?$select=name')
      return ((await response.json()) as { name: string }).name
    },

    async put(name, text) {
      type Item = { size?: number; file?: { hashes?: { sha1Hash?: string } } } | null
      const response = await client.request('PUT', `${at(name)}:/content`, { body: text, contentType: 'application/json; charset=utf-8' })
      let item = (await response.json().catch(() => null)) as Item
      // OneDrive can add the hash a moment after the upload: ask once more for the file's details.
      if (typeof item?.size === 'number' && !item.file?.hashes?.sha1Hash) {
        await sleep(1500)
        const details = await client.request('GET', at(name)).then((r) => r.json() as Promise<Item>, () => null)
        if (details?.file?.hashes?.sha1Hash) item = details
      }
      return typeof item?.size === 'number' ? { size: item.size, sha1: item.file?.hashes?.sha1Hash ?? null } : undefined
    },

    // Reads a file through its own download address, which needs no sign-in header. If that does not
    // work, through Graph's /content route (which redirects to a download address). Both routes are
    // tried again once after a passing error. A failure says what each route answered.
    async get(name) {
      for (let attempt = 0; ; attempt++) {
        const notes: string[] = []
        try {
          const url = await downloadUrl(name)
          if (url) {
            try {
              const direct = await plainFetch(url)
              if (direct.ok) return new Uint8Array(await direct.arrayBuffer())
              notes.push(`download address: ${direct.status}`)
            } catch (error) {
              notes.push(`download address: ${(error as Error).message}`)
            }
          } else {
            notes.push('download address: none given')
          }
          const response = await client.request('GET', `${at(name)}:/content`)
          return new Uint8Array(await response.arrayBuffer())
        } catch (error) {
          const status = (error as { status?: number }).status
          if (attempt < RETRY_WAITS_MS.length && PASSING(status)) {
            await sleep(RETRY_WAITS_MS[attempt])
            continue
          }
          if (notes.length) (error as Error).message += ` [${notes.join('; ')}]`
          throw error
        }
      }
    },

    async list() {
      const files: DriveFile[] = []
      let path: string | null = '/special/approot/children?$select=id,name&$top=200'
      while (path) {
        const body = (await (await client.request('GET', path)).json()) as { value: DriveFile[]; '@odata.nextLink'?: string }
        files.push(...body.value)
        const next = body['@odata.nextLink']
        path = next ? next.slice(next.indexOf('/me/drive') + '/me/drive'.length) : null
      }
      return files
    },

    async remove(id) {
      await client.request('DELETE', `/items/${encodeURIComponent(id)}`)
    },

    // The photos folder (OneDrive creates it with the first photo, and the folders in a path).
    async photoNames() {
      const names = new Set<string>()
      let path: string | null = '/special/approot:/photos:/children?$select=name&$top=200'
      while (path) {
        let body: { value: Array<{ name: string }>; '@odata.nextLink'?: string }
        try {
          body = (await (await client.request('GET', path)).json()) as typeof body
        } catch (error) {
          if ((error as { status?: number }).status === 404) return names // nothing copied yet
          throw error
        }
        for (const item of body.value) names.add(item.name)
        const next = body['@odata.nextLink']
        path = next ? next.slice(next.indexOf('/me/drive') + '/me/drive'.length) : null
      }
      return names
    },

    async putPhoto(name, bytes) {
      const response = await client.request('PUT', `/special/approot:/photos/${encodeURIComponent(name)}:/content`, { body: bytes, contentType: 'image/jpeg' })
      const item = (await response.json()) as { size: number; file?: { hashes?: { sha1Hash?: string } } }
      return { size: item.size, sha1: item.file?.hashes?.sha1Hash ?? null }
    },
  }
}
