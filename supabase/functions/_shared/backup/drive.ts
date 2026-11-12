// The backup's folder in the owner's OneDrive: the app folder (Apps/<app name>), which the app's
// Microsoft permission (Files.ReadWrite.AppFolder) is limited to. The app can see nothing else in
// OneDrive. Uses the same Graph client as OneNote, pointed at the drive.

import type { Drive, DriveFile, PhotoDrive } from './backup.ts'
import { OneNoteClient } from '../onenote/graph.ts'

export const DRIVE_BASE = 'https://graph.microsoft.com/v1.0/me/drive'

const at = (name: string) => `/special/approot:/${encodeURIComponent(name)}`

// Statuses worth another try when reading a file back: a file just written can be briefly missing
// (404), and OneDrive's download servers sometimes answer a good request with a passing 401/403 or
// a server error (seen once, with an HTML "unexpected error" page).
const PASSING = (status: number | undefined) => status === 401 || status === 403 || status === 404 || (status !== undefined && status >= 500)
const RETRY_WAITS_MS = [2000, 5000]

export function oneDrive(client: OneNoteClient, sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))): Drive & PhotoDrive {
  return {
    async folderName() {
      const response = await client.request('GET', '/special/approot?$select=name')
      return ((await response.json()) as { name: string }).name
    },

    async put(name, text) {
      await client.request('PUT', `${at(name)}:/content`, { body: text, contentType: 'application/json; charset=utf-8' })
    },

    async get(name) {
      // OneDrive answers with a redirect to a temporary download address; fetch follows it.
      for (let attempt = 0; ; attempt++) {
        try {
          const response = await client.request('GET', `${at(name)}:/content`)
          return new Uint8Array(await response.arrayBuffer())
        } catch (error) {
          if (attempt >= RETRY_WAITS_MS.length || !PASSING((error as { status?: number }).status)) throw error
          await sleep(RETRY_WAITS_MS[attempt])
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
