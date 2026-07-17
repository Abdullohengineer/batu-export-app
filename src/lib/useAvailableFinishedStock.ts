import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface AvailablePallet {
  barcode2: string
  type_id: string
  calibre_id: string
  weight_kg: number
}

// §3.1/§5.4 CHIQIM feasibility input: finished pallets not yet claimed by any
// dispatch. `finished_pallets.status='in_stock'` alone isn't yet a complete
// "available" definition — nothing in the app writes `status='dispatched'`
// today (Ombor's scan/finish action is §5.4's own prompt, not built yet), so
// this also excludes any barcode2 already in `dispatch_manifest` as a
// defensive second check that stays correct however that later prompt ends
// up flipping status. Read-only; feeds the feasibility checker only — pallet
// selection itself is Ombor's job (§5.4), not built here.
export function useAvailableFinishedStock() {
  const [pallets, setPallets] = useState<AvailablePallet[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [{ data: fp }, { data: dm }] = await Promise.all([
          supabase.from('finished_pallets').select('barcode2, type_id, calibre_id, weight_kg').eq('status', 'in_stock'),
          supabase.from('dispatch_manifest').select('barcode2'),
        ])
        const claimed = new Set((dm ?? []).map((d) => d.barcode2))
        setPallets((fp ?? []).filter((p) => !claimed.has(p.barcode2)))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return { pallets, loading }
}
