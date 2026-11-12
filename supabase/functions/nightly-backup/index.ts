// Backs the app's data up to the owner's OneDrive (the app folder), then reads the file back and
// checks it. Called by the nightly timer (pg_cron), which presents a secret token kept in the
// database, or by the signed-in owner for "back up now". Anyone else is refused.
//
// Each run is logged in backup_runs, which the app shows on its OneNote screen.

import AjvModule from 'ajv/dist/2020'
import { HttpError, adminClient, corsHeaders, json, oauthConfig, requireUser } from '../_shared/server/http.ts'
import { accessTokenProvider } from '../_shared/server/tokens.ts'
import { OneNoteClient } from '../_shared/onenote/graph.ts'
import { MANUAL_MIN_GAP_MS, runBackup, type Bundle, type PhotoFile } from '../_shared/backup/backup.ts'
import { DRIVE_BASE, oneDrive } from '../_shared/backup/drive.ts'
import { recipeChecker } from '../_shared/backup/recipeCheck.ts'

// Deno and Node load this CommonJS library differently.
const Ajv = ((AjvModule as unknown as { default?: unknown }).default ?? AjvModule) as never
const check = recipeChecker(Ajv)

type Trigger = 'schedule' | 'manual'

async function backUp(admin: ReturnType<typeof adminClient>, householdId: string, userId: string, connected: boolean, trigger: Trigger) {
  const { data: started, error: startError } = await admin.from('backup_runs').insert({ household_id: householdId, trigger }).select('id').single()
  if (startError) throw new Error(`could not log the run: ${startError.message}`)

  const record = connected
    ? await runBackup({
        bundle: async () => {
          const { data, error } = await admin.rpc('backup_bundle', { p_household: householdId })
          if (error) throw new Error(`could not read the data: ${error.message}`)
          return data as Bundle
        },
        drive: oneDrive(new OneNoteClient({ baseUrl: DRIVE_BASE, getAccessToken: accessTokenProvider(admin, userId, oauthConfig()) })),
        check,
        now: () => new Date(),
        photos: {
          // Photos that are still shown in the app (a removed photo is not copied again).
          list: async () => {
            const { data, error } = await admin.from('recipe_photos').select('id,path,bytes').eq('household_id', householdId).is('deleted_at', null).order('created_at')
            if (error) throw new Error(`could not list the photos: ${error.message}`)
            return data as PhotoFile[]
          },
          read: async (path) => {
            const { data, error } = await admin.storage.from('recipe-photos').download(path)
            if (error || !data) throw new Error(`could not read a photo from storage: ${error?.message ?? 'empty'}`)
            return new Uint8Array(await data.arrayBuffer())
          },
        },
      })
    : { ok: false, verified: false, old_files_removed: 0, file_name: null, error: 'Microsoft account is not connected: sign in again from the OneNote page' }

  await admin
    .from('backup_runs')
    .update({ ...record, finished_at: new Date().toISOString() })
    .eq('id', started.id)
  return { household_id: householdId, ok: record.ok, verified: record.verified, file_name: record.file_name, error: record.error }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(req) })
  try {
    const admin = adminClient()
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: scheduled, error } = await admin.rpc('check_backup_token', { p_token: token })
    if (error) throw new Error(error.message)

    const owners = admin.from('household_members').select('household_id,user_id').eq('role', 'owner')
    let trigger: Trigger = 'schedule'
    let targets: Array<{ household_id: string; user_id: string }>
    if (scheduled === true) {
      targets = (await owners).data ?? []
    } else {
      const { user } = await requireUser(req)
      const mine = (await owners.eq('user_id', user.id)).data ?? []
      if (!mine.length) throw new HttpError(403, 'only the owner can back up', 'forbidden')
      const { data: last } = await admin.from('backup_runs').select('started_at').eq('household_id', mine[0].household_id).order('started_at', { ascending: false }).limit(1).maybeSingle()
      if (last && Date.now() - Date.parse(last.started_at) < MANUAL_MIN_GAP_MS) {
        throw new HttpError(429, 'a backup ran a few minutes ago; try again in a little while', 'too_soon')
      }
      trigger = 'manual'
      targets = mine
    }

    const { data: connections } = await admin.from('ms_connections').select('user_id,status').in('user_id', targets.map((t) => t.user_id))
    const connected = new Set((connections ?? []).filter((c) => c.status === 'connected').map((c) => c.user_id))

    const results = []
    for (const target of targets) {
      results.push(await backUp(admin, target.household_id, target.user_id, connected.has(target.user_id), trigger))
    }
    return json(req, { results })
  } catch (error) {
    if (error instanceof HttpError) return json(req, { error: error.message, code: error.code }, error.status)
    console.error('nightly-backup failed', error)
    return json(req, { error: (error as Error).message, code: 'error' }, 500)
  }
})
