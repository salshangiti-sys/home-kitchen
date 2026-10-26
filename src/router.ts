// Hash routes (#/r/salads-007), so the app works as static files on any host without rewrites.

import { useEffect, useState } from 'react'

export type Route =
  | { name: 'library' }
  | { name: 'recipe'; id: string }
  | { name: 'edit'; id: string }
  | { name: 'new' }
  | { name: 'import' }
  | { name: 'onenote' }
  | { name: 'lab' }

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  if (parts[0] === 'r' && parts[1]) return parts[2] === 'edit' ? { name: 'edit', id: parts[1] } : { name: 'recipe', id: parts[1] }
  if (parts[0] === 'new') return { name: 'new' }
  if (parts[0] === 'import') return { name: 'import' }
  if (parts[0] === 'onenote') return { name: 'onenote' }
  if (parts[0] === 'lab') return { name: 'lab' }
  return { name: 'library' }
}

export const href = {
  library: '#/',
  recipe: (id: string) => `#/r/${encodeURIComponent(id)}`,
  edit: (id: string) => `#/r/${encodeURIComponent(id)}/edit`,
  new: '#/new',
  import: '#/import',
  onenote: '#/onenote',
  lab: '#/lab',
}

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
