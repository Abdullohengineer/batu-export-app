import { Outlet } from 'react-router-dom'
import { AppNavShell } from '../../components/AppNavShell'

// Layout for Menejer's screens — nav restructure (mockup "BATU-Manager-
// Screens-MASTER.pdf"): mobile drawer / desktop sidebar via AppNavShell,
// replacing the RoleShell+RoleTabs top-tab bar every other role still uses.
// Same nested-route shape (Outlet).
//
// Diqqat talab / Sozlamalar / Foydalanuvchilar appended (see DECISIONS.md
// "Boshqaruv moved to Menejer") -- moved from Rahbar's own nav, same order
// they had there, added after Menejer's pre-existing destinations rather
// than interleaved.
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
        { to: '/menejer/eski-zaxira', label: 'Eski zaxira hisob-kitobi' },
        { to: '/menejer/mijozlar', label: 'Mijozlar' },
        { to: '/menejer/diqqat-talab', label: 'Diqqat talab' },
        { to: '/menejer/sozlamalar', label: 'Sozlamalar' },
        { to: '/menejer/foydalanuvchilar', label: 'Foydalanuvchilar' },
      ]}
    >
      <Outlet />
    </AppNavShell>
  )
}
