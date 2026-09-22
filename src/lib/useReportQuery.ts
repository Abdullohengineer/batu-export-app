import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { queryClient, queryKeys } from './queryClient'
import { callRpc } from './rpc'
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
// 2026-09-19 (Hisobot perf pass, Change 1) — filter changes are debounced
// this long before the RPCs fire, so fast typing in serial/barcode2/plate/
// driver doesn't fire report_query_page + report_totals once per
// keystroke. Page navigation and the initial load are NOT debounced (see
// the load-trigger logic below) — those should feel instant.
const FILTER_DEBOUNCE_MS = 300
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
//
// Best-effort: this is a supplementary callout, not the main data — an
// error or an aborted-in-flight request (see useReportQuery's own
// abortSignal wiring) both just mean "no callout this time," never a
// reason to fail the whole load().
async function fetchVoidedBarcodeMatch(barcode2Query: string, signal: AbortSignal): Promise<ChiqimReportRow | null> {
  const query = barcode2Query.trim()
  if (!query) return null
  const { data } = await supabase
    .from('report_chiqim_rows')
    .select('*')
    .eq('barcode2', query)
    .eq('pallet_status', 'bekor_qilingan')
    .abortSignal(signal)
    .maybeSingle()
  if (!data) return null
  return mapDbRowToReportRow(data as ReportDbRow) as ChiqimReportRow
}

// The 9 filter params the DISPATCH half of report_page_enrich depends on.
// Not cosmetic: chiqim_dispatch_calibre_breakdown's is_match consumes every
// one of them, so two pages with the same request_id but different filters
// have genuinely different k1..kn. See queryKeys.reportDispatch.
function dispatchFilterKey(params: RpcParams): string {
  return JSON.stringify([
    params.p_directions, params.p_type_id, params.p_calibre_id, params.p_serial,
    params.p_barcode2, params.p_wash_cycle, params.p_lab_verdict, params.p_status,
    params.p_partiya_no,
  ])
}

type EnrichRow = { row_type: 'bundle' | 'dispatch'; key: string } & Record<string, unknown>
// What one page-row's enrichment looks like once cached. `null` is a real,
// cacheable answer meaning "the server returned no enrichment for this key" —
// stored so a serial/request with genuinely no bundle row is not re-requested
// on every single page render.
type CachedEnrich = Record<string, unknown> | null

// STEP 1c — fetch the page as TWO cheap statements instead of one ~2s one.
//
// (a) report_query_page_rows: filters/order/limit/offset only. Measured
//     74-160ms as rahbar, against 303-621ms for the old combined call.
// (b) report_page_enrich: both enrichment halves, set-based, in ONE call —
//     and only for the keys not already cached.
//
// Joined here rather than in SQL. report_page_enrich's output columns are
// named to match report_query_page's own output, so this is a plain merge:
// the bundle->output remap (state_moykaga_yuborilgan <- moyka_range_to_moyka_kg
// and friends) lives in the SQL, once, instead of being re-derived here.
async function fetchPageWithEnrichment(
  params: RpcParams,
  limit: number,
  offset: number,
  signal: AbortSignal,
): Promise<ReportDbRow[]> {
  const rows = await callRpc<ReportDbRow[]>(
    'report_query_page_rows',
    { ...params, p_limit: limit, p_offset: offset },
    signal,
  )
  const page = rows ?? []
  if (page.length === 0) return page

  const fKey = dispatchFilterKey(params)
  const serials = [...new Set(page.map((r) => r.serial).filter((s): s is string => Boolean(s)))]
  const dispatchKeys = [
    ...new Set(
      page
        .filter((r) => r.kind === 'chiqim_dispatch')
        .map((r) => r.request_id)
        .filter((k): k is string => Boolean(k)),
    ),
  ]

  const bundleKeyOf = (s: string) => queryKeys.reportBundle(s, params.p_from, params.p_to)
  const dispatchKeyOf = (k: string) => queryKeys.reportDispatch(k, params.p_from, params.p_to, fKey)

  const missingSerials = serials.filter((s) => queryClient.getQueryData(bundleKeyOf(s)) === undefined)
  const missingDispatch = dispatchKeys.filter((k) => queryClient.getQueryData(dispatchKeyOf(k)) === undefined)

  // Everything already cached — no second round trip at all. This is the case
  // that makes re-searching a narrowed filter cheap.
  if (missingSerials.length > 0 || missingDispatch.length > 0) {
    const enriched = await callRpc<EnrichRow[]>(
      'report_page_enrich',
      {
        p_serials: missingSerials,
        p_dispatch_keys: missingDispatch,
        p_from: params.p_from,
        p_to: params.p_to,
        p_directions: params.p_directions,
        p_type_id: params.p_type_id,
        p_calibre_id: params.p_calibre_id,
        p_serial: params.p_serial,
        p_barcode2: params.p_barcode2,
        p_wash_cycle: params.p_wash_cycle,
        p_lab_verdict: params.p_lab_verdict,
        p_status: params.p_status,
        p_partiya_no: params.p_partiya_no,
      },
      signal,
    )

    const byBundle = new Map<string, Record<string, unknown>>()
    const byDispatch = new Map<string, Record<string, unknown>>()
    for (const e of enriched ?? []) {
      const { row_type, key, ...cols } = e
      if (!key) continue
      ;(row_type === 'dispatch' ? byDispatch : byBundle).set(key, cols)
    }
    // Write EVERY requested key, including the ones that came back empty, so
    // "no enrichment for this key" is cached as null rather than re-requested
    // forever.
    for (const s of missingSerials) queryClient.setQueryData<CachedEnrich>(bundleKeyOf(s), byBundle.get(s) ?? null)
    for (const k of missingDispatch) queryClient.setQueryData<CachedEnrich>(dispatchKeyOf(k), byDispatch.get(k) ?? null)
  }

  return page.map((row) => {
    const bundle = row.serial ? queryClient.getQueryData<CachedEnrich>(bundleKeyOf(row.serial)) : null
    const dispatch =
      row.kind === 'chiqim_dispatch' && row.request_id
        ? queryClient.getQueryData<CachedEnrich>(dispatchKeyOf(row.request_id))
        : null
    return { ...row, ...(bundle ?? {}), ...(dispatch ?? {}) } as ReportDbRow
  })
}

