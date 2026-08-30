import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { sortByDateDesc } from './sortByDate'

export interface FinishedChiqimLine {
  id: string
  type_id: string
  // Raw dispatch pool rework (2026-08-01, see DECISIONS.md "Raw dispatch
  // serial pool"): line_kind replaces the old raw_serial-is-not-null
  // marker; a raw line's serials now live in the pool table, shown via
  // rawSerialPool — this is a receipt/history view, so it shows the full
  // pool rather than degrading to a bare "Xom" with no detail, matching
  // how a finished line's reservedPallets are already shown elsewhere.
  //
  // Widened to all five kinds (was 'finished' | 'raw' only, a latent gap
  // predating opening-stock Stage 2 — old_washed/old_kn/old_raw lines were
  // already flowing through this query untyped-correctly). See
  // ChiqimRequestDetail.tsx's lineLabel for the matching render branches.
  calibre_id: string | null
  line_kind: 'finished' | 'raw' | 'old_washed' | 'old_kn' | 'old_raw'
  qty_kg: number | null
  rawSerialPool: string[]
}

export interface FinishedChiqimWeighing {
  id: string
  gruzheny_kg: number | null
  pustoy_kg: number | null
  net_kg: number | null
  stage1_created_by: string | null
  stage1_completed_at: string | null
  stage1_plate_photo: string | null
  stage1_scale_photo: string | null
  stage2_created_by: string | null
  stage2_scale_photo: string | null
  departure_doc_photo: string | null
  completed_at: string | null
}

export interface FinishedChiqimRequest {
  id: string
  request_date: string
  plate: string
  driver: string
  owner_id: string
  status: string
  // 'regular' | 'fura' (2026-08-30, see DECISIONS.md "CHIQIM truck type:
  // Fura"). Load-bearing on this surface: `status` reads 'olib_ketildi' for
  // both truck types, but only a regular truck's came from a gate weighing
  // — a fura's came from Ombor's finish click, and there is no gate record
  // behind it to open.
  truck_type: string
  created_by: string | null
  created_at: string
  ombor_finished_at: string | null
  ombor_finished_by: string | null
  // §5.4 Option B (0033, 2026-07-26) — a voided request stays visible here
  // (this app's void-don't-delete convention), unlike Ombor's own window,
  // which excludes voided requests outright (they never reached Ombor).
  voided_at: string | null
  lines: FinishedChiqimLine[]
  weighing: FinishedChiqimWeighing | null
}

// Shared between useFinishedChiqimRequests (bulk, Menejer's own W2 list) and
// useChiqimRequestById below (single, the Hisobot old-KN passport drill-down)
// so the two queries' row shapes can never drift apart.
type RawLine = {
  id: string
  type_id: string
  calibre_id: string | null
  line_kind: FinishedChiqimLine['line_kind']
  qty_kg: number | null
  request_id: string
  chiqim_line_raw_serials: { serial: string }[] | null
}

function toLine(l: RawLine): FinishedChiqimLine {
  return {
    id: l.id,
    type_id: l.type_id,
    calibre_id: l.calibre_id,
    line_kind: l.line_kind,
    qty_kg: l.qty_kg,
    rawSerialPool: (l.chiqim_line_raw_serials ?? []).map((s) => s.serial),
  }
}

const CHIQIM_LINE_SELECT = 'id, type_id, calibre_id, line_kind, qty_kg, request_id, chiqim_line_raw_serials(serial)'
const GATE_WEIGHING_SELECT =
  'id, request_id, gruzheny_kg, pustoy_kg, net_kg, stage1_created_by, stage1_completed_at, ' +
  'stage1_plate_photo, stage1_scale_photo, stage2_created_by, stage2_scale_photo, departure_doc_photo, completed_at'

