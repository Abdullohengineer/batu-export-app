import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { MonthlyTrendRow, ClientRankingRow, ProductMixRow, ExceptionRow, ExceptionKind } from './rahbarDashboard'
import { exceptionKindSortIndex } from './rahbarDashboard'

interface MonthlyTrendDbRow {
  month: string
  volume_in_kg: number | string
  volume_out_kg: number | string
  raw_consumed_kg: number | string
  output_kg: number | string
  gross_yield_pct: number | string | null
  gross_loss_pct: number | string | null
  dry_matter_true_loss_pct: number | string | null
  dry_matter_serial_count: number | string
  yield_serial_count: number | string
  rewash_rate_pct: number | string | null
  rewash_count: number | string
  utilization_pct: number | string | null
  calibre_mix: MonthlyTrendRow['calibreMix']
}

function n(v: number | string | null): number | null {
  return v === null ? null : Number(v)
}

// §3.2.10 part 1: monthly trends (volume in/out, yield%, loss%, dry-matter
// true loss%, re-wash rate%, calibre mix drift, utilisation% -- the last
// null across the board until practical_capacity_kg_per_month is actually
// configured, confirmed with the user: never a guessed placeholder).
export function useMonthlyTrends() {
  const [rows, setRows] = useState<MonthlyTrendRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const { data } = await supabase.rpc('rahbar_monthly_trends')
        if (cancelled) return
        const mapped = ((data ?? []) as MonthlyTrendDbRow[]).map((r) => ({
          month: r.month,
          volumeInKg: Number(r.volume_in_kg),
          volumeOutKg: Number(r.volume_out_kg),
          rawConsumedKg: Number(r.raw_consumed_kg),
          outputKg: Number(r.output_kg),
          grossYieldPct: n(r.gross_yield_pct),
          grossLossPct: n(r.gross_loss_pct),
          dryMatterTrueLossPct: n(r.dry_matter_true_loss_pct),
          dryMatterSerialCount: Number(r.dry_matter_serial_count),
          yieldSerialCount: Number(r.yield_serial_count),
          rewashRatePct: n(r.rewash_rate_pct),
          rewashCount: Number(r.rewash_count),
          utilizationPct: n(r.utilization_pct),
          calibreMix: r.calibre_mix ?? [],
        }))
        setRows(mapped)
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

// §3.2.10 part 2/3: client ranking + product mix, both period-scoped
// (matches §6.1's own "all date-filtered" rule).
export function useClientRankingAndProductMix(from: string, to: string) {
  const [ranking, setRanking] = useState<ClientRankingRow[]>([])
  const [productMix, setProductMix] = useState<ProductMixRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const [rankingResult, mixResult] = await Promise.all([
          supabase.rpc('rahbar_client_ranking', { p_from: from, p_to: to }),
          supabase.rpc('rahbar_product_mix', { p_from: from, p_to: to }),
        ])
        if (cancelled) return
        setRanking(
          ((rankingResult.data ?? []) as { owner_id: string; owner_name: string; received_kg: number | string; dispatched_kg: number | string }[]).map((r) => ({
            ownerId: r.owner_id,
            ownerName: r.owner_name,
            receivedKg: Number(r.received_kg),
            dispatchedKg: Number(r.dispatched_kg),
          })),
        )
        setProductMix(
          ((mixResult.data ?? []) as { type_id: string; received_kg: number | string; pct_of_total: number | string }[]).map((r) => ({
            typeId: r.type_id,
            receivedKg: Number(r.received_kg),
            pctOfTotal: Number(r.pct_of_total),
          })),
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [from, to])

  return { ranking, productMix, loading }
}

// §3.2.10 part 4 / §6.2: exceptions only, not row lists. Sorted by kind
// priority (lab_overdue first -- same "highest value row" framing §3.2.9
// already established for the identical underlying check).
export function useRahbarExceptions() {
  const [rows, setRows] = useState<ExceptionRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const { data } = await supabase.rpc('rahbar_exceptions')
        if (cancelled) return
        const mapped = (
          (data ?? []) as { exception_kind: ExceptionKind; row_key: string; owner_id: string; serial: string | null; type_id: string | null; detail: Record<string, unknown> }[]
        ).map((r) => ({
          exceptionKind: r.exception_kind,
          rowKey: r.row_key,
          ownerId: r.owner_id,
          serial: r.serial,
          typeId: r.type_id,
          detail: r.detail,
        }))
        mapped.sort((a, b) => exceptionKindSortIndex(a.exceptionKind) - exceptionKindSortIndex(b.exceptionKind))
        setRows(mapped)
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

// Reuses the EXISTING lab_turnaround_avg() (0028) -- no new SQL needed.
// Displayed next to (hidden-when-unset) capacity utilisation per the user's
// explicit request: the lab is a hard gate on dispatch, so washing capacity
// can look healthy while dispatch stalls -- both numbers together, not one.
export function useLabTurnaroundAvg() {
  const [avgDays, setAvgDays] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const { data } = await supabase.rpc('lab_turnaround_avg')
        if (!cancelled) setAvgDays(data === null ? null : Number(data))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return { avgDays, loading }
}
