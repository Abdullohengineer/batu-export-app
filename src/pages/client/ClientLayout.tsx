import { Outlet } from 'react-router-dom'
import { AppNavShell, type NavItem } from '../../components/AppNavShell'

// Global Export client portal shell — Russian-only throughout, reusing
// AppNavShell (the same shell Menejer/Rahbar already use).
//
// Restructured (2026-09-08, CLAUDE.md task "Rebuild the client portal...")
// from two flat top-level tabs (Приход/Расход) to two top-level
// destinations: Панель (the dashboard, ClientPanelTab) and Отчёт (a
// nested layout of its own, ClientOtchetLayout, with three sub-tabs
// Приход/Расход/Производство). `end: true` on Панель only -- Отчёт must
// stay highlighted for every /client/otchet/* sub-route, matching how
// every other AppNavShell caller treats a non-leaf destination.
const NAV_ITEMS: NavItem[] = [
  { to: '/client', label: 'Панель', end: true },
  { to: '/client/otchet', label: 'Отчёт' },
]

export function ClientLayout() {
  return (
    <AppNavShell title="Клиент" navItems={NAV_ITEMS} logoutLabel="Выйти">
      <Outlet />
    </AppNavShell>
  )
}
