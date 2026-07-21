import { NavLink, Outlet } from 'react-router-dom'
import { RoleShell } from '../../components/RoleShell'

function navClass({ isActive }: { isActive: boolean }) {
  return isActive
    ? 'font-medium text-slate-900 dark:text-slate-100'
    : 'text-slate-500 dark:text-slate-400'
}

export function RahbarLayout() {
  return (
    <RoleShell
      title="Rahbar"
      nav={
        <nav className="flex gap-4 text-sm">
          <NavLink to="/rahbar" end className={navClass}>
            Bosh sahifa
          </NavLink>
          <NavLink to="/rahbar/hisobotlar" className={navClass}>
            Hisobotlar
          </NavLink>
          <NavLink to="/rahbar/qoldiq" className={navClass}>
            Ombor qoldig'i
          </NavLink>
          <NavLink to="/rahbar/kutilmoqda" className={navClass}>
            Kutilayotgan ishlar
          </NavLink>
          <NavLink to="/rahbar/foydalanuvchilar" className={navClass}>
            Foydalanuvchilar
          </NavLink>
        </nav>
      }
    >
      <Outlet />
    </RoleShell>
  )
}
