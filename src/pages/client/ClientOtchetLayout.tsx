import { Outlet } from 'react-router-dom'
import { RoleTabs } from '../../components/RoleTabs'

// Отчёт's own sub-tab bar (CLAUDE.md task "Rebuild the client portal..."
// Part B) — Приход | Расход | Производство, nested one level inside
// ClientLayout's Панель/Отчёт top-level nav (AppNavShell). Same
// RoleTabs + <Outlet/> pattern every other role's own sub-tab layout uses
// (e.g. QorovulHome's KIRIM/CHIQIM/Hisobotlar).
export function ClientOtchetLayout() {
  return (
    <div className="space-y-4">
      <RoleTabs
        tabs={[
          { to: '/client/otchet/prihod', label: 'Приход', end: true },
          { to: '/client/otchet/rashod', label: 'Расход', end: true },
          { to: '/client/otchet/proizvodstvo', label: 'Производство', end: true },
        ]}
      />
      <Outlet />
    </div>
  )
}