// `reloadToken` (2026-09-22): bumped by useSearchTrigger on every Qidirish
// press. It participates in filterKey so that pressing Enter mid-flight
// aborts the in-flight request and re-runs even when the filters compare
// equal, and so that an explicit press fires IMMEDIATELY rather than paying
// the 300ms filter debounce — the debounce exists to collapse typing, and a
// deliberate click is not typing. Defaulted, so the screens that have not
// been moved onto the explicit-search pattern keep their old behaviour.
export function useReportQuery(filters: ReportFilters, reloadToken = 0) {
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
    stateMoykagaYuborilganLifetime: 0,
    stateMoykadanChiqganLifetime: 0,
    stateXomJonatilgan: 0,
    stateOlibKetilgan: 0,
    stateYoqotish: 0,
    stateK1: 0,
    stateK2: 0,
    stateK3: 0,
    stateK4: 0,
    stateK5: 0,
    stateK6: 0,
    stateK7: 0,
    stateK8: 0,
    stateKn: 0,
  })
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  // 2026-09-19 (post-debounce incident, see docs/decisions/ — Hisobot
  // search returning empty/mismatched results under load) — report_totals
  // and report_query_page were failing server-side (Postgres 57014,
  // "canceling statement due to statement timeout") under bursts of
  // concurrent requests, and the old code never checked `.error` on either
  // RPC result — a failed request silently rendered as "zero rows" (or
  // "N natija topildi" from a totals call that happened to succeed next to
  // a page call that didn't), indistinguishable from a genuine empty
  // result. Surfaced here instead of swallowed; see the load() body below.
  const [error, setError] = useState<string | null>(null)

  // A new filter set always starts back at page 1 — the previous page
  // number almost never makes sense against a differently-filtered result.
  const filterKey = JSON.stringify([filters, reloadToken])
  useEffect(() => {
    setPage(1)
  }, [filterKey])
  const prevReloadTokenRef = useRef(reloadToken)

  // isInitialMount / prevFilterKeyRef (Change 1) — decide, per effect run,
  // whether this fetch is the first load (fire immediately), a filter
  // change (debounce FILTER_DEBOUNCE_MS so rapid typing collapses into one
  // request), or a page-navigation-only change (fire immediately — paging
  // should feel instant, it's not the thing that scales with typing speed).
  const isInitialMount = useRef(true)
  const prevFilterKeyRef = useRef(filterKey)

  useEffect(() => {
    // AbortController, not a plain boolean — a superseded request's HTTP
    // call is actually cancelled (see the two `.abortSignal(...)` calls
    // below), not just ignored on arrival. This is what breaks the pile-up
    // that caused the 2026-09-19 incident: previously, a debounced load()
    // that had already fired kept running on the server for its FULL
    // duration even after a newer filter change superseded it client-side
    // (no cancellation signal was ever sent), so rapid interaction could
    // leave several of these real, uncancelled report_totals/
    // report_query_page calls in flight at once, competing for the same
    // Postgres connections/CPU — confirmed live via Supabase logs: bursts
    // of paired report_query_page + report_totals calls failing together
    // with Postgres 57014 ("canceling statement due to statement
    // timeout"), not a data or SQL-correctness problem. Aborting a
    // superseded request tells the browser to drop the connection
    // immediately instead of waiting it out, which is what actually
    // reduces concurrent DB load as interactions pile up — the debounce
    // alone only delayed when a request FIRED, it never stopped one that
    // had already fired.
    const controller = new AbortController()
    let debounceId: ReturnType<typeof setTimeout> | undefined

    async function load() {
      setLoading(true)
      try {
        // Built ONCE, used for both calls below — report_query_page and
        // report_totals must never be able to drift onto different filter
        // args, and passing the same `params` object to both is what
        // guarantees that structurally, not just by convention.
        const params = toRpcParams(filters)
        // 2026-09-19 (Phase 1B): the two RPCs go through React Query's cache
        // rather than straight to supabase, so re-entering Hisobot (or the
        // client Приход tab, which shares this hook) with the same filters
        // inside the cache window reuses the result instead of re-running
        // report_query_page + report_totals — together ~35% of all measured
        // database time.
        //
        // fetchQuery, NOT useQuery: this hook's debounce/abort/pagination
        // logic below is load-bearing and has its own incident history (see
        // the AbortController comment above). Wrapping just the fetch keeps
        // every one of those semantics byte-for-byte — including "on error,
        // keep the last good rows rather than rendering a fabricated empty
        // result" — while still getting dedupe and caching. A full useQuery
        // rewrite of this hook would have been a behaviour rewrite of the
        // one screen that already handles this correctly.
        //
        // The `.error`-not-throw convention is preserved by resolving to the
        // same { data, error } shape the callers below already expect.
        const pageKey = ['report_query_page_rows', params, PAGE_SIZE, (page - 1) * PAGE_SIZE] as const
        const totalsKey = ['report_totals', params] as const
        const [pageResult, totalsResult, voided] = await Promise.all([
          queryClient
            .fetchQuery({
              queryKey: pageKey,
              // 2026-09-22 (see docs/decisions/0218): this used to be a single
              // report_query_page call that did filtering, per-serial bundle
              // LATERALs and a per-row dispatch LATERAL in ONE ~2s statement.
              // Aborting the HTTP request does not cancel that statement, so
              // rapid filter changes left several of them holding connections
              // out of PostgREST's 10-connection pool until the 6th request
              // queued and died on statement_timeout. Split into a cheap rows
              // query plus a cached, set-based enrichment pass.
              queryFn: () =>
                fetchPageWithEnrichment(params, PAGE_SIZE, (page - 1) * PAGE_SIZE, controller.signal),
            })
            .then((data) => ({ data, error: null as { message: string } | null }))
            .catch((err: { message?: string }) => ({ data: null, error: { message: err?.message ?? 'RPC error' } })),
          queryClient
            .fetchQuery({
              queryKey: totalsKey,
              queryFn: async () => {
                const res = await supabase.rpc('report_totals', params).abortSignal(controller.signal)
                if (res.error) throw res.error
                return res.data
              },
            })
            .then((data) => ({ data, error: null as { message: string } | null }))
            .catch((err: { message?: string }) => ({ data: null, error: { message: err?.message ?? 'RPC error' } })),
          fetchVoidedBarcodeMatch(filters.barcode2, controller.signal),
        ])
        // Superseded by a newer effect instance (filter/page changed, or
        // unmount) while this was in flight — its own load() already owns
        // (or will own) `rows`/`totals`/`totalCount`/`error`; committing
        // this stale response over that would be exactly the race this
        // guard exists to prevent. Checked BEFORE looking at `.error`,
        // since an aborted request resolves as an error too (an
        // AbortError, not a real failure) — that path is silent by
        // design, never surfaced to the user.
        if (controller.signal.aborted) return

        // Real, non-abort error from either RPC — surface it and stop.
        // Deliberately does NOT call setRows/setTotals/setTotalCount here:
        // this is the exact bug this fix targets (a failed
        // report_query_page silently rendering as "0 rows", or a failed
        // report_totals silently rendering "0 natija" next to a
        // successful page fetch) — showing stale-but-real last-known data
        // under an error banner is less misleading than replacing it with
        // a fabricated empty result.
        if (pageResult.error || totalsResult.error) {
          setError(pageResult.error?.message ?? totalsResult.error?.message ?? "Ma'lumotlarni yuklashda xatolik yuz berdi.")
          setLoading(false)
          return
        }
        setError(null)

        // `as ReportRow[]`: report_query_page never emits kind: 'chiqim' (see
        // ReportDbRow.kind's own comment) -- mapDbRowToReportRow's return
        // type is widened to include ChiqimReportRow only for
        // fetchVoidedBarcodeMatch's direct report_chiqim_rows read below,
        // which this RPC-backed path can never produce.
        setRows(((pageResult.data ?? []) as ReportDbRow[]).map(mapDbRowToReportRow) as ReportRow[])

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
              state_moykaga_yuborilgan_lifetime: number | string
              state_moykadan_chiqgan_lifetime: number | string
              state_xom_jonatilgan: number | string
              state_olib_ketilgan: number | string
              state_yoqotish: number | string
              state_k1: number | string
              state_k2: number | string
              state_k3: number | string
              state_k4: number | string
              state_k5: number | string
              state_k6: number | string
              state_k7: number | string
              state_k8: number | string
              state_kn: number | string
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
          stateMoykagaYuborilganLifetime: Number(t?.state_moykaga_yuborilgan_lifetime ?? 0),
          stateMoykadanChiqganLifetime: Number(t?.state_moykadan_chiqgan_lifetime ?? 0),
          stateXomJonatilgan: Number(t?.state_xom_jonatilgan ?? 0),
          stateOlibKetilgan: Number(t?.state_olib_ketilgan ?? 0),
          // Already coalesced to 0 server-side (report_totals' realized_loss
          // CTE) — the ?? 0 here is the same defensive default every sibling
          // carries for the "no rows came back at all" case.
          stateYoqotish: Number(t?.state_yoqotish ?? 0),
          stateK1: Number(t?.state_k1 ?? 0),
          stateK2: Number(t?.state_k2 ?? 0),
          stateK3: Number(t?.state_k3 ?? 0),
          stateK4: Number(t?.state_k4 ?? 0),
          stateK5: Number(t?.state_k5 ?? 0),
          stateK6: Number(t?.state_k6 ?? 0),
          stateK7: Number(t?.state_k7 ?? 0),
          stateK8: Number(t?.state_k8 ?? 0),
          stateKn: Number(t?.state_kn ?? 0),
        })
        setTotalCount(Number(t?.total_count ?? 0))
        setVoidedBarcodeMatch(voided)
      } catch (err) {
        // Safety net for a genuine JS exception (e.g. mapDbRowToReportRow
        // choking on an unexpected row shape) rather than an RPC-level
        // `.error` — still must not be swallowed. An abort can in
        // principle surface here too depending on the runtime, so it gets
        // the same "superseded, not a real failure" pass-through as above.
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : "Ma'lumotlarni yuklashda xatolik yuz berdi.")
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    const filterChanged = prevFilterKeyRef.current !== filterKey
    prevFilterKeyRef.current = filterKey
    const searchPressed = prevReloadTokenRef.current !== reloadToken
    prevReloadTokenRef.current = reloadToken

    if (isInitialMount.current) {
      isInitialMount.current = false
      load() // initial load — never debounced
    } else if (searchPressed) {
      load() // explicit Qidirish — deliberate intent, fire now, no debounce
    } else if (filterChanged) {
      debounceId = setTimeout(load, FILTER_DEBOUNCE_MS) // filter change — debounced
    } else {
      load() // page navigation only — never debounced, should feel instant
    }

    return () => {
      controller.abort()
      if (debounceId !== undefined) clearTimeout(debounceId)
    }
    // filterKey captures filters' actual identity; filters itself is a
    // fresh object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, page])

  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  return { rows, voidedBarcodeMatch, totals, totalCount, page, pageCount, setPage, loading, error }
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
    // Same invariant as the setRows call above: report_query_page never
    // emits kind: 'chiqim', so this cast is safe.
    const batch = ((data ?? []) as ReportDbRow[]).map(mapDbRowToReportRow) as ReportRow[]
    all.push(...batch)
    if (batch.length < EXPORT_CHUNK_SIZE) return all
  }
  throw new ExportTooLargeError(
    `Export so'rovi ${EXPORT_MAX_CHUNKS * EXPORT_CHUNK_SIZE} qatordan oshib ketdi -- xavfsizlik uchun to'xtatildi (hech qachon jimgina kesilmaydi). Filtrlarni toraytiring (davr yoki buyurtmachi) va qayta urinib ko'ring.`,
  )
}
