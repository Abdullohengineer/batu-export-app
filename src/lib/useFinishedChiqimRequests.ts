import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

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

// Menejer's finished CHIQIM view (§3.1, §5 "CHIQIM per-role finalization"
// invariant — Menejer's own finished signal is Qorovul's stage 2, not
// Ombor's). Only chiqim_requests.status='olib_ketildi' is fetched: the
// trigger (complete_chiqim_stage2, 0020) is the ONLY writer of that field,
// and it never reaches 'yakunlandi' in practice for CHIQIM (confirmed live
// — that enum value belongs to KIRIM's lifecycle), so a single equality
// filter is complete, not a partial match against a set that also needs
// covering.
//
// TEST- prefix hygiene: filtered out here, not exposed as a toggle — no
// other screen in this app has ever built a "show test data" switch, and
// this app has no other run-time signal that distinguishes a real request
// from a test fixture (see DECISIONS.md "void mechanism" entries).
//
// Sort: newest-first by the gate's stage-2 completed_at — this view's own
// finish signal, per the per-role finalization invariant, not
// request_date/created_at or Ombor's ombor_finished_at.
export function useFinishedChiqimRequests() {
  const [requests, setRequests] = useState<FinishedChiqimRequest[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: reqs }, { data: lines }, { data: weighings }] = await Promise.all([
        supabase
          .from('chiqim_requests')
          .select('id, request_date, plate, driver, owner_id, status, created_by, created_at, ombor_finished_at, ombor_finished_by')
          .eq('status', 'olib_ketildi'),
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
        .sort((a, b) => (b.weighing?.completed_at ?? '').localeCompare(a.weighing?.completed_at ?? ''))

      setRequests(combined)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { requests, loading, refresh }
}
