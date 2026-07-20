import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { fetchEffectiveQty } from './effectiveQty'
import { sortByDateDesc } from './sortByDate'
import {
  matchesText,
  washCycleMatches,
  labVerdictMatches,
  derivePalletStatus,
  passesDateOrStatusOverride,
  isTestPlate,
  type ReportFilters,
  type ReportRow,
  type KirimReportRow,
  type ChiqimReportRow,
  type DateBasisSource,
  type VoidedBarcodeInfo,
} from './reportQuery'

// §3.2.1-3.2.4 (SPEC.md v1.10 revision) — the shared query engine. Fetches
// broad, date-agnostic candidate sets (capped, same convention
// useGateHistory.ts/useIntakeHistory.ts already use for tables with no
// reliable server-side date column to page on) then joins + filters client
// side. Every quantity read is `effective_qty` (KIRIM) or a pallet's own
// measured `weight_kg` (CHIQIM) — never `actual_qty`/`declared_qty` directly
// (§2.16.1).
const FETCH_CAP = 500
const VOIDED_SEARCH_CAP = 20

interface KirimLineRow {
  serial: string
  order_id: string
  type_id: string
  declared_qty: number
  target_moisture_pct: number | null
  target_so2_mg_kg: number | null
}

async function fetchKirimReportRows(filters: ReportFilters, materialVariancePct: number): Promise<KirimReportRow[]> {
  if (filters.direction === 'chiqim') return []
  // Barcode #2, kalibr, wash cycle, and lab verdict (as CHIQIM's hard-gate
  // verdict, not KIRIM's verdict-free descriptive check, §5.5.2) don't exist
  // on a KIRIM row at all — asking for any of them can only ever mean "show
  // me CHIQIM/pallet rows", so a KIRIM row structurally can't match.
  if (filters.calibreId || filters.barcode2.trim() || filters.washCycle !== '' || filters.labVerdict !== '' || filters.status !== '') {
    return []
  }

  const { data: intakes } = await supabase
    .from('storage_intake')
    .select('serial, actual_qty')
    .order('confirmed_at', { ascending: false })
    .limit(FETCH_CAP)
  const serials = (intakes ?? []).map((i) => i.serial)
  if (serials.length === 0) return []

  const [{ data: kLines }, { data: labs }, effectiveQtyBySerial] = await Promise.all([
    supabase
      .from('kirim_lines')
      .select('serial, order_id, type_id, declared_qty, target_moisture_pct, target_so2_mg_kg')
      .in('serial', serials),
    supabase.from('lab_results').select('parent_serial, moisture_pct, so2_mg_kg').eq('scope', 'kirim').in('parent_serial', serials),
    fetchEffectiveQty(serials, materialVariancePct),
  ])

  const orderIds = [...new Set(((kLines ?? []) as KirimLineRow[]).map((l) => l.order_id))]
  if (orderIds.length === 0) return []

  const [{ data: orders }, { data: weighings }] = await Promise.all([
    supabase.from('kirim_orders').select('order_id, order_date, plate, driver, owner_id').in('order_id', orderIds),
    supabase.from('gate_weighings').select('order_id, stage1_completed_at, completed_at').eq('dir', 'kirim').in('order_id', orderIds),
  ])

  const lineBySerial = new Map(((kLines ?? []) as KirimLineRow[]).map((l) => [l.serial, l]))
  const orderById = new Map((orders ?? []).map((o) => [o.order_id, o]))
  const weighingByOrder = new Map((weighings ?? []).map((w) => [w.order_id, w]))
  const labBySerial = new Map((labs ?? []).map((l) => [l.parent_serial, l]))

  const rows: KirimReportRow[] = []
  for (const serial of serials) {
    const line = lineBySerial.get(serial)
    if (!line) continue
    const order = orderById.get(line.order_id)
    if (!order) continue
    const eq = effectiveQtyBySerial.get(serial)
    if (!eq) continue
    const weighing = weighingByOrder.get(line.order_id)
    const lab = labBySerial.get(serial)

    // §3.2.3: arrival date — gate stage 1 completion, else the order's own
    // stated date (a truck that hasn't reached the gate yet has no other
    // date to anchor on; in practice storage_intake existing implies stage
    // 1 already happened, §5.1, so this fallback is defensive, not routine).
    const dateBasis = weighing?.stage1_completed_at ? weighing.stage1_completed_at.slice(0, 10) : order.order_date
    const dateBasisSource: DateBasisSource = weighing?.stage1_completed_at ? 'gate_stage1' : 'order_date'

    rows.push({
      kind: 'kirim',
      key: serial,
      serial,
      orderId: line.order_id,
      typeId: line.type_id,
      ownerId: order.owner_id,
      plate: order.plate,
      driver: order.driver,
      dateBasis,
      dateBasisSource,
      declaredQty: line.declared_qty,
      effectiveQtyKg: eq.value,
      provisional: eq.provisional,
      truckVarianceDiffKg: eq.truckVariance?.diffKg ?? null,
      truckVarianceDiffPct: eq.truckVariance?.diffPct ?? null,
      provisionalVarianceFlag: eq.provisionalVarianceFlag,
      targetMoisturePct: line.target_moisture_pct,
      targetSo2MgKg: line.target_so2_mg_kg,
      kirimMoisturePct: lab?.moisture_pct ?? null,
      kirimSo2MgKg: lab?.so2_mg_kg ?? null,
    })
  }

  return rows
    .filter((r) => r.dateBasis !== null && r.dateBasis >= filters.from && r.dateBasis <= filters.to)
    .filter((r) => (filters.ownerId ? r.ownerId === filters.ownerId : true))
    .filter((r) => (filters.typeId ? r.typeId === filters.typeId : true))
    .filter((r) => matchesText(r.serial, filters.serial))
    .filter((r) => matchesText(r.plate, filters.plate))
    .filter((r) => matchesText(r.driver, filters.driver))
    .filter((r) => !isTestPlate(r.plate))
}

