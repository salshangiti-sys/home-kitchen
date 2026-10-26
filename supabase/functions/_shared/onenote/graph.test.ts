import { describe, expect, it, vi } from 'vitest'
import { GraphError, NotAllowedError, OneNoteClient, assertWritable, backoffMs, readCreateOnly } from './graph.ts'

function client(
  responses: Array<Response | Error>,
  tokens = vi.fn(async (_force: boolean): Promise<string> => 'token'),
) {
  const fetchMock = vi.fn(async () => {
    const next = responses.shift()
    if (!next) throw new Error('no more responses')
    if (next instanceof Error) throw next
    return next
  })
  const sleep = vi.fn(async () => {})
  const graph = new OneNoteClient({
    getAccessToken: tokens,
    fetch: fetchMock as unknown as typeof fetch,
    sleep,
    random: () => 0,
  })
  return { graph, fetchMock, sleep, tokens }
}

const pageJson = () =>
  new Response(
    JSON.stringify({
      id: 'p1',
      title: 'كبسة',
      lastModifiedDateTime: '2026-10-24T10:00:00Z',
      parentNotebook: { id: 'nb-test' },
      parentSection: { id: 's1' },
      links: { oneNoteWebUrl: { href: 'https://web' }, oneNoteClientUrl: { href: 'onenote:x' } },
    }),
    { status: 200 },
  )

const list = (value: unknown[], next?: string) =>
  new Response(JSON.stringify({ value, ...(next ? { '@odata.nextLink': next } : {}) }), { status: 200 })

describe('notebooks and section groups', () => {
  it('lists section groups with their path in the notebook, nested ones too', async () => {
    const { graph, fetchMock } = client([
      list([{ id: 'nb1', displayName: 'البيت والطبخ' }]),
      list(
        [
          { id: 'g1', displayName: 'الطبخ', parentNotebook: { id: 'nb1', displayName: 'البيت والطبخ' }, parentSectionGroup: null },
          { id: 'g2', displayName: 'حلويات', parentNotebook: { id: 'nb1', displayName: 'البيت والطبخ' }, parentSectionGroup: { id: 'g1' } },
        ],
        'https://graph.microsoft.com/v1.0/me/onenote/sectionGroups?$skip=2',
      ),
      list([]),
    ])
    expect(await graph.listPlaces()).toEqual([
      { kind: 'notebook', id: 'nb1', notebookId: 'nb1', notebookName: 'البيت والطبخ', groupPath: [] },
      { kind: 'sectionGroup', id: 'g1', notebookId: 'nb1', notebookName: 'البيت والطبخ', groupPath: ['الطبخ'] },
      { kind: 'sectionGroup', id: 'g2', notebookId: 'nb1', notebookName: 'البيت والطبخ', groupPath: ['الطبخ', 'حلويات'] },
    ])
    expect((fetchMock.mock.calls as unknown as string[][])[2][0]).toBe('https://graph.microsoft.com/v1.0/me/onenote/sectionGroups?$skip=2')
  })

  it('lists every section in a section group, naming nested ones by their group', async () => {
    const { graph, fetchMock } = client([
      list([{ id: 's1', displayName: 'سلطات' }]),
      list([{ id: 'g2', displayName: 'حلويات' }]),
      list([{ id: 's2', displayName: 'كيك' }]),
      list([]),
    ])
    expect(await graph.listPlaceSections('sectionGroup', 'g1')).toEqual([
      { id: 's1', displayName: 'سلطات' },
      { id: 's2', displayName: 'حلويات › كيك' },
    ])
    expect((fetchMock.mock.calls as unknown as string[][]).map((call) => String(call[0]).replace('https://graph.microsoft.com/v1.0/me/onenote', ''))).toEqual([
      '/sectionGroups/g1/sections?$select=id,displayName',
      '/sectionGroups/g1/sectionGroups?$select=id,displayName',
      '/sectionGroups/g2/sections?$select=id,displayName',
      '/sectionGroups/g2/sectionGroups?$select=id,displayName',
    ])
  })
})

