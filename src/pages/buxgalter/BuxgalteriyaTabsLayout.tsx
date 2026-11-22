import { Outlet } from 'react-router-dom'
import { RoleTabs } from '../../components/RoleTabs'

// Buxgalteriya input tabs, in the mockup's order ("BUXGALTERIYA · KIRIM").
// Same nested RoleTabs + Outlet pattern as ClientOtchetLayout.
export function BuxgalteriyaTabsLayout() {
  return (
    <div className="space-y-4">
      <div className="-mx-3 overflow-x-auto px-3">
        <RoleTabs
          tabs={[
            { to: '/buxgalter/kirim', label: 'Xarajat', end: true },
            { to: '/buxgalter/kirim/tushum', label: 'Tushum', end: true },
            { to: '/buxgalter/kirim/balans', label: "Balans to'ldirish", end: true },
            { to: '/buxgalter/kirim/doimiy', label: 'Doimiy xarajatlar', end: true },
            { to: '/buxgalter/kirim/kutilayotgan', label: 'Kutilayotgan', end: true },
            { to: '/buxgalter/kirim/oyni-yopish', label: 'Oyni yopish', end: true },
            { to: '/buxgalter/kirim/tarix', label: 'Tarix', end: true },
          ]}
        />
      </div>
      <Outlet />
    </div>
  )
}
