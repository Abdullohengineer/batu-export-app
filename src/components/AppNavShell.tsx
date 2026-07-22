import { useState, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'
import { IconButton } from './ui/IconButton'
import { Button } from './ui/Button'
import { touch } from './ui/tokens'

// Responsive nav shell (mockup "BATU-Manager-Screens-MASTER.pdf", nav
// restructure prompt): mobile gets a hamburger opening a drawer, desktop
// gets a persistent left sidebar. One component, no separate mobile/
// desktop component pair -- the same `navItems` array feeds both, and only
// one of the two is ever actually IN THE DOM at a time (the drawer's
// contents are conditionally rendered on `open`, not just CSS-hidden) so
// there's never a duplicate accessible "CHIQIM"/"KIRIM" link for e2e's
// getByRole('link', ...) to trip over.
//
// Built under components/ (not menejer/) specifically so later prompts can
// point another role's layout at this same component -- per the task's own
// "build it reusably" instruction. Only Menejer adopts it this prompt;
// every other role keeps RoleShell/RoleTabs untouched.
export interface NavItem {
  to: string
  label: string
  end?: boolean
}

function navLinkClass({ isActive }: { isActive: boolean }) {
  return [
    'flex items-center rounded-md px-3 text-sm font-medium transition-colors',
    touch.secondary,
    isActive
      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
  ].join(' ')
}

function NavList({ navItems, onNavigate }: { navItems: NavItem[]; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {navItems.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass} onClick={onNavigate}>
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}

function UserFooter() {
  const { profile } = useAuth()
  return (
    <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
      <span className="truncate text-sm text-slate-500 dark:text-slate-400">{profile?.full_name ?? profile?.phone}</span>
      <Button variant="secondary" size="md" className="shrink-0" onClick={() => supabase.auth.signOut()}>
        Chiqish
      </Button>
    </div>
  )
}

export function AppNavShell({ title, navItems, children }: { title: string; navItems: NavItem[]; children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className="min-h-svh bg-slate-50 dark:bg-slate-900 lg:flex">
      {/* Desktop sidebar -- persistent, never toggled. `hidden lg:flex` means
          this is the ONLY place these nav links exist in the DOM at a
          desktop viewport (Playwright's own default viewport is desktop-
          sized), so getByRole('link', {name: 'CHIQIM'}) resolves to exactly
          one element there. */}
      <aside className="hidden w-60 shrink-0 flex-col gap-4 border-r border-slate-200 p-4 dark:border-slate-800 lg:flex">
        <span className="px-1 text-sm font-semibold text-slate-900 dark:text-slate-100">BATU EXPORT — {title}</span>
        <NavList navItems={navItems} />
        <div className="mt-auto">
          <UserFooter />
        </div>
      </aside>

      <div className="flex-1">
        {/* Mobile top bar -- hamburger + wordmark only, `lg:hidden`. */}
        <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800 lg:hidden">
          <IconButton
            label="Menyu"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
            className="shrink-0 text-slate-700 dark:text-slate-300"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6">
              <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </IconButton>
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">BATU EXPORT — {title}</span>
        </header>

        {/* Mobile drawer -- conditionally rendered (not just hidden), so its
            nav links are only ever in the DOM while actually open. */}
        {drawerOpen && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigatsiya menyusi">
            <div className="absolute inset-0 bg-slate-900/50" onClick={() => setDrawerOpen(false)} />
            <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-4 bg-white p-4 shadow-xl dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">BATU EXPORT — {title}</span>
                <IconButton label="Yopish" onClick={() => setDrawerOpen(false)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                    <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </IconButton>
              </div>
              <NavList navItems={navItems} onNavigate={() => setDrawerOpen(false)} />
              <div className="mt-auto">
                <UserFooter />
              </div>
            </div>
          </div>
        )}

        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      </div>
    </div>
  )
}