describe('OneNoteClient', () => {
  it('maps page metadata', async () => {
    const { graph } = client([pageJson()])
    expect(await graph.getPageMeta('p1')).toEqual({
      id: 'p1',
      title: 'كبسة',
      lastModifiedDateTime: '2026-10-24T10:00:00Z',
      notebookId: 'nb-test',
      sectionId: 's1',
      webUrl: 'https://web',
      clientUrl: 'onenote:x',
    })
  })

  it('backs off and retries on 429, then succeeds', async () => {
    const { graph, sleep, fetchMock } = client([new Response('', { status: 429 }), new Response('', { status: 503 }), pageJson()])
    await graph.getPageMeta('p1')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls.map((c) => (c as unknown as [number])[0])).toEqual([1000, 2000])
  })

  it('gives up after the last attempt with a retryable error', async () => {
    const { graph } = client(Array.from({ length: 4 }, () => new Response('busy', { status: 429 })))
    const error = await graph.getPageMeta('p1').catch((e) => e)
    expect(error).toBeInstanceOf(GraphError)
    expect(error.status).toBe(429)
    expect(error.retryable).toBe(true)
  })

  it('retries network failures', async () => {
    const { graph, fetchMock } = client([new TypeError('offline'), pageJson()])
    await graph.getPageMeta('p1')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('refreshes the token once after a 401', async () => {
    const tokens = vi.fn(async (force: boolean): Promise<string> => (force ? 'fresh' : 'stale'))
    const { graph, fetchMock } = client([new Response('', { status: 401 }), pageJson()], tokens)
    await graph.getPageMeta('p1')
    expect(tokens.mock.calls).toEqual([[false], [true]])
    const headers = (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer fresh')
  })

  it('does not retry a 404 and reports it as not retryable', async () => {
    const { graph, fetchMock } = client([new Response('gone', { status: 404 })])
    const error = await graph.getPageMeta('p1').catch((e) => e)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(error.status).toBe(404)
    expect(error.retryable).toBe(false)
  })

  it('sends section updates as JSON change commands', async () => {
    const { graph, fetchMock } = client([new Response(null, { status: 204 })])
    await graph.patchPage('p1', [{ target: 'div:{a}{1}', action: 'replace', content: '<div data-id="hk-steps"></div>' }])
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://graph.microsoft.com/v1.0/me/onenote/pages/p1/content')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)[0].target).toBe('div:{a}{1}')
  })
})

describe('backoffMs', () => {
  it('doubles and caps the delay', () => {
    expect([0, 1, 2, 3, 10].map((n) => backoffMs(n, () => 0))).toEqual([1000, 2000, 4000, 8000, 30000])
  })
})

describe('assertWritable', () => {
  it('allows only notebooks on the allow list', () => {
    expect(() => assertWritable('nb-test', ['nb-test'])).not.toThrow()
    expect(() => assertWritable('nb-real-recipes', ['nb-test'])).toThrow(NotAllowedError)
    expect(() => assertWritable(null, ['nb-test'])).toThrow(NotAllowedError)
  })

  it('lists a section\'s pages across OneNote\'s pages of results', async () => {
    const page = (id: string) => ({ id, title: id, lastModifiedDateTime: 't', parentNotebook: { id: 'nb' }, parentSection: { id: 's1' } })
    const { graph, fetchMock } = client([
      new Response(JSON.stringify({ value: [page('a'), page('b')], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/onenote/sections/s1/pages?$skip=2' }), { status: 200 }),
      new Response(JSON.stringify({ value: [page('c')] }), { status: 200 }),
    ])
    const pages = await graph.listSectionPages('s1')
    expect(pages.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect((fetchMock.mock.calls[1] as unknown as [string])[0]).toBe('https://graph.microsoft.com/v1.0/me/onenote/sections/s1/pages?$skip=2')
  })

  it('offers no way to change a page through the read/create client', () => {
    const { graph } = client([])
    expect(Object.keys(readCreateOnly(graph)).sort()).toEqual(['createPage', 'getPageContent', 'getPageMeta', 'listPlaceSections', 'listPlaces', 'listSectionPages'])
  })
})
