import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// §3.1/§5.4 CHIQIM Option B (2026-07-26): the one shared "which pallets are
// currently reserved" query — used by both useAvailableFinishedStock.ts
// (Menejer's feasibility hint) and ChiqimForm.tsx's own picker, so the two
// can never disagree about what counts as available, same reasoning as
// currentCycleLabStatus being shared rather than duplicated.
//
// released_at is null IS "currently reserved" — set only by the
// chiqim_requests_release_reservations trigger (0033) when a request is
// voided or Ombor finishes it. No client-side filtering by request status
// needed here: an active row is active precisely because the trigger
// hasn't released it yet.
export function useReservedPalletBarcodes() {
  const [reserved, setReserved] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const { data } = await supabase.from('chiqim_line_pallets').select('barcode2').is('released_at', null)
        setReserved(new Set((data ?? []).map((r) => r.barcode2)))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return { reserved, loading }
}
