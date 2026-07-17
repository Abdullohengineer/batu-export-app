import { useState } from 'react'
import { KirimForm } from './KirimForm'
import { KirimOrdersList } from './KirimOrdersList'

// Moved out of MenejerHome (§1.1 — KIRIM|CHIQIM tabs) so it can sit
// alongside ChiqimForm as its own tab, same nested-route shape Qorovul/Ombor
// already use.
export function MenejerKirimTab() {
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <div className="max-w-2xl space-y-8">
      <KirimForm onSaved={() => setRefreshKey((k) => k + 1)} />
      <KirimOrdersList refreshKey={refreshKey} />
    </div>
  )
}
