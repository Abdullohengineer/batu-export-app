import { Outlet } from 'react-router-dom'
import { RoleShell } from '../../components/RoleShell'
import { RoleTabs } from '../../components/RoleTabs'

// Layout for Qorovul's screens: header tabs + the active tab via <Outlet/>.
// Adding a future tab (e.g. the CHIQIM gate side) is one more entry here plus
// one nested <Route> in App.tsx — no restructure.
export function QorovulHome() {
  return (
    <RoleShell
      title="Qorovul"
      nav={
        <RoleTabs
          tabs={[
            { to: '/qorovul', label: 'KIRIM', end: true },
            { to: '/qorovul/chiqim', label: 'CHIQIM' },
            { to: '/qorovul/hisobotlar', label: 'Hisobotlar' },
          ]}
        />
      }
    >
      <div className="max-w-3xl">
        <Outlet />
      </div>
    </RoleShell>
  )
}