interface FinishedPalletRow {
  barcode2: string
  serial: string
  wash_cycle: number
  type_id: string
  calibre_id: string
  weight_kg: number
  status: 'in_stock' | 'dispatched' | 'bekor_qilindi'
}

async function fetchVoidSuccessors(pairs: { serial: string; successorCycle: number }[]): Promise<Map<string, string[]>> {
  const bySerial = new Map<string, string[]>() // key: `${serial}:${successorCycle}` -> barcode2[]
  if (pairs.length === 0) return bySerial
  const serials = [...new Set(pairs.map((p) => p.serial))]
  const { data } = await supabase.from('finished_pallets').select('serial, wash_cycle, barcode2').in('serial', serials)
  for (const p of data ?? []) {
    const key = `${p.serial}:${p.wash_cycle}`
    const list = bySerial.get(key) ?? []
    list.push(p.barcode2)
    bySerial.set(key, list)
  }
  return bySerial
}

async function fetchChiqimReportRows(
  filters: ReportFilters,
): Promise<{ rows: ChiqimReportRow[]; voidedMatch: ChiqimReportRow | null }> {
  if (filters.direction === 'kirim') return { rows: [], voidedMatch: null }

  const barcode2Query = filters.barcode2.trim()

  // dispatch_manifet anchors real dispatch/claim activity (§3.2.4: rows are
  // events) — loaded_at is a real, always-present timestamp (unlike
  // gate_weighings' own gap, flagged in useGateHistory.ts), ordered/capped
  // the same way that file already established. A barcode2 search ALSO
  // reaches into voided pallets directly (never claimed, so never in
  // dispatch_manifest) — the one deliberate exception to "rows are events"
  // (§3.2.2 "a voided Barcode #2 must remain findable").
  const [{ data: manifest }, voidedSearch] = await Promise.all([
    supabase.from('dispatch_manifest').select('barcode2, request_id, loaded_at').order('loaded_at', { ascending: false }).limit(FETCH_CAP),
    barcode2Query
      ? supabase
          .from('finished_pallets')
          .select('barcode2, serial, wash_cycle, type_id, calibre_id, weight_kg, status')
          .eq('status', 'bekor_qilindi')
          .ilike('barcode2', `%${barcode2Query}%`)
          .limit(VOIDED_SEARCH_CAP)
      : Promise.resolve({ data: [] as FinishedPalletRow[] }),
  ])

  const manifestBarcodes = (manifest ?? []).map((m) => m.barcode2)
  const requestIdByBarcode = new Map((manifest ?? []).map((m) => [m.barcode2, m.request_id]))

  const { data: manifestPallets } = manifestBarcodes.length
    ? await supabase
        .from('finished_pallets')
        .select('barcode2, serial, wash_cycle, type_id, calibre_id, weight_kg, status')
        .in('barcode2', manifestBarcodes)
    : { data: [] as FinishedPalletRow[] }

  // Merge, deduped by barcode2 — a voided pallet is never also claimed
  // (handleRewash only voids status='in_stock' pallets, OmborTayyorTab.tsx),
  // so overlap isn't expected in practice; dedup defensively anyway.
  const palletByBarcode = new Map<string, FinishedPalletRow>()
  for (const p of (manifestPallets ?? []) as FinishedPalletRow[]) palletByBarcode.set(p.barcode2, p)
  for (const p of (voidedSearch.data ?? []) as FinishedPalletRow[]) if (!palletByBarcode.has(p.barcode2)) palletByBarcode.set(p.barcode2, p)

  if (palletByBarcode.size === 0) return { rows: [], voidedMatch: null }

  const requestIds = [...new Set([...requestIdByBarcode.values()])]
  const serials = [...new Set([...palletByBarcode.values()].map((p) => p.serial))]

  const [{ data: requests }, { data: weighings }, { data: kLines }, { data: cycles }] = await Promise.all([
    requestIds.length
      ? supabase.from('chiqim_requests').select('id, request_date, plate, driver, owner_id').in('id', requestIds)
      : Promise.resolve({ data: [] as { id: string; request_date: string; plate: string; driver: string; owner_id: string }[] }),
    requestIds.length
      ? supabase.from('gate_weighings').select('request_id, completed_at').eq('dir', 'chiqim').in('request_id', requestIds)
      : Promise.resolve({ data: [] as { request_id: string | null; completed_at: string | null }[] }),
    supabase.from('kirim_lines').select('serial, order_id, target_moisture_pct, target_so2_mg_kg').in('serial', serials),
    supabase.from('wash_cycles').select('id, serial, cycle_no').in('serial', serials),
  ])

  const orderIds = [...new Set((kLines ?? []).map((l) => l.order_id))]
  const { data: orders } = orderIds.length
    ? await supabase.from('kirim_orders').select('order_id, owner_id, plate').in('order_id', orderIds)
    : { data: [] as { order_id: string; owner_id: string; plate: string }[] }

  const requestById = new Map((requests ?? []).map((r) => [r.id, r]))
  const gateByRequest = new Map((weighings ?? []).map((w) => [w.request_id, w]))
  const lineBySerial = new Map((kLines ?? []).map((l) => [l.serial, l]))
  const orderOwnerById = new Map((orders ?? []).map((o) => [o.order_id, o.owner_id]))
  // TEST- exclusion needs the pallet's ORIGINATING kirim_orders plate too —
  // see reportQuery.ts's isTestPlate comment for why a request-only check
  // would miss still-in-storage/voided test pallets.
  const orderPlateById = new Map((orders ?? []).map((o) => [o.order_id, o.plate]))
  const cycleIdByKey = new Map((cycles ?? []).map((c) => [`${c.serial}:${c.cycle_no}`, c.id]))

  const cycleIds = [...cycleIdByKey.values()]
  const { data: labs } = cycleIds.length
    ? await supabase.from('lab_results').select('wash_cycle_id, verdict, moisture_pct, so2_mg_kg').eq('scope', 'chiqim').in('wash_cycle_id', cycleIds)
    : { data: [] as { wash_cycle_id: string; verdict: string | null; moisture_pct: number; so2_mg_kg: number | null }[] }
  const labByCycleId = new Map((labs ?? []).map((l) => [l.wash_cycle_id, l]))

  // Voided pallets need their successor cycle's pallets (§3.2.2) — see
  // reportQuery.ts's VoidedBarcodeInfo doc for why `wash_cycle + 1` is
  // always the right successor, never ambiguous.
  const voidedPallets = [...palletByBarcode.values()].filter((p) => p.status === 'bekor_qilindi')
  const successorsByKey = await fetchVoidSuccessors(voidedPallets.map((p) => ({ serial: p.serial, successorCycle: p.wash_cycle + 1 })))

  const allRows: ChiqimReportRow[] = []
  for (const pallet of palletByBarcode.values()) {
    const requestId = requestIdByBarcode.get(pallet.barcode2) ?? ''
    const request = requestById.get(requestId)
    const gate = gateByRequest.get(requestId)
    const dispatchGateCompletedAt = gate?.completed_at ?? null
    const palletStatus = derivePalletStatus({
      rawStatus: pallet.status,
      claimed: requestId !== '',
      dispatchGateCompletedAt,
    })

    const line = lineBySerial.get(pallet.serial)
    const cycleId = cycleIdByKey.get(`${pallet.serial}:${pallet.wash_cycle}`)
    const lab = cycleId ? labByCycleId.get(cycleId) : undefined

    // TEST- exclusion, checked on EITHER plate before this pallet becomes a
    // row at all — including before the voided-barcode search sees it, so a
    // test fixture stays fully invisible to this engine, not just absent
    // from the default filtered table.
    const originatingPlate = line ? orderPlateById.get(line.order_id) : undefined
    if (isTestPlate(request?.plate) || isTestPlate(originatingPlate)) continue

    let voidInfo: VoidedBarcodeInfo | null = null
    if (palletStatus === 'bekor_qilingan') {
      const successorCycle = pallet.wash_cycle + 1
      voidInfo = {
        voidedCycle: pallet.wash_cycle,
        successorCycle,
        successorBarcodes: successorsByKey.get(`${pallet.serial}:${successorCycle}`) ?? [],
      }
    }

    allRows.push({
      kind: 'chiqim',
      key: pallet.barcode2,
      barcode2: pallet.barcode2,
      serial: pallet.serial,
      typeId: pallet.type_id,
      calibreId: pallet.calibre_id,
      ownerId: (line ? orderOwnerById.get(line.order_id) : undefined) ?? request?.owner_id ?? '',
      requestId,
      plate: request?.plate ?? '',
      driver: request?.driver ?? '',
      weightKg: pallet.weight_kg,
      washCycle: pallet.wash_cycle,
      palletStatus,
      dateBasis: dispatchGateCompletedAt ? dispatchGateCompletedAt.slice(0, 10) : null,
      labVerdict: lab?.verdict === 'o_tdi' || lab?.verdict === 'qayta_yuvish' ? lab.verdict : null,
      targetMoisturePct: line?.target_moisture_pct ?? null,
      targetSo2MgKg: line?.target_so2_mg_kg ?? null,
      moisturePct: lab?.moisture_pct ?? null,
      so2MgKg: lab?.so2_mg_kg ?? null,
      voidInfo,
    })
  }

  const voidedMatch = barcode2Query ? allRows.find((r) => r.palletStatus === 'bekor_qilingan' && r.barcode2 === barcode2Query) ?? null : null

  const rows = allRows
    .filter((r) => passesDateOrStatusOverride(r.dateBasis, r.palletStatus, filters))
    .filter((r) => (filters.status ? r.palletStatus === filters.status : true))
    .filter((r) => (filters.ownerId ? r.ownerId === filters.ownerId : true))
    .filter((r) => (filters.typeId ? r.typeId === filters.typeId : true))
    .filter((r) => (filters.calibreId ? r.calibreId === filters.calibreId : true))
    .filter((r) => washCycleMatches(r.washCycle, filters.washCycle))
    .filter((r) => labVerdictMatches(r.labVerdict, filters.labVerdict))
    .filter((r) => matchesText(r.serial, filters.serial))
    .filter((r) => matchesText(r.barcode2, filters.barcode2))
    .filter((r) => matchesText(r.plate, filters.plate))
    .filter((r) => matchesText(r.driver, filters.driver))

  return { rows, voidedMatch }
}

