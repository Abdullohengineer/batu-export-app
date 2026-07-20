import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { currentCycleLabStatus } from './labVerdict'

export interface AvailablePallet {
  barcode2: string
  type_id: string
  calibre_id: string
  weight_kg: number
}

// §3.1/§5.4 CHIQIM feasibility input: finished pallets not yet claimed by any
// dispatch. `finished_pallets.status='in_stock'` alone isn't yet a complete
// "available" definition:
// - excludes any barcode2 already in `dispatch_manifest` (nothing in the app
//   writes `status='dispatched'`, so this is the real claimed-check).
// - excludes any pallet whose parent serial's CURRENT wash cycle hasn't
//   passed lab testing (`currentCycleLabStatus`, §5.5.3/§8 v1.9 hard gate) —
//   untested and re-wash-flagged stock must be invisible here, same rule
//   Ombor's scan screen (OmborChiqimTab/chiqimScan.ts) enforces, via the
//   same shared helper so the two can never disagree.
// Read-only; feeds the feasibility checker only — pallet selection itself
// is Ombor's job (§5.4), not built here.
export function useAvailableFinishedStock() {
  const [pallets, setPallets] = useState<AvailablePallet[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [{ data: fp }, { data: dm }] = await Promise.all([
          supabase.from('finished_pallets').select('barcode2, type_id, calibre_id, weight_kg, serial').eq('status', 'in_stock'),
          supabase.from('dispatch_manifest').select('barcode2'),
        ])
        const claimed = new Set((dm ?? []).map((d) => d.barcode2))
        const candidates = (fp ?? []).filter((p) => !claimed.has(p.barcode2))
        const labStatus = await currentCycleLabStatus(candidates.map((p) => p.serial))
        setPallets(candidates.filter((p) => labStatus.get(p.serial) === 'passed'))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return { pallets, loading }
}
