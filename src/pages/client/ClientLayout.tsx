import { Outlet } from 'react-router-dom'
import { AppNavShell, type NavItem } from '../../components/AppNavShell'

// Global Export client portal shell — Russian-only throughout (task:
// "All names has to be in Russian"), reusing AppNavShell (the same shell
// Menejer/Rahbar already use) rather than a bespoke layout. One
// destination only — this role has exactly one screen.
const NAV_ITEMS: NavItem[] = [{ to: '/client', label: 'Отчёт', end: true }]

export function ClientLayout() {
  return (
    <AppNavShell title="Клиент" navItems={NAV_ITEMS} logoutLabel="Выйти">
      <Outlet />
    </AppNavShell>
  )
}
