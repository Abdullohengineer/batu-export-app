import { Outlet } from 'react-router-dom'
import { AppNavShell } from '../../components/AppNavShell'

// Layout for Menejer's screens — nav restructure (mockup "BATU-Manager-
// Screens-MASTER.pdf"): mobile drawer / desktop sidebar via AppNavShell,
// replacing the RoleShell+RoleTabs top-tab bar every other role still uses.
// Same nested-route shape (Outlet), same nav destinations/labels/order as
// before -- only the chrome around them changed.
export function MenejerHome() {
  return (
    <AppNavShell
      title="Menejer"
      navItems={[
        { to: '/menejer', label: 'KIRIM', end: true },
        { to: '/menejer/chiqim', label: 'CHIQIM' },
        { to: '/menejer/hisobot', label: 'Hisobot' },
        { to: '/menejer/qoldiq', label: "Ombor qoldig'i" },
        { to: '/menejer/kutilmoqda', label: 'Kutilayotgan ishlar' },
        { to: '/menejer/mijoz-hisoboti', label: 'Mijoz hisoboti' },
        { to: '/menejer/hosildorlik', label: 'Hosildorlik' },
        { to: '/menejer/mijozlar', label: 'Mijozlar' },
      ]}
    >
      <Outlet />
    </AppNavShell>
  )
}
