import { Outlet } from 'react-router-dom'
import { RoleShell } from '../../components/RoleShell'
import { RoleTabs } from '../../components/RoleTabs'

// Layout for Menejer's screens: header tabs + the active tab via <Outlet/>
// (§1.1 — segmented KIRIM|CHIQIM tabs), same nested-route shape Qorovul/Ombor
// already use. Previously a flat page (KIRIM only, no CHIQIM existed yet).
export function MenejerHome() {
  return (
    <RoleShell
      title="Menejer"
      nav={
        <RoleTabs
          tabs={[
            { to: '/menejer', label: 'KIRIM', end: true },
            { to: '/menejer/chiqim', label: 'CHIQIM' },
          ]}
        />
      }
    >
      <Outlet />
    </RoleShell>
  )
}
