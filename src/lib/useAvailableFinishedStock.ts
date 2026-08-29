import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface CalibreAvailability {
  type_id: string
  calibre_id: string
  is_old_stock: boolean
  available_kg: number
}

// §5.4 FIFO dispatch (2026-08-28, see DECISIONS.md "CHIQIM quantity-based
// dispatch: FIFO cascade, consumption table"): Menejer's feasibility hint
// reads the ONE canonical availability view (finished_calibre_availability,
// migrations 0087/0089 — already excludes departed stock via the
// consumption ledger AND lab-gates on the same 'o_tdi' verdict
// stock_on_hand_rows' own 'available' bucket enforces). This is the exact
// same balance Ombor's FIFO attribution draws down against at Ombor's
// finalize click, so this hint and the real dispatch outcome can never
// structurally disagree about WHAT counts as available — a hint of "enough
// stock" can still go stale between form-load and finalize (another
// request claims the same stock first); attribute_chiqim_line_fifo's own
// hard-fail-if-insufficient is the real guard for that race, not this hook.
export function useFinishedCalibreAvailability() {
  const [rows, setRows] = useState<CalibreAvailability[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const { data } = await supabase.from('finished_calibre_availability').select('type_id, calibre_id, is_old_stock, available_kg')
        if (!cancelled) setRows(data ?? [])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return { rows, loading }
}
