import { ChiqimForm } from './ChiqimForm'
import { FinishedChiqimList } from './FinishedChiqimList'

// §3.1 CHIQIM tab. "Requests ready to load" (an open-requests window)
// belongs to Ombor's §5.4 screen, not this one — Menejer's own second
// window is the finished view (Step 7 prompt 4), reading Qorovul's own
// finish signal per the CHIQIM per-role finalization invariant. A newly
// saved request never appears there immediately (it still has to clear the
// whole gate/scan chain), so no cross-refresh wiring between the two is
// needed.
export function MenejerChiqimTab() {
  return (
    <div className="max-w-2xl space-y-6">
      <ChiqimForm onSaved={() => {}} />
      <FinishedChiqimList />
    </div>
  )
}
