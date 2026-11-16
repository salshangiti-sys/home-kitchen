// Small shared building blocks for the screens.

import type { ReactNode } from 'react'
import { tintFor } from './tints'

export function Card({ title, children, actions }: { title?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-3xl bg-surface p-5 shadow-sm ring-1 ring-line">
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

type Kind = 'primary' | 'plain' | 'danger'

const LOOKS: Record<Kind, string> = {
  primary: 'bg-accent text-on-accent shadow-sm',
  plain: 'border border-line text-ink',
  danger: 'border border-red-600 text-red-700 dark:text-red-400',
}

export function Button({
  children,
  onClick,
  disabled,
  kind = 'primary',
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  kind?: Kind
  type?: 'button' | 'submit'
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`min-h-11 rounded-2xl px-4 text-sm font-medium disabled:opacity-50 ${LOOKS[kind]}`}>
      {children}
    </button>
  )
}

export function LinkButton({ href, children, kind = 'plain', external }: { href: string; children: ReactNode; kind?: Kind; external?: boolean }) {
  return (
    <a href={href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})} className={`inline-flex min-h-11 items-center rounded-2xl px-4 text-sm font-medium ${LOOKS[kind]}`}>
      {children}
    </a>
  )
}

// `tint` names a section or tag: it then gets that name's own soft colour, the same everywhere.
export function Badge({ children, tone = 'plain', tint }: { children: ReactNode; tone?: 'plain' | 'warn' | 'accent'; tint?: string }) {
  if (tint) return <span dir="auto" className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tintFor(tint)}`}>{children}</span>
  const look =
    tone === 'warn'
      ? 'border-amber-500 text-amber-800 dark:text-amber-300'
      : tone === 'accent'
        ? 'border-transparent bg-accent-soft text-accent'
        : 'border-line text-muted'
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${look}`}>{children}</span>
}

export function Notice({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'error' }) {
  return (
    <p dir="auto" className={`whitespace-pre-line rounded-xl border p-3 text-sm ${tone === 'error' ? 'border-red-600 text-red-700 dark:text-red-400' : 'border-line'}`}>
      {children}
    </p>
  )
}