export interface ReportQueryResult {
  rows: ReportRow[]
  voidedBarcodeMatch: ChiqimReportRow | null
}

export async function fetchReportRows(filters: ReportFilters, materialVariancePct: number): Promise<ReportQueryResult> {
  const [kirimRows, chiqim] = await Promise.all([
    fetchKirimReportRows(filters, materialVariancePct),
    fetchChiqimReportRows(filters),
  ])
  // §3.2.4: newest-first, each row on its own governing event (§3.2.3) — the
  // same universal sort rule (CLAUDE.md) applied across a mixed row set.
  const rows = sortByDateDesc<ReportRow>([...kirimRows, ...chiqim.rows], (r) => r.dateBasis)
  return { rows, voidedBarcodeMatch: chiqim.voidedMatch }
}

export function useReportQuery(filters: ReportFilters, materialVariancePct: number) {
  const [result, setResult] = useState<ReportQueryResult>({ rows: [], voidedBarcodeMatch: null })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const next = await fetchReportRows(filters, materialVariancePct)
        if (!cancelled) setResult(next)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filters.direction,
    filters.from,
    filters.to,
    filters.ownerId,
    filters.typeId,
    filters.calibreId,
    filters.serial,
    filters.barcode2,
    filters.plate,
    filters.driver,
    filters.washCycle,
    filters.labVerdict,
    filters.status,
    materialVariancePct,
  ])

  return { rows: result.rows, voidedBarcodeMatch: result.voidedBarcodeMatch, loading }
}
