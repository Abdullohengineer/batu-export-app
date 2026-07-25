import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { sortByDateDesc } from './sortByDate'

export interface FinishedChiqimLine {
  type_id: string
  calibre_id: string
  qty_kg: number
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
  created_by: string | null
  created_at: string
  ombor_finished_at: string | null
  ombor_finished_by: string | null
  lines: FinishedChiqimLine[]
  weighing: FinishedChiqimWeighing | null
}

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
          .select('id, request_date, plate, driver, owner_id, status, created_by, created_at, ombor_finished_at, ombor_finished_by'),
        supabase.from('chiqim_lines').select('type_id, calibre_id, qty_kg, request_id'),
        supabase
          .from('gate_weighings')
          .select(
            'id, request_id, gruzheny_kg, pustoy_kg, net_kg, stage1_created_by, stage1_completed_at, ' +
              'stage1_plate_photo, stage1_scale_photo, stage2_created_by, stage2_scale_photo, departure_doc_photo, completed_at',
          )
          .eq('dir', 'chiqim'),
      ])

      // Cast explicitly, same reason as useGateHistory.ts: without generated
      // DB types, a `select()` built from a concatenated string (not a
      // literal) widens to a union that includes PostgREST's generic error
      // shape, which breaks property access below.
      const weighingRows = (weighings ?? []) as unknown as (FinishedChiqimWeighing & { request_id: string })[]

      const combined: FinishedChiqimRequest[] = (reqs ?? [])
        .filter((r) => !r.plate.startsWith('TEST-'))
        .map((r) => ({
          ...r,
          lines: (lines ?? []).filter((l) => l.request_id === r.id),
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
