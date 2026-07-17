import { Outlet } from 'react-router-dom'
import { RoleShell } from '../../components/RoleShell'
import { RoleTabs } from '../../components/RoleTabs'

// Layout for Ombor's screens: header tabs + the active tab via <Outlet/>.
// Adding a future tab (Moyka / finished pallets / dispatch, §5.2–5.4) is one
// more entry here plus one nested <Route> in App.tsx — no restructure.
export function OmborHome() {
  return (
    <RoleShell
      title="Ombor menejeri"
      nav={
        <RoleTabs
          tabs={[
            { to: '/ombor', label: 'Skladga KIRIM', end: true },
            { to: '/ombor/moyka', label: 'Moykaga Chiqarish' },
            { to: '/ombor/tayyor', label: 'Tayyor Mahsulot' },
            { to: '/ombor/chiqim', label: 'Skladdan CHIQIM' },
            { to: '/ombor/hisobotlar', label: 'Hisobotlar' },
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
