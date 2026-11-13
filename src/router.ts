// Hash routes (#/r/salads-007), so the app works as static files on any host without rewrites.

import { useEffect, useState } from 'react'

export type Route =
  | { name: 'library' }
  | { name: 'recipe'; id: string; logging?: true } // logging: open with the "I cooked it" form
  | { name: 'edit'; id: string }
  | { name: 'cook'; id: string }
  | { name: 'new' }
  | { name: 'plan'; week?: string }
  | { name: 'now' }
  | { name: 'print'; week?: string; tasks: boolean } // the week plan as a printable page
  | { name: 'import' }
  | { name: 'restore' }
  | { name: 'trash' }
  | { name: 'onenote' }

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  if (parts[0] === 'r' && parts[1]) {
    if (parts[2] === 'edit') return { name: 'edit', id: parts[1] }
    if (parts[2] === 'cook') return { name: 'cook', id: parts[1] }
    if (parts[2] === 'cooked') return { name: 'recipe', id: parts[1], logging: true }
    return { name: 'recipe', id: parts[1] }
  }
  if (parts[0] === 'new') return { name: 'new' }
  if (parts[0] === 'plan') return /^\d{4}-\d{2}-\d{2}$/.test(parts[1] ?? '') ? { name: 'plan', week: parts[1] } : { name: 'plan' }
  if (parts[0] === 'now') return { name: 'now' }
  if (parts[0] === 'print') {
    const week = /^\d{4}-\d{2}-\d{2}$/.test(parts[1] ?? '') ? parts[1] : undefined
    return { name: 'print', ...(week ? { week } : {}), tasks: parts.includes('tasks') }
  }
  if (parts[0] === 'import') return { name: 'import' }
  if (parts[0] === 'restore') return { name: 'restore' }
  if (parts[0] === 'trash') return { name: 'trash' }
  if (parts[0] === 'onenote') return { name: 'onenote' }
  return { name: 'library' }
}

export const href = {
  library: '#/',
  recipe: (id: string) => `#/r/${encodeURIComponent(id)}`,
  edit: (id: string) => `#/r/${encodeURIComponent(id)}/edit`,
  cook: (id: string) => `#/r/${encodeURIComponent(id)}/cook`,
  cooked: (id: string) => `#/r/${encodeURIComponent(id)}/cooked`,
  new: '#/new',
  plan: (week?: string) => (week ? `#/plan/${week}` : '#/plan'),
  now: '#/now',
  print: (week: string | undefined, tasks: boolean) => `#/print${week ? `/${week}` : ''}${tasks ? '/tasks' : ''}`,
  import: '#/import',
  restore: '#/restore',
  trash: '#/trash',
  onenote: '#/onenote',
}

// The app's own address, including the folder it is served from (e.g. /home-kitchen/ on GitHub
// Pages). Sign-in links and the Microsoft connection return here.
export const appHome = () => new URL(import.meta.env.BASE_URL, window.location.origin).href

export function navigate(to: string) {
  window.location.hash = to
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash))
  useEffect(() => {
    const update = () => {
      setRoute(parseHash(window.location.hash))
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return route
}
