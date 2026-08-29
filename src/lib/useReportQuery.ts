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
  p_directions: string[] | null
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
  p_partiya_no: number | null
}

// p_directions: null (not []) for "no restriction" — matches
// report_filtered_rows(text[],...)'s own
// `p_directions is null or array_length(p_directions, 1) is null` check;
// either form works there, but null is the more conventional "no filter"
// signal to send over the wire.
function toRpcParams(filters: ReportFilters): RpcParams {
  return {
    p_directions: filters.directions.length > 0 ? filters.directions : null,
    p_from: filters.from,
    p_to: filters.to,
    p_owner_id: filters.ownerId || null,
    p_type_id: filters.typeId || null,
    p_calibre_id: filters.calibreId || null,
    p_serial: filters.serial || null,
    p_barcode2: filters.barcode2 || null,
    p_plate: filters.plate || null,
    p_driver: filters.driver || null,
    // Laborator v2 (2026-07-28): the underlying wash_cycle column is always
    // null now (no more re-wash cycles) -- report_query_page/report_totals
    // still require this param (no SQL default), so it's always passed as
    // null rather than exposing a filter control that could never match.
    p_wash_cycle: null,
    p_lab_verdict: filters.labVerdict || null,
    p_status: filters.status || null,
    p_partiya_no: filters.partiya.trim() && !Number.isNaN(Number(filters.partiya.trim())) ? Number(filters.partiya.trim()) : null,
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
  const [totals, setTotals] = useState<ReportTotals>({
    kgIn: 0,
    kgOut: 0,
    net: 0,
    taraIn: 0,
    taraOut: 0,
    totalDeclared: 0,
    totalHisobiy: 0,
    totalToMoyka: 0,
    totalFromMoyka: 0,
    stateSerialCount: 0,
    stateQabulQilingan: 0,
    stateOmbordaQoldi: 0,
    stateMoykagaYuborilgan: 0,
    stateMoykada: 0,
    stateMoykadanChiqgan: 0,
    stateXomJonatilgan: 0,
    stateOlibKetilgan: 0,
  })
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

        const t = totalsResult.data?.[0] as
          | {
              total_count: number | string
              total_kg_in: number | string
              total_kg_out: number | string
              total_kg_tara_in: number | string
              total_kg_tara_out: number | string
              total_declared: number | string
              total_hisobiy: number | string
              total_kg_to_moyka: number | string
              total_kg_from_moyka: number | string
              state_serial_count: number | string
              state_qabul_qilingan: number | string
              state_omborda_qoldi: number | string
              state_moykaga_yuborilgan: number | string
              state_moykada: number | string
              state_moykadan_chiqgan: number | string
              state_xom_jonatilgan: number | string
              state_olib_ketilgan: number | string
            }
          | undefined
        const kgIn = Number(t?.total_kg_in ?? 0)
        const kgOut = Number(t?.total_kg_out ?? 0)
        const taraIn = Number(t?.total_kg_tara_in ?? 0)
        const taraOut = Number(t?.total_kg_tara_out ?? 0)
        const totalDeclared = Number(t?.total_declared ?? 0)
        const totalHisobiy = Number(t?.total_hisobiy ?? 0)
        setTotals({
          kgIn,
          kgOut,
          net: kgIn - kgOut,
          taraIn,
          taraOut,
          totalDeclared,
          totalHisobiy,
          totalToMoyka: Number(t?.total_kg_to_moyka ?? 0),
          totalFromMoyka: Number(t?.total_kg_from_moyka ?? 0),
          stateSerialCount: Number(t?.state_serial_count ?? 0),
          stateQabulQilingan: Number(t?.state_qabul_qilingan ?? 0),
          stateOmbordaQoldi: Number(t?.state_omborda_qoldi ?? 0),
          stateMoykagaYuborilgan: Number(t?.state_moykaga_yuborilgan ?? 0),
          stateMoykada: Number(t?.state_moykada ?? 0),
          stateMoykadanChiqgan: Number(t?.state_moykadan_chiqgan ?? 0),
          stateXomJonatilgan: Number(t?.state_xom_jonatilgan ?? 0),
          stateOlibKetilgan: Number(t?.state_olib_ketilgan ?? 0),
        })
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
