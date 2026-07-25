import { useState } from 'react'
import { ChiqimForm } from './ChiqimForm'
import { FinishedChiqimList } from './FinishedChiqimList'

// §3.1 CHIQIM tab. Menejer's own second window (FinishedChiqimList, widened
// 2026-07-25 to show every status, not just finished) lists all of this
// role's own CHIQIM requests, newest-first — a freshly saved request now
// appears there immediately as 'kutilmoqda', not just once the whole gate/
// scan chain clears. Ombor's own §5.4 screen still separately shows "ready
// to load" from its own operational angle — no cross-role wiring needed,
// each reads chiqim_requests independently. Same-page refresh IS needed
// now though: refreshKey mirrors MenejerKirimTab/KirimOrdersList's own
// pattern exactly, bumped on save so the new row shows without a remount.
export function MenejerChiqimTab() {
  const [refreshKey, setRefreshKey] = useState(0)
  return (
    <div className="max-w-2xl space-y-6">
      <ChiqimForm onSaved={() => setRefreshKey((k) => k + 1)} />
      <FinishedChiqimList refreshKey={refreshKey} />
    </div>
  )
}
