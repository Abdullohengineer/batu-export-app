import { Outlet } from 'react-router-dom'
import { AppNavShell, type NavItem } from '../../components/AppNavShell'

// Buxgalteriya (decision 0249): the accountant's shell -- same AppNavShell
// every other role uses. The buxgalter sees exactly two destinations
// (brief invariant 6): Buxgalteriya (input) and Moliyaviy ko'rsatkichlar
// (read-only output, also mounted under /rahbar and /menejer).
const NAV_ITEMS: NavItem[] = [
  { to: '/buxgalter/kirim', label: 'Buxgalteriya' },
  { to: '/buxgalter/moliya', label: "Moliyaviy ko'rsatkichlar" },
]

export function BuxgalterLayout() {
  return (
    <AppNavShell title="Buxgalter" navItems={NAV_ITEMS}>
      <Outlet />
    </AppNavShell>
  )
}
