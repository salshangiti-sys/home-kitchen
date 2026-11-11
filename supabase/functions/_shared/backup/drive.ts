// The backup's folder in the owner's OneDrive: the app folder (Apps/<app name>), which the app's
// Microsoft permission (Files.ReadWrite.AppFolder) is limited to. The app can see nothing else in
// OneDrive. Uses the same Graph client as OneNote, pointed at the drive.

import type { Drive, DriveFile } from './backup.ts'
import { OneNoteClient } from '../onenote/graph.ts'

export const DRIVE_BASE = 'https://graph.microsoft.com/v1.0/me/drive'

const at = (name: string) => `/special/approot:/${encodeURIComponent(name)}`

export function oneDrive(client: OneNoteClient): Drive {
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
      const response = await client.request('GET', `${at(name)}:/content`)
      return new Uint8Array(await response.arrayBuffer())
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
  }
}
