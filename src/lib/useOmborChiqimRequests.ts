import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { sortFinishedByOmborFinish } from './sortChiqimFinished'

export interface ChiqimLine {
  id: string
  type_id: string
  // Raw dispatch pool rework (2026-08-01, see DECISIONS.md "Raw dispatch
  // serial pool"): line_kind replaces the old calibre_id/raw_serial XOR --
  // a raw line now points at a POOL of candidate serials
  // (chiqim_line_raw_serials, Menejer's selection), not one pinned column.
  // qty_kg is optional for a raw line (Menejer may not know how much will
  // actually be drawn). Opening stock, Stage 2 (2026-08-02): widened to
  // five kinds.
  line_kind: 'finished' | 'raw' | 'old_washed' | 'old_kn' | 'old_raw'
  calibre_id: string | null
  qty_kg: number | null
  // Raw dispatch pool -- every serial Menejer pooled for this line. Ombor's
  // draw UI reads this to offer per-serial draws; a draw against a serial
  // NOT in this list is the "out of pool" warning path (requirement 7).
  rawSerialPool: string[]
}

export interface ChiqimRequest {
  id: string
  request_date: string
  plate: string
  driver: string
  owner_id: string
  // 'regular' | 'fura' (2026-08-30, see DECISIONS.md "CHIQIM truck type:
  // Fura"). Read here for one specific reason, not for decoration: a fura
  // is never weighed at the gate, so THIS screen's finish click is the
  // trip's completing event — it flips the request to 'olib_ketildi' and,
  // through the unchanged `ombor_deletes` RLS policy, closes the undo
  // window in the same instant. Ombor has to be able to see that before
  // clicking, not discover it afterwards.
  truck_type: string
  ombor_finished_at: string | null
  lines: ChiqimLine[]
  // Nav/visual-redesign pass (mockup "BATU-Storage-S4-Skladdan-CHIQIM-v2.pdf"
  // p1): whether Qorovul has already recorded the gate's empty weight
  // (dir='chiqim' stage 1 — the truck arrives empty to be loaded, reversed
  // from KIRIM) for this request. Informational only, per the flagged
  // decision in this task's report — display both states, never gates
  // "Yuklashni boshlash" (this app's consistent never-block philosophy).
  gateStage1CompletedAt: string | null
  gatePustoyKg: number | null
}

// §5.4 Ombor CHIQIM: W1 (open — ombor_finished_at is null) and W2
// (finished-by-Ombor — ombor_finished_at set), per the "CHIQIM per-role
// finalization" invariant (SPEC.md §5 intro) — this is Ombor's OWN signal,
// independent of Qorovul's gate weighing or chiqim_requests.status.
// W2 sorts newest-first by ombor_finished_at (universal sort rule).
//
// §5.4 FIFO dispatch (2026-08-28): no more chiqim_line_pallets nested
// select — a finished/old_washed line no longer earmarks specific pallets
// in advance (Option B reservation is gone). Ombor enters a loaded kg per
// line at finalize time (local UI state in OmborChiqimTab.tsx, same
// deferred-commit pattern the raw/old_kn draw UI already uses) and
// finalize_chiqim_dispatch (migration 0087) FIFO-attributes it against
// finished_pallets by receipt date — this hook has nothing to fetch for
// that beyond the line's own declared qty_kg. No tara (2026-08-29, Prompt
// 11, see DECISIONS.md "Menejer CHIQIM: quantity-only entry, no tara") —
// declared_tara_kg was dropped from chiqim_lines entirely (migration 0103).
export function useOmborChiqimRequests() {
  const [open, setOpen] = useState<ChiqimRequest[]>([])
  const [finished, setFinished] = useState<ChiqimRequest[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data }, { data: weighings }] = await Promise.all([
        supabase
          .from('chiqim_requests')
          // Voided requests never reach Ombor at all — a voided_at IS NULL
          // filter here, not client-side, since Ombor has no business
          // reason to ever see one.
          .select(
            'id, request_date, plate, driver, owner_id, truck_type, ombor_finished_at, ' +
              'chiqim_lines(id, type_id, calibre_id, line_kind, qty_kg, ' +
              'chiqim_line_raw_serials(serial))',
          )
          .is('voided_at', null),
        supabase.from('gate_weighings').select('request_id, pustoy_kg, stage1_completed_at').eq('dir', 'chiqim'),
      ])
      const weighingByRequest = new Map((weighings ?? []).map((w) => [w.request_id, w]))

      // Cast explicitly, same reason as useGateHistory.ts/useFinishedChiqimRequests.ts:
      // a `select()` built from a concatenated string (not a literal) widens
      // to a union including PostgREST's generic error shape.
      type RawLine = {
        id: string
        type_id: string
        calibre_id: string | null
        line_kind: 'finished' | 'raw' | 'old_washed' | 'old_kn' | 'old_raw'
        qty_kg: number | null
        chiqim_line_raw_serials: { serial: string }[] | null
      }
      type RawRequest = {
        id: string
        request_date: string
        plate: string
        driver: string
        owner_id: string
        truck_type: string
        ombor_finished_at: string | null
        chiqim_lines: RawLine[] | null
      }
      const rows = (data ?? []) as unknown as RawRequest[]

      const requests: ChiqimRequest[] = rows.map((r) => {
        const weighing = weighingByRequest.get(r.id)
        return {
          id: r.id,
          request_date: r.request_date,
          plate: r.plate,
          driver: r.driver,
          owner_id: r.owner_id,
          truck_type: r.truck_type,
          ombor_finished_at: r.ombor_finished_at,
          lines: (r.chiqim_lines ?? []).map((l) => ({
            id: l.id,
            type_id: l.type_id,
            calibre_id: l.calibre_id,
            line_kind: l.line_kind,
            qty_kg: l.qty_kg,
            rawSerialPool: (l.chiqim_line_raw_serials ?? []).map((s) => s.serial),
          })),
          gateStage1CompletedAt: weighing?.stage1_completed_at ?? null,
          gatePustoyKg: weighing?.pustoy_kg ?? null,
        }
      })

      setOpen(requests.filter((r) => r.ombor_finished_at === null))
      setFinished(sortFinishedByOmborFinish(requests.filter((r) => r.ombor_finished_at !== null)))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { open, finished, loading, refresh }
}
