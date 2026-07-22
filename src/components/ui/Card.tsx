import type { HTMLAttributes } from 'react'
import { type Tone, toneStyles } from './tokens'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: Tone
  padding?: 'normal' | 'compact'
}

// The bordered-card shape already used everywhere (request rows, line
// rows, Sera kutilmoqda's amber card) — formalized so tone (neutral/
// pending/problem/ok) is one prop instead of a hand-picked class string
// per screen.
export function Card({ tone = 'neutral', padding = 'normal', className, children, ...rest }: CardProps) {
  const t = toneStyles[tone]
  return (
    <div
      className={[
        'rounded-md border',
        padding === 'compact' ? 'p-2' : 'p-3',
        t.border,
        t.bg,
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </div>
  )
}
