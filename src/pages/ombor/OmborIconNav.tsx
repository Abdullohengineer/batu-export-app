import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'

// Bottom icon bar (2026-08-15) — replaces RoleTabs' horizontally-scrolling
// top-tab bar FOR OMBOR ONLY. RoleTabs/RoleShell are shared with Qorovul and
// Laborator (see their own header comments), so this is a new, Ombor-local
// component rather than an edit to either — one-handed phone use on a
// factory floor, bottom placement so the primary hand's thumb reaches every
// tab, top placement doesn't. RoleShell's `nav` slot is simply left unset
// for Ombor now (it already no-ops when omitted); the active section's name
// goes in RoleShell's `title` instead, computed by the caller (OmborHome).
export type OmborNavTone = 'kirim' | 'chiqim' | 'moyka' | 'neutral'

export interface OmborNavItem {
  to: string
  label: string
  end?: boolean
  icon: ReactNode
  tone: OmborNavTone
  // Items waiting for Ombor to act in this section, or undefined where the
  // section has no such queue (Hisobotlar) — undefined renders no badge at
  // all, 0 renders no badge either (nothing waiting isn't worth a badge).
  count?: number
}

// Direction colours (task spec): green = entering (KIRIM), red = leaving
// (CHIQIM) — reusing this app's existing emerald/red families (tokens.ts
// `ok`/`problem`), not inventing new shades. Moyka sections (send-to-wash,
// finished-goods holding) get the existing `info` blue — material is still
// inside the factory, matching why RahbarHome colours yo'qotish slate/black
// rather than red ("material that left the factory" is the only thing red
// means there too). Hisobotlar isn't material movement at all, so it's
// plain neutral slate, same family the rest of the app uses for non-status
// numbers.
const toneClasses: Record<OmborNavTone, { active: string; inactive: string }> = {
  kirim: {
    active: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
    inactive: 'text-emerald-600/80 dark:text-emerald-500/80',
  },
  chiqim: {
    active: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400',
    inactive: 'text-red-600/80 dark:text-red-500/80',
  },
  moyka: {
    active: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
    inactive: 'text-blue-600/80 dark:text-blue-500/80',
  },
  neutral: {
    active: 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100',
    inactive: 'text-slate-500 dark:text-slate-400',
  },
}

export function OmborIconNav({ items }: { items: OmborNavItem[] }) {
  return (
    <nav
      aria-label="Ombor bo'limlari"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="mx-auto flex max-w-5xl">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              [
                'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-center text-[11px] font-medium transition-colors',
                isActive ? toneClasses[item.tone].active : toneClasses[item.tone].inactive,
                !isActive && 'hover:bg-slate-50 dark:hover:bg-slate-800/60',
              ]
                .filter(Boolean)
                .join(' ')
            }
          >
            <span className="relative flex h-6 w-6 items-center justify-center">
              {item.icon}
              {!!item.count && (
                <span
                  aria-hidden="true"
                  className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-600 px-1 text-[10px] font-semibold leading-none text-white"
                >
                  {item.count > 99 ? '99+' : item.count}
                </span>
              )}
            </span>
            <span className="max-w-full px-0.5 text-center leading-[1.15] break-words">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
