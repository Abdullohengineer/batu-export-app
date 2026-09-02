import { Outlet } from 'react-router-dom'
import { AppNavShell, type NavItem } from '../../components/AppNavShell'

// Global Export client portal shell — Russian-only throughout, reusing
// AppNavShell (the same shell Menejer/Rahbar already use). Two sub-tabs
// now (Приход/Расход), replacing the single "Отчёт" destination — each is
// its own <Route> (see App.tsx), which is what makes filter state need
// usePersistentState keyed per sub-tab (ClientPrihodTab/ClientRashodTab):
// switching sub-tabs unmounts the outgoing route exactly like every other
// role's top-tab bar (see FilterState.tsx's own header comment).
const NAV_ITEMS: NavItem[] = [
  { to: '/client/prihod', label: 'Приход', end: true },
  { to: '/client/rashod', label: 'Расход', end: true },
]

export function ClientLayout() {
  return (
    <AppNavShell title="Клиент" navItems={NAV_ITEMS} logoutLabel="Выйти">
      <Outlet />
    </AppNavShell>
  )
}
