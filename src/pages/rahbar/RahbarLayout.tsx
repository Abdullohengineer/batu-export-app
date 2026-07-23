import { Outlet } from 'react-router-dom'
import { AppNavShell, type NavItem } from '../../components/AppNavShell'

// Nav/visual-redesign migration (Rahbar prompt): same shared shell Menejer
// adopted first -- reused as-is, not forked. Same 9 destinations as the
// previous RoleShell top-nav, same `to`/label text throughout (no e2e
// coverage on any Rahbar route, confirmed by grep across all 4 specs before
// this change, but the labels/paths are kept byte-identical regardless).
const NAV_ITEMS: NavItem[] = [
  { to: '/rahbar', label: 'Bosh sahifa', end: true },
  { to: '/rahbar/hisobotlar', label: 'Hisobotlar' },
  { to: '/rahbar/qoldiq', label: "Ombor qoldig'i" },
  { to: '/rahbar/kutilmoqda', label: 'Kutilayotgan ishlar' },
  { to: '/rahbar/mijoz-hisoboti', label: 'Mijoz hisoboti' },
  { to: '/rahbar/hosildorlik', label: 'Hosildorlik' },
  { to: '/rahbar/diqqat-talab', label: 'Diqqat talab' },
  { to: '/rahbar/sozlamalar', label: 'Sozlamalar' },
  { to: '/rahbar/foydalanuvchilar', label: 'Foydalanuvchilar' },
]

export function RahbarLayout() {
  return (
    <AppNavShell title="Rahbar" navItems={NAV_ITEMS}>
      <Outlet />
    </AppNavShell>
  )
}
