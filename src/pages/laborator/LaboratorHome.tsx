import { Outlet } from 'react-router-dom'
import { RoleShell } from '../../components/RoleShell'
import { RoleTabs } from '../../components/RoleTabs'

// KIRIM|CHIQIM tab bar now that CHIQIM (2c) is real — same nested-route
// shape every other role uses (Outlet + one App.tsx route per tab).
export function LaboratorHome() {
  return (
    <RoleShell
      title="Laborator"
      nav={
        <RoleTabs
          tabs={[
            { to: '/laborator', label: 'KIRIM', end: true },
            { to: '/laborator/chiqim', label: 'CHIQIM' },
            { to: '/laborator/tarix', label: 'Tarix' },
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
