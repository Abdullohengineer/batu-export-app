import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { run } from './rpc'
import { queryKeys } from './queryClient'

export interface CalibreAvailability {
  type_id: string
  calibre_id: string
  is_old_stock: boolean
  available_kg: number
  // Post-Rezka cleanup item 2 (0148): one row per owner. Every caller must
  // match the request's own client -- another client's pallets are never
  // this client's stock (attribute_chiqim_line_fifo scopes the same way).
  owner_id: string
}

const EMPTY: CalibreAvailability[] = []

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
//
// Post-Rezka cleanup item 2 (2026-09-28, migration 0148, docs/decisions/0228):
// the view is per owner now -- callers look up (owner, type, calibre, old/new).
//
// Rezka Prompt 3 (2026-09-28): on React Query now (docs/decisions/0223 and
// 0225) -- same query, same columns, but deduped across ChiqimForm and
// OmborChiqimTab, throws on error instead of rendering "0 kg mavjud", and
// refreshed by invalidateReportData() after every CHIQIM write. Rows stay
// per calibre_id: the Rezka tab and Kalibrlangan split by which calibres
// they OFFER (ChiqimForm), not here -- Standard (RKN) and Konditerka (KN)
// are different calibre ids, so an exact-calibre lookup never mixes them.
export function useFinishedCalibreAvailability() {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.finishedCalibreAvailability(),
    queryFn: async ({ signal }): Promise<CalibreAvailability[]> => {
      const rows = await run(
        supabase.from('finished_calibre_availability').select('type_id, calibre_id, is_old_stock, available_kg, owner_id').abortSignal(signal),
      )
      return (rows ?? []).map((r) => ({ ...r, available_kg: Number(r.available_kg) }))
    },
  })
  return { rows: data ?? EMPTY, loading: isPending, error: error ? error.message : null }
}
