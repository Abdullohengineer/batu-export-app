import { Outlet } from 'react-router-dom'
import { AppNavShell, type NavItem } from '../../components/AppNavShell'

// Nav/visual-redesign migration (Rahbar prompt): same shared shell Menejer
// adopted first -- reused as-is, not forked.
//
// Diqqat talab / Sozlamalar / Foydalanuvchilar moved to Menejer (see
// DECISIONS.md "Boshqaruv moved to Menejer") -- Rahbar is now fully
// read-only, 6 destinations remain, all reporting/oversight screens.
const NAV_ITEMS: NavItem[] = [
  { to: '/rahbar', label: 'Bosh sahifa', end: true },
  { to: '/rahbar/hisobotlar', label: 'Hisobotlar' },
  { to: '/rahbar/qoldiq', label: "Ombor qoldig'i" },
  { to: '/rahbar/kutilmoqda', label: 'Kutilayotgan ishlar' },
  { to: '/rahbar/mijoz-hisoboti', label: 'Mijoz hisoboti' },
  { to: '/rahbar/hosildorlik', label: 'Hosildorlik' },
]

export function RahbarLayout() {
  return (
    <AppNavShell title="Rahbar" navItems={NAV_ITEMS}>
      <Outlet />
    </AppNavShell>
  )
}