// Menejer's CHIQIM second window (§3.1) — widened from a finished-only
// view (Step 7 prompt 4) to every status, matching the universal second-
// window pattern (KirimOrdersList's own sibling for KIRIM: no status
// filter, all of Menejer's own requests, newest-first). The original
// finished-only scope was itself deliberate (see DECISIONS.md 2026-07-17
// "Step 7 prompt 1" and 2026-07-18 "Step 7 prompt 4") — Ombor's own S4W1
// already covers "open requests," so this was built as a receipt view, not
// a tracker. Widened on explicit confirmation once that history was
// surfaced (2026-07-25).
//
// order_status has 4 values, but chiqim_requests only ever carries two in
// practice: 'kutilmoqda' (insert default) and 'olib_ketildi' (the ONLY
// status write, complete_chiqim_stage2 trigger, 0020) — 'qabul_qilindi'/
// 'yakunlandi' belong to KIRIM's lifecycle and are never written here.
//
// TEST- prefix hygiene: filtered out here, not exposed as a toggle — no
// other screen in this app has ever built a "show test data" switch, and
// this app has no other run-time signal that distinguishes a real request
// from a test fixture (see DECISIONS.md "void mechanism" entries).
//
// Sort: newest-first by created_at (always present, unlike the gate's
// completed_at which is null until Qorovul's stage 2 — a pending request
// has to sort correctly too now that it's shown at all).
//
// refreshKey: same live-refresh pattern as KirimOrdersList's own prop
// (bumped by MenejerChiqimTab on ChiqimForm's onSaved) — now load-bearing,
// not cosmetic: before this widen, a freshly saved request could never
// reach 'olib_ketildi' within the same page load (it had to clear the
// whole gate/scan chain first), so the missing refresh trigger was
// invisible. Now it must appear on the same screen immediately after save.
export function useFinishedChiqimRequests(refreshKey?: number) {
  const [requests, setRequests] = useState<FinishedChiqimRequest[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: reqs }, { data: lines }, { data: weighings }] = await Promise.all([
        supabase
          .from('chiqim_requests')
          .select(
            'id, request_date, plate, driver, owner_id, status, truck_type, created_by, created_at, ' +
              'ombor_finished_at, ombor_finished_by, voided_at',
          ),
        supabase.from('chiqim_lines').select(CHIQIM_LINE_SELECT),
        supabase.from('gate_weighings').select(GATE_WEIGHING_SELECT).eq('dir', 'chiqim'),
      ])

      // Cast explicitly, same reason as useGateHistory.ts: without generated
      // DB types, a `select()` built from a concatenated string (not a
      // literal) widens to a union that includes PostgREST's generic error
      // shape, which breaks property access below. Same fix now needed for
      // `reqs` too — the voided_at addition made this select's own string a
      // concatenation for the first time.
      const weighingRows = (weighings ?? []) as unknown as (FinishedChiqimWeighing & { request_id: string })[]
      const reqRows = (reqs ?? []) as unknown as Omit<FinishedChiqimRequest, 'lines' | 'weighing'>[]
      const lineRows = (lines ?? []) as unknown as RawLine[]

      const combined: FinishedChiqimRequest[] = reqRows
        .filter((r) => !r.plate.startsWith('TEST-'))
        .map((r) => ({
          ...r,
          lines: lineRows.filter((l) => l.request_id === r.id).map(toLine),
          weighing: weighingRows.find((w) => w.request_id === r.id) ?? null,
        }))

      setRequests(sortByDateDesc(combined, (r) => r.created_at))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh, refreshKey])

  return { requests, loading, refresh }
}

// Single-request sibling of useFinishedChiqimRequests above, same three
// tables/columns (CHIQIM_LINE_SELECT/GATE_WEIGHING_SELECT), scoped by id
// instead of fetched in bulk. Built for the Hisobot old-KN passport
// drill-down (ChiqimRequestDetail.tsx via OldKnRequestPassportModal.tsx) —
// a Hisobot row can be arbitrarily far back in history, so this fetches
// exactly the one request rather than pulling every chiqim_requests row the
// bulk hook above does for Menejer's own (small, current-session-scale) W2
// list. Not scoped to any status/line_kind — "all info" for the request,
// whatever it turns out to contain.
export function useChiqimRequestById(requestId: string | null) {
  const [request, setRequest] = useState<FinishedChiqimRequest | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!requestId) {
      setRequest(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const [{ data: req, error: reqErr }, { data: lines }, { data: weighings }] = await Promise.all([
          supabase
            .from('chiqim_requests')
            .select(
              'id, request_date, plate, driver, owner_id, status, truck_type, created_by, created_at, ' +
                'ombor_finished_at, ombor_finished_by, voided_at',
            )
            .eq('id', requestId)
            .single(),
          supabase.from('chiqim_lines').select(CHIQIM_LINE_SELECT).eq('request_id', requestId),
          supabase.from('gate_weighings').select(GATE_WEIGHING_SELECT).eq('dir', 'chiqim').eq('request_id', requestId),
        ])
        if (reqErr) throw reqErr
        if (cancelled) return

        const reqRow = req as unknown as Omit<FinishedChiqimRequest, 'lines' | 'weighing'>
        const lineRows = (lines ?? []) as unknown as RawLine[]
        const weighingRows = (weighings ?? []) as unknown as (FinishedChiqimWeighing & { request_id: string })[]

        setRequest({
          ...reqRow,
          lines: lineRows.map(toLine),
          weighing: weighingRows[0] ?? null,
        })
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "So'rovni yuklashda xatolik yuz berdi.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [requestId])

  return { request, loading, error }
}
