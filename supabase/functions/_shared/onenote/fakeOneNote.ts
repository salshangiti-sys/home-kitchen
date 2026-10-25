// A simulated OneNote for tests (not part of the Edge Function bundle).

import { parseHTML } from 'linkedom'
import { GraphError, type PageMeta, type PatchCommand } from './graph.ts'
import type { PageGraph } from './engine.ts'

interface FakePage {
  notebookId: string
  sectionId: string
  html: string
  lastModified: number
}

type Dom = ReturnType<typeof parseHTML>['document']

// Behaves like OneNote where the probes showed it: generated ids on every element it can update,
// single-element replace and insert, an empty paragraph removing the line it replaces, and
// refusals (400) for a missing target, for replacing a div, and for empty content. It does not
// model how OneNote regroups data-id parts.
export class FakeOneNote implements PageGraph {
  pages = new Map<string, FakePage>()
  failNext: Error[] = []
  calls: string[] = []
  patches: PatchCommand[][] = []
  private seq = 0
  private clock = 1000

  constructor(private readonly sectionNotebook: Record<string, string>) {}

  private take(call: string) {
    this.calls.push(call)
    const error = this.failNext.shift()
    if (error) throw error
  }

  private meta(id: string): PageMeta {
    const page = this.pages.get(id)
    if (!page) throw new GraphError('not found', 404, false)
    const title = page.html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''
    return {
      id,
      title: title.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
      lastModifiedDateTime: new Date(page.lastModified).toISOString(),
      notebookId: page.notebookId,
      sectionId: page.sectionId,
      webUrl: `https://onenote.example/${id}`,
      clientUrl: `onenote:${id}`,
    }
  }

  private withIds(document: Dom): string {
    for (const el of Array.from(document.querySelectorAll('div, h1, h2, h3, h4, h5, h6, p, ul, ol, li'))) {
      if (!el.getAttribute('id')) el.setAttribute('id', `${el.tagName.toLowerCase()}:{fake}{${++this.seq}}`)
    }
    return document.toString()
  }

  private refuse(code: string): never {
    throw new GraphError('PATCH failed with 400', 400, false, `{"error":{"code":"${code}"}}`)
  }

  private apply(html: string, command: PatchCommand): string {
    if (!command.content) this.refuse('20121')
    if (command.target === 'title') {
      return html.replace(/<title>[\s\S]*?<\/title>/, `<title>${command.content}</title>`)
    }
    const { document } = parseHTML(html)
    const target =
      command.target === 'body'
        ? document.body
        : command.target.startsWith('#')
          ? document.querySelector(`[data-id="${command.target.slice(1)}"]`)
          : document.querySelector(`[id="${command.target}"]`)
    if (!target) this.refuse('20120')
    const holder = document.createElement('div')
    holder.innerHTML = command.content
    const nodes = Array.from(holder.childNodes)
    if (command.action === 'replace') {
      if (target.tagName === 'DIV') this.refuse('20141')
      // An empty paragraph does not survive: replacing a line with one removes the line.
      const kept = nodes.filter((node) => !(node.nodeName === 'P' && !node.textContent))
      if (kept.length) target.replaceWith(...kept)
      else target.remove()
    } else if (command.action === 'insert') {
      if (command.position === 'before') target.before(...nodes)
      else target.after(...nodes)
    } else {
      target.append(...nodes)
    }
    return this.withIds(document)
  }

  async createPage(sectionId: string, html: string) {
    this.take('createPage')
    const id = `page-${++this.seq}`
    const page = { notebookId: this.sectionNotebook[sectionId], sectionId, html: this.withIds(parseHTML(html).document), lastModified: ++this.clock }
    this.pages.set(id, page)
    return this.meta(id)
  }

  async getPageMeta(pageId: string) {
    this.take('getPageMeta')
    return this.meta(pageId)
  }

  async getPageContent(pageId: string) {
    this.take('getPageContent')
    const page = this.pages.get(pageId)
    if (!page) throw new GraphError('not found', 404, false)
    return page.html
  }

  async patchPage(pageId: string, commands: PatchCommand[]) {
    this.take('patchPage')
    this.patches.push(commands)
    const page = this.pages.get(pageId)!
    // A request is applied whole or not at all.
    page.html = commands.reduce((html, command) => this.apply(html, command), page.html)
    page.lastModified = ++this.clock
  }

  // Someone edits the page by hand in a OneNote app.
  editByHand(pageId: string, edit: (html: string) => string) {
    const page = this.pages.get(pageId)!
    page.html = this.withIds(parseHTML(edit(page.html)).document)
    page.lastModified = ++this.clock
  }
}
