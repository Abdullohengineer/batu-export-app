import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { StockOnHandRow, StockBucket } from './stockOnHand'

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
  moisture_pct: number | string | null
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
    moisturePct: r.moisture_pct === null ? null : Number(r.moisture_pct),
  }
}

// PostgREST caps an unbounded `select('*')` at its configured max-rows
// (1000 by default) and truncates silently past it — the exact failure
// shape the old FETCH_CAP=500 bug had (DECISIONS.md). This screen is now
// one row per barcode/pallet, not per grouped batch, so the row count grows
// much faster than before and could realistically cross that cap. Paginate
// in CHUNK_SIZE pages via `.range()` until a page comes back short (the
// real end of the data) instead of trusting a single unbounded fetch —
// completeness by construction, nothing to silently truncate. CHUNK_MAX is
// a sanity backstop (mirrors useReportQuery.ts's EXPORT_MAX_CHUNKS): if
// this dataset ever somehow exceeds it, fail loudly rather than guess.
const CHUNK_SIZE = 1000
const CHUNK_MAX = 50

export class StockOnHandTooLargeError extends Error {}

async function fetchAllStockOnHandRows(): Promise<StockOnHandRow[]> {
  const all: StockOnHandRow[] = []
  for (let chunk = 0; chunk < CHUNK_MAX; chunk++) {
    const { data, error } = await supabase
      .from('stock_on_hand_rows')
      .select('*')
      .range(chunk * CHUNK_SIZE, chunk * CHUNK_SIZE + CHUNK_SIZE - 1)
    if (error) throw error
    const batch = ((data ?? []) as StockOnHandDbRow[]).map(mapRow)
    all.push(...batch)
    if (batch.length < CHUNK_SIZE) return all
  }
  throw new StockOnHandTooLargeError(
    `Ombor qoldig'i ${CHUNK_MAX * CHUNK_SIZE} qatordan oshib ketdi — xavfsizlik uchun to'xtatildi (hech qachon jimgina kesilmaydi).`,
  )
}

// §3.2.6 — fetches the full row set once (see fetchAllStockOnHandRows for
// why "once, in full" rather than paginated-for-display); filtering,
// sorting, and totals all happen client-side against this array
// (stockOnHand.ts) since it's already a bounded "right now" snapshot, not
// an unbounded history. lab_turnaround_avg stays its own RPC — a single
// header stat, unrelated to filtering.
export function useStockOnHand() {
  const [rows, setRows] = useState<StockOnHandRow[]>([])
  const [turnaroundAvgDays, setTurnaroundAvgDays] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [rowsResult, avgResult] = await Promise.allSettled([fetchAllStockOnHandRows(), supabase.rpc('lab_turnaround_avg')])
      if (rowsResult.status === 'fulfilled') {
        setRows(rowsResult.value)
      } else {
        setRows([])
        setError(
          rowsResult.reason instanceof StockOnHandTooLargeError
            ? rowsResult.reason.message
            : "Ombor qoldig'ini yuklashda xatolik yuz berdi.",
        )
      }
      if (avgResult.status === 'fulfilled') {
        const v = avgResult.value.data
        setTurnaroundAvgDays(v === null || v === undefined ? null : Number(v))
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { rows, turnaroundAvgDays, loading, error, refresh }
}
