// Minimal Microsoft Graph client for the OneNote calls the sync needs.
// OneNote allows 120 requests per minute and 400 per hour per user, and its 429 responses carry
// no Retry-After header, so retries use exponential backoff with jitter. Every write first checks
// that the target notebook is on the caller's allow list.

const GRAPH = 'https://graph.microsoft.com/v1.0/me/onenote'

export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number, // 0 for network failures
    readonly retryable: boolean,
    readonly body: string = '',
  ) {
    super(message)
    this.name = 'GraphError'
  }
}

export class NotAllowedError extends Error {
  constructor(readonly notebookId: string | null) {
    super(`writing to notebook ${notebookId ?? '(unknown)'} is not allowed`)
    this.name = 'NotAllowedError'
  }
}

export interface GraphDeps {
  // forceRefresh is set after a 401 so the token is renewed once before giving up.
  getAccessToken(forceRefresh: boolean): Promise<string>
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  maxAttempts?: number
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = 1000 * 2 ** attempt // 1s, 2s, 4s, 8s ...
  return Math.min(base, 30_000) + Math.floor(random() * 500)
}

export interface PageMeta {
  id: string
  title: string
  lastModifiedDateTime: string
  notebookId: string | null
  sectionId: string | null
  webUrl: string | null
  clientUrl: string | null
}

interface RawPage {
  id: string
  title?: string
  lastModifiedDateTime: string
  parentNotebook?: { id: string } | null
  parentSection?: { id: string } | null
  links?: { oneNoteWebUrl?: { href: string }; oneNoteClientUrl?: { href: string } }
}

function toMeta(raw: RawPage): PageMeta {
  return {
    id: raw.id,
    title: raw.title ?? '',
    lastModifiedDateTime: raw.lastModifiedDateTime,
    notebookId: raw.parentNotebook?.id ?? null,
    sectionId: raw.parentSection?.id ?? null,
    webUrl: raw.links?.oneNoteWebUrl?.href ?? null,
    clientUrl: raw.links?.oneNoteClientUrl?.href ?? null,
  }
}

// A notebook, or a section group inside one, that can hold the recipe pages.
export interface Place {
  kind: 'notebook' | 'sectionGroup'
  id: string
  notebookId: string
  notebookName: string
  // Section group names from the notebook down to this group; empty for a notebook.
  groupPath: string[]
}

interface RawGroup {
  id: string
  displayName: string
  parentNotebook?: { id: string; displayName: string } | null
  parentSectionGroup?: { id: string } | null
}

export interface PatchCommand {
  target: string
  action: 'replace' | 'append' | 'insert' | 'prepend'
  position?: 'before' | 'after'
  content: string
}

export class OneNoteClient {
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly random: () => number
  private readonly maxAttempts: number

  constructor(private readonly deps: GraphDeps) {
    this.fetchImpl = deps.fetch ?? fetch
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.random = deps.random ?? Math.random
    this.maxAttempts = deps.maxAttempts ?? 4
  }

