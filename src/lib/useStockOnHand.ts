import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { stockBucketSortIndex, type StockOnHandRow, type StockOnHandSummaryRow, type StockBucket } from './stockOnHand'

interface StockOnHandDbRow {
  bucket: StockBucket
  row_key: string
  serial: string
  barcode2: string | null
  owner_id: string
  type_id: string
  calibre_id: string | null
  qty_kg: number | string
  anchor_date: string
  days_held: number | string
  aged_90: boolean
}

interface StockOnHandSummaryDbRow {
  owner_id: string
  type_id: string
  calibre_id: string | null
  bucket: StockBucket
  total_kg: number | string
  batch_count: number | string
  oldest_days_held: number | string
  aged_90_count: number | string
}

function mapRow(r: StockOnHandDbRow): StockOnHandRow {
  return {
    bucket: r.bucket,
    rowKey: r.row_key,
    serial: r.serial,
    barcode2: r.barcode2,
    ownerId: r.owner_id,
    typeId: r.type_id,
    calibreId: r.calibre_id,
    qtyKg: Number(r.qty_kg),
    anchorDate: r.anchor_date,
    daysHeld: Number(r.days_held),
    aged90: r.aged_90,
  }
}

function mapSummary(r: StockOnHandSummaryDbRow): StockOnHandSummaryRow {
  return {
    ownerId: r.owner_id,
    typeId: r.type_id,
    calibreId: r.calibre_id,
    bucket: r.bucket,
    totalKg: Number(r.total_kg),
    batchCount: Number(r.batch_count),
    oldestDaysHeld: Number(r.oldest_days_held),
    aged90Count: Number(r.aged_90_count),
  }
}

// §3.2.6 — grouped buyurtmachi -> tur -> kalibr -> holat. The grouping itself
// is expressed by sort order over the flat detail rows (rowKey-level, for
// passport drill-down) rather than a new collapsible-tree interaction — the
// task's own furniture-reuse instruction rules out inventing one. Summary
// rows feed the per-bucket header totals; lab_turnaround_avg feeds the one
// header stat §3.2.9 part C asks for here.
export function useStockOnHand() {
  const [rows, setRows] = useState<StockOnHandRow[]>([])
  const [summary, setSummary] = useState<StockOnHandSummaryRow[]>([])
  const [turnaroundAvgDays, setTurnaroundAvgDays] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const [rowsResult, summaryResult, avgResult] = await Promise.all([
          supabase.from('stock_on_hand_rows').select('*'),
          supabase.rpc('stock_on_hand_summary', { p_owner_id: null }),
          supabase.rpc('lab_turnaround_avg'),
        ])
        if (cancelled) return
        const mapped = ((rowsResult.data ?? []) as StockOnHandDbRow[]).map(mapRow)
        mapped.sort((a, b) => {
          if (a.ownerId !== b.ownerId) return a.ownerId.localeCompare(b.ownerId)
          if (a.typeId !== b.typeId) return a.typeId.localeCompare(b.typeId)
          const calA = a.calibreId ?? ''
          const calB = b.calibreId ?? ''
          if (calA !== calB) return calA.localeCompare(calB)
          return stockBucketSortIndex(a.bucket) - stockBucketSortIndex(b.bucket)
        })
        setRows(mapped)
        setSummary(((summaryResult.data ?? []) as StockOnHandSummaryDbRow[]).map(mapSummary))
        setTurnaroundAvgDays(avgResult.data === null || avgResult.data === undefined ? null : Number(avgResult.data))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return { rows, summary, turnaroundAvgDays, loading }
}
