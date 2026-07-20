import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { mapDbRowToReportRow, type ReportFilters, type ReportRow, type ChiqimReportRow, type ReportTotals, type ReportDbRow } from './reportQuery'

// §3.2.1-3.2.4 — the shared query engine, now a thin client over the
// server-side query (see DECISIONS.md "Reporting engine: server-side
// query"). Filtering, ordering, and aggregation all happen in Postgres
// (report_filtered_rows/report_query_page/report_totals); this file's job
// is just: turn ReportFilters into RPC params, turn the flat rows back into
// KirimReportRow/ChiqimReportRow (mapDbRowToReportRow), and hold pagination
// state. No FETCH_CAP here or anywhere downstream — the DB scans however
// many rows match, and totals/count reflect the FULL filtered set even
// though only one page of rows is ever held in memory.
const PAGE_SIZE = 100
const EXPORT_CHUNK_SIZE = 1000
// Safety net only, not a silent truncation point (§ requirement 5): if an
// export somehow needs more than this many rows, fetchAllReportRowsForExport
// throws ExportTooLargeError instead of returning a partial file.
const EXPORT_MAX_CHUNKS = 50

interface RpcParams {
  p_direction: string
  p_from: string
  p_to: string
  p_owner_id: string | null
  p_type_id: string | null
  p_calibre_id: string | null
  p_serial: string | null
  p_barcode2: string | null
  p_plate: string | null
  p_driver: string | null
  p_wash_cycle: string | null
  p_lab_verdict: string | null
  p_status: string | null
}

function toRpcParams(filters: ReportFilters): RpcParams {
  return {
    p_direction: filters.direction,
    p_from: filters.from,
    p_to: filters.to,
    p_owner_id: filters.ownerId || null,
    p_type_id: filters.typeId || null,
    p_calibre_id: filters.calibreId || null,
    p_serial: filters.serial || null,
    p_barcode2: filters.barcode2 || null,
    p_plate: filters.plate || null,
    p_driver: filters.driver || null,
    p_wash_cycle: filters.washCycle || null,
    p_lab_verdict: filters.labVerdict || null,
    p_status: filters.status || null,
  }
}

// §3.2.2 "a voided Barcode #2 must remain findable" — an exact-match lookup
// against report_chiqim_rows directly, bypassing report_filtered_rows
// entirely (a voided, unclaimed pallet has no dispatch date and would never
// survive the date-or-status-override filter otherwise — see the SQL
// function's own comment). Reads the base view, not the paginated RPC.
async function fetchVoidedBarcodeMatch(barcode2Query: string): Promise<ChiqimReportRow | null> {
  const query = barcode2Query.trim()
  if (!query) return null
  const { data } = await supabase
    .from('report_chiqim_rows')
    .select('*')
    .eq('barcode2', query)
    .eq('pallet_status', 'bekor_qilingan')
    .maybeSingle()
  if (!data) return null
  return mapDbRowToReportRow(data as ReportDbRow) as ChiqimReportRow
}

export function useReportQuery(filters: ReportFilters) {
  const [rows, setRows] = useState<ReportRow[]>([])
  const [voidedBarcodeMatch, setVoidedBarcodeMatch] = useState<ChiqimReportRow | null>(null)
  const [totals, setTotals] = useState<ReportTotals>({ kgIn: 0, kgOut: 0, net: 0 })
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  // A new filter set always starts back at page 1 — the previous page
  // number almost never makes sense against a differently-filtered result.
  const filterKey = JSON.stringify(filters)
  useEffect(() => {
    setPage(1)
  }, [filterKey])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const params = toRpcParams(filters)
        const [pageResult, totalsResult, voided] = await Promise.all([
          supabase.rpc('report_query_page', { ...params, p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE }),
          supabase.rpc('report_totals', params),
          fetchVoidedBarcodeMatch(filters.barcode2),
        ])
        if (cancelled) return

        setRows(((pageResult.data ?? []) as ReportDbRow[]).map(mapDbRowToReportRow))

        const t = totalsResult.data?.[0] as { total_count: number | string; total_kg_in: number | string; total_kg_out: number | string } | undefined
        const kgIn = Number(t?.total_kg_in ?? 0)
        const kgOut = Number(t?.total_kg_out ?? 0)
        setTotals({ kgIn, kgOut, net: kgIn - kgOut })
        setTotalCount(Number(t?.total_count ?? 0))
        setVoidedBarcodeMatch(voided)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
    // filterKey captures filters' actual identity; filters itself is a
    // fresh object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, page])

  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  return { rows, voidedBarcodeMatch, totals, totalCount, page, pageCount, setPage, loading }
}

export class ExportTooLargeError extends Error {}

// §3.2.4/§3.2.2 export requirement: always the full filtered set, never
// just the current page — chunked behind the scenes (EXPORT_CHUNK_SIZE)
// rather than one huge request. EXPORT_MAX_CHUNKS is a safety net, not a
// silent cap: if it's ever hit, this throws rather than returning a
// partial file (§ requirement 5 — no silent truncation anywhere).
export async function fetchAllReportRowsForExport(filters: ReportFilters): Promise<ReportRow[]> {
  const params = toRpcParams(filters)
  const all: ReportRow[] = []
  for (let chunk = 0; chunk < EXPORT_MAX_CHUNKS; chunk++) {
    const { data, error } = await supabase.rpc('report_query_page', {
      ...params,
      p_limit: EXPORT_CHUNK_SIZE,
      p_offset: chunk * EXPORT_CHUNK_SIZE,
    })
    if (error) throw error
    const batch = ((data ?? []) as ReportDbRow[]).map(mapDbRowToReportRow)
    all.push(...batch)
    if (batch.length < EXPORT_CHUNK_SIZE) return all
  }
  throw new ExportTooLargeError(
    `Export so'rovi ${EXPORT_MAX_CHUNKS * EXPORT_CHUNK_SIZE} qatordan oshib ketdi -- xavfsizlik uchun to'xtatildi (hech qachon jimgina kesilmaydi). Filtrlarni toraytiring (davr yoki buyurtmachi) va qayta urinib ko'ring.`,
  )
}