  async request(method: string, path: string, init: { body?: string; contentType?: string } = {}): Promise<Response> {
    let refreshed = false
    for (let attempt = 0; ; attempt++) {
      const token = await this.deps.getAccessToken(refreshed)
      let response: Response
      try {
        response = await this.fetchImpl(`${GRAPH}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(init.contentType ? { 'Content-Type': init.contentType } : {}),
          },
          body: init.body,
        })
      } catch (error) {
        if (attempt + 1 >= this.maxAttempts) {
          throw new GraphError(`network error: ${(error as Error).message}`, 0, true)
        }
        await this.sleep(backoffMs(attempt, this.random))
        continue
      }

      if (response.ok) return response

      if (response.status === 401 && !refreshed) {
        refreshed = true
        attempt-- // a token refresh is not a failed attempt
        continue
      }

      const body = await response.text()
      const retryable = RETRYABLE_STATUS.has(response.status)
      if (!retryable || attempt + 1 >= this.maxAttempts) {
        throw new GraphError(`${method} ${path} failed with ${response.status}`, response.status, retryable, body)
      }
      await this.sleep(backoffMs(attempt, this.random))
    }
  }

  async getPageMeta(pageId: string): Promise<PageMeta> {
    const response = await this.request(
      'GET',
      `/pages/${encodeURIComponent(pageId)}?$select=id,title,lastModifiedDateTime,links&$expand=parentNotebook,parentSection`,
    )
    return toMeta((await response.json()) as RawPage)
  }

  async getPageContent(pageId: string): Promise<string> {
    const response = await this.request('GET', `/pages/${encodeURIComponent(pageId)}/content?includeIDs=true`)
    return response.text()
  }

  async createPage(sectionId: string, html: string): Promise<PageMeta> {
    const response = await this.request('POST', `/sections/${encodeURIComponent(sectionId)}/pages`, {
      body: html,
      contentType: 'text/html; charset=utf-8',
    })
    return toMeta((await response.json()) as RawPage)
  }

  async patchPage(pageId: string, commands: PatchCommand[]): Promise<void> {
    await this.request('PATCH', `/pages/${encodeURIComponent(pageId)}/content`, {
      body: JSON.stringify(commands),
      contentType: 'application/json',
    })
  }

  // Every item of a list, following OneNote's paging.
  private async listAll<T>(first: string): Promise<T[]> {
    const items: T[] = []
    let path: string | null = first
    while (path) {
      const response = await this.request('GET', path)
      const body = (await response.json()) as { value: T[]; '@odata.nextLink'?: string }
      items.push(...body.value)
      const next = body['@odata.nextLink']
      path = next ? next.slice(next.indexOf('/me/onenote') + '/me/onenote'.length) : null
    }
    return items
  }

  // Every page in a section (title, last change, links).
  async listSectionPages(sectionId: string): Promise<PageMeta[]> {
    const pages = await this.listAll<RawPage>(
      `/sections/${encodeURIComponent(sectionId)}/pages?$select=id,title,lastModifiedDateTime,links&$expand=parentNotebook,parentSection&$top=100`,
    )
    return pages.map(toMeta)
  }

  // The account's notebooks and section groups (GET /sectionGroups lists the nested ones too).
  async listPlaces(): Promise<Place[]> {
    const notebooks = await this.listAll<{ id: string; displayName: string }>('/notebooks?$select=id,displayName')
    const groups = await this.listAll<RawGroup>('/sectionGroups?$select=id,displayName&$expand=parentNotebook,parentSectionGroup')
    const byId = new Map(groups.map((group) => [group.id, group]))
    const pathOf = (group: RawGroup) => {
      const names: string[] = []
      for (let at: RawGroup | undefined = group; at && names.length < 20; at = at.parentSectionGroup ? byId.get(at.parentSectionGroup.id) : undefined) {
        names.unshift(at.displayName)
      }
      return names
    }
    return [
      ...notebooks.map((notebook) => ({ kind: 'notebook' as const, id: notebook.id, notebookId: notebook.id, notebookName: notebook.displayName, groupPath: [] })),
      ...groups
        .filter((group) => group.parentNotebook)
        .map((group) => ({
          kind: 'sectionGroup' as const,
          id: group.id,
          notebookId: group.parentNotebook!.id,
          notebookName: group.parentNotebook!.displayName,
          groupPath: pathOf(group),
        })),
    ]
  }

  // Every section in a notebook or section group, including the sections of section groups inside
  // it, which are named "group › section".
  async listPlaceSections(kind: Place['kind'], id: string, prefix = ''): Promise<Array<{ id: string; displayName: string }>> {
    const base = `${kind === 'notebook' ? '/notebooks' : '/sectionGroups'}/${encodeURIComponent(id)}`
    const sections = await this.listAll<{ id: string; displayName: string }>(`${base}/sections?$select=id,displayName`)
    const groups = await this.listAll<{ id: string; displayName: string }>(`${base}/sectionGroups?$select=id,displayName`)
    const all = sections.map((section) => ({ id: section.id, displayName: `${prefix}${section.displayName}` }))
    for (const group of groups) all.push(...(await this.listPlaceSections('sectionGroup', group.id, `${prefix}${group.displayName} › `)))
    return all
  }

  async findNotebook(displayName: string): Promise<{ id: string; displayName: string } | null> {
    const filter = encodeURIComponent(`displayName eq '${displayName.replace(/'/g, "''")}'`)
    const response = await this.request('GET', `/notebooks?$filter=${filter}&$select=id,displayName`)
    const { value } = (await response.json()) as { value: Array<{ id: string; displayName: string }> }
    return value[0] ?? null
  }

  async listSections(notebookId: string): Promise<Array<{ id: string; displayName: string }>> {
    const response = await this.request('GET', `/notebooks/${encodeURIComponent(notebookId)}/sections?$select=id,displayName`)
    return ((await response.json()) as { value: Array<{ id: string; displayName: string }> }).value
  }

  async createNotebook(displayName: string): Promise<{ id: string; displayName: string }> {
    const response = await this.request('POST', '/notebooks', {
      body: JSON.stringify({ displayName }),
      contentType: 'application/json',
    })
    return (await response.json()) as { id: string; displayName: string }
  }

  async createSection(notebookId: string, displayName: string): Promise<{ id: string; displayName: string }> {
    const response = await this.request('POST', `/notebooks/${encodeURIComponent(notebookId)}/sections`, {
      body: JSON.stringify({ displayName }),
      contentType: 'application/json',
    })
    return (await response.json()) as { id: string; displayName: string }
  }
}

// What the app may do in the recipe library (the section group «الطبخ»): read pages and create new
// ones. There is deliberately no way to change or delete an existing page through this type.
export type ReadCreateGraph = Pick<OneNoteClient, 'getPageMeta' | 'getPageContent' | 'createPage' | 'listPlaces' | 'listPlaceSections' | 'listSectionPages'>

// Wraps a client so that only the read/create methods exist at run time too.
export function readCreateOnly(client: OneNoteClient): ReadCreateGraph {
  return {
    getPageMeta: (id) => client.getPageMeta(id),
    getPageContent: (id) => client.getPageContent(id),
    createPage: (sectionId, html) => client.createPage(sectionId, html),
    listPlaces: () => client.listPlaces(),
    listPlaceSections: (kind, id) => client.listPlaceSections(kind, id),
    listSectionPages: (id) => client.listSectionPages(id),
  }
}

export function assertWritable(notebookId: string | null, allowedNotebookIds: readonly string[]): void {
  if (!notebookId || !allowedNotebookIds.includes(notebookId)) throw new NotAllowedError(notebookId)
}
