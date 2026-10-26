// Small shared building blocks for the screens.

import type { ReactNode } from 'react'

export function Card({ title, children, actions }: { title?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
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
  primary: 'bg-accent text-on-accent',
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
    <button type={type} onClick={onClick} disabled={disabled} className={`min-h-11 rounded-xl px-4 text-sm font-medium disabled:opacity-50 ${LOOKS[kind]}`}>
      {children}
    </button>
  )
}

export function LinkButton({ href, children, kind = 'plain', external }: { href: string; children: ReactNode; kind?: Kind; external?: boolean }) {
  return (
    <a href={href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})} className={`inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-medium ${LOOKS[kind]}`}>
      {children}
    </a>
  )
}

export function Badge({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'warn' | 'accent' }) {
  const look =
    tone === 'warn'
      ? 'border-amber-500 text-amber-800 dark:text-amber-300'
      : tone === 'accent'
        ? 'border-accent text-accent'
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
