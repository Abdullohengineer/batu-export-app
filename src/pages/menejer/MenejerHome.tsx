import { useState } from 'react'
import { RoleShell } from '../../components/RoleShell'
import { KirimForm } from './KirimForm'
import { KirimOrdersList } from './KirimOrdersList'

export function MenejerHome() {
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <RoleShell title="Menejer">
      <div className="max-w-2xl space-y-8">
        <KirimForm onSaved={() => setRefreshKey((k) => k + 1)} />
        <KirimOrdersList refreshKey={refreshKey} />
      </div>
    </RoleShell>
  )
}
