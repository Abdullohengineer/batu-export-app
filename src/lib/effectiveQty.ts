import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import {
  deriveEffectiveQty,
  computeVariance,
  isMaterialVariance,
  type WeightAuthorityBasis,
  type QtyVariance,
  type PendingOn,
} from './weightAuthority'

export interface EffectiveQtyInfo {
  value: number
  provisional: boolean
  basis: WeightAuthorityBasis
  isMultiLine: boolean
  gateNet: number | null
  gateStage2Done: boolean
  declaredQty: number
  intakeActualQty: number | null
  // §2.16 box mass (KIRIM only): Σ box_mass_kg across every line on this
  // order — null until every line has been accepted (mandatory field, so
  // "accepted" and "box mass known" are the same event per line). Whatever
  // reads gateNet as the truck's product total must subtract this, never
  // gateNet alone.
  totalBoxMassKg: number | null
  // Which of the two independent pending inputs (gate stage 2 / box mass)
  // is still missing — only meaningful while provisional && basis ===
  // 'intake_provisional'.
  pendingOn: PendingOn
  // §5.1 amend: true net (gate net − total box mass) vs the order's
  // declared total (Jami avto) — null until BOTH gate stage 2 and box mass
  // are known, there is nothing final to compare yet.
  truckVariance: QtyVariance | null
  // §2.15.1 multi-line-only: sum of this order's lines' own effective_qty
  // vs the truck's true net — null for single-line trucks (nothing to
  // reconcile, the line already IS the true net) or before both gate stage
  // 2 and box mass are known.
  lineReconciliation: QtyVariance | null
  // §2.15.2 edge case: at least one moyka_sends row predates gate stage 2 +
  // box mass both completing AND the final (true-net) figure differs
  // materially from what was provisional at send time. Single-line only —
  // a multi-line truck's effective_qty never re-bases onto true net, so it
  // can never trigger this.
  provisionalVarianceFlag: boolean
}

// §2.15 (SPEC.md v1.10) — the single derived source every consumer reads,
// mirroring activeCycles.ts's split (weightAuthority.ts holds the pure
// rule; this is the I/O + combination layer around it, per CLAUDE.md
// "derive, don't store"). Batches by ORDER, not just the requested serials
// — a multi-line reconciliation needs every line on the trip, even if the
// caller only asked about one of them (same reasoning activeCycles.ts
// documents for why it can't derive a single serial's cycle in isolation).
//
// 🔒 Redundant-fetch collapse (2026-07-20, see DECISIONS.md "Reporting
// engine cleanup: test-data DELETE, TEST- filter, redundant-fetch
// collapse"): `prefetched` lets a caller that has ALREADY fetched
// storage_intake/moyka_sends this refresh (useMoykaSerials.ts — both
// UNFILTERED, table-wide fetches, identical to what this function needs)
// pass those rows through instead of triggering two more Frankfurt-to-
// Tashkent round trips for data already in hand. Optional and additive —
// every other caller (useEffectiveQty, useReportQuery) omits it and gets
// the original always-fetch-fresh behaviour unchanged. A version of this
// was built and verified once before (Step 9 prompt 4) and reverted at the
// time purely to avoid bundling it with that session's race-guard fix, not
// because it didn't work — same design, actually shipped this time.
export async function fetchEffectiveQty(
  serials: string[],
  materialVariancePct: number,
  prefetched?: {
    intakes?: { serial: string; actual_qty: number; box_mass_kg: number }[]
    sends?: { serial: string; sent_date: string }[]
  },
): Promise<Map<string, EffectiveQtyInfo>> {
  const result = new Map<string, EffectiveQtyInfo>()
  if (serials.length === 0) return result

  const { data: seedLines } = await supabase.from('kirim_lines').select('serial, order_id').in('serial', serials)
  const orderIds = [...new Set((seedLines ?? []).map((l) => l.order_id))]
  if (orderIds.length === 0) return result

  const [{ data: allLines }, intakesResult, { data: weighings }, { data: orders }, sendsResult] = await Promise.all([
    supabase.from('kirim_lines').select('serial, order_id, declared_qty').in('order_id', orderIds),
    prefetched?.intakes
      ? Promise.resolve({ data: prefetched.intakes })
      : supabase.from('storage_intake').select('serial, actual_qty, box_mass_kg'),
    supabase.from('gate_weighings').select('order_id, net_kg, completed_at').eq('dir', 'kirim').in('order_id', orderIds),
    supabase.from('kirim_orders').select('order_id, declared_total').in('order_id', orderIds),
    prefetched?.sends ? Promise.resolve({ data: prefetched.sends }) : supabase.from('moyka_sends').select('serial, sent_date'),
  ])
  const intakes = intakesResult.data
  const sends = sendsResult.data

  const linesByOrder = new Map<string, { serial: string; declared_qty: number }[]>()
  const orderBySerial = new Map<string, string>()
  const declaredBySerial = new Map<string, number>()
  for (const l of allLines ?? []) {
    const list = linesByOrder.get(l.order_id) ?? []
    list.push({ serial: l.serial, declared_qty: l.declared_qty })
    linesByOrder.set(l.order_id, list)
    orderBySerial.set(l.serial, l.order_id)
    declaredBySerial.set(l.serial, l.declared_qty)
  }
  const intakeBySerial = new Map((intakes ?? []).map((i) => [i.serial, i]))
  const weighingByOrder = new Map((weighings ?? []).map((w) => [w.order_id, w]))
  const declaredTotalByOrder = new Map((orders ?? []).map((o) => [o.order_id, o.declared_total]))

  // Earliest send per serial, date-only — moyka_sends has no created_at, so
  // this is the finest-grained "was this sent while still provisional"
  // signal available. Documented limitation, not a blocker: see
  // DECISIONS.md "Weight authority & effective quantity".
  const earliestSendBySerial = new Map<string, string>()
  for (const s of sends ?? []) {
    const prev = earliestSendBySerial.get(s.serial)
    if (!prev || s.sent_date < prev) earliestSendBySerial.set(s.serial, s.sent_date)
  }

  // §2.16 box mass: null until every line on the order has been accepted
  // (box_mass_kg is mandatory at accept time, so "accepted" and "box mass
  // recorded" are the same event per line) — mirrors report_kirim_rows'
  // own box_mass CTE (bool_and gate before summing), see DECISIONS.md.
  const totalBoxMassByOrder = new Map<string, number | null>()
  for (const orderId of orderIds) {
    const lines = linesByOrder.get(orderId) ?? []
    const allAccepted = lines.length > 0 && lines.every((l) => intakeBySerial.has(l.serial))
    totalBoxMassByOrder.set(
      orderId,
      allAccepted ? lines.reduce((sum, l) => sum + (intakeBySerial.get(l.serial)?.box_mass_kg ?? 0), 0) : null,
    )
  }

  // trueNet = gate net minus the truck's total box mass — the figure every
  // truck-level comparison below reads instead of raw net_kg. Null unless
  // both independent inputs (gate stage 2, box mass) are known.
  const trueNetByOrder = new Map<string, number | null>()
  for (const orderId of orderIds) {
    const weighing = weighingByOrder.get(orderId)
    const totalBoxMass = totalBoxMassByOrder.get(orderId) ?? null
    trueNetByOrder.set(
      orderId,
      weighing?.completed_at != null && weighing.net_kg !== null && totalBoxMass !== null
        ? weighing.net_kg - totalBoxMass
        : null,
    )
  }

  const reconciliationByOrder = new Map<string, QtyVariance | null>()
  for (const orderId of orderIds) {
    const trueNet = trueNetByOrder.get(orderId) ?? null
    const lines = linesByOrder.get(orderId) ?? []
    if (trueNet === null || lines.length <= 1) {
      reconciliationByOrder.set(orderId, null)
      continue
    }
    const sumOfLines = lines.reduce((sum, l) => sum + (intakeBySerial.get(l.serial)?.actual_qty ?? 0), 0)
    reconciliationByOrder.set(orderId, computeVariance(trueNet, sumOfLines))
  }

  for (const serial of serials) {
    const orderId = orderBySerial.get(serial)
    if (!orderId) continue
    const declaredQty = declaredBySerial.get(serial) ?? 0
    const intake = intakeBySerial.get(serial) ?? null
    const weighing = weighingByOrder.get(orderId) ?? null
    const isMultiLine = (linesByOrder.get(orderId) ?? []).length > 1
    const gateNet = weighing?.net_kg ?? null
    const gateStage2Done = weighing?.completed_at != null
    const totalBoxMassKg = totalBoxMassByOrder.get(orderId) ?? null
    const trueNet = trueNetByOrder.get(orderId) ?? null

    const derived = deriveEffectiveQty({
      declaredQty,
      intakeActualQty: intake?.actual_qty ?? null,
      isMultiLine,
      gateNet,
      gateStage2Done,
      totalBoxMassKg,
    })

    const declaredTotal = declaredTotalByOrder.get(orderId) ?? null
    const truckVariance = trueNet !== null && declaredTotal !== null ? computeVariance(declaredTotal, trueNet) : null

    let provisionalVarianceFlag = false
    if (!isMultiLine && trueNet !== null && intake) {
      const firstSend = earliestSendBySerial.get(serial)
      const gateCompletedDate = weighing?.completed_at ? weighing.completed_at.slice(0, 10) : null
      const sentWhileProvisional = firstSend !== undefined && gateCompletedDate !== null && firstSend <= gateCompletedDate
      if (sentWhileProvisional) {
        const variance = computeVariance(intake.actual_qty, trueNet)
        provisionalVarianceFlag = isMaterialVariance(variance.diffPct, materialVariancePct)
      }
    }

    result.set(serial, {
      value: derived.value,
      provisional: derived.provisional,
      basis: derived.basis,
      isMultiLine,
      gateNet,
      gateStage2Done,
      declaredQty,
      intakeActualQty: intake?.actual_qty ?? null,
      totalBoxMassKg,
      pendingOn: derived.pendingOn,
      truckVariance,
      lineReconciliation: reconciliationByOrder.get(orderId) ?? null,
      provisionalVarianceFlag,
    })
  }

  return result
}

// Thin hook wrapper, same shape as every other data hook in this app
// (refresh-callable, loading flag) — for the two screen-level consumers
// (Menejer's KirimOrdersList, Ombor's OmborIntakeTab) that read
// effective_qty directly rather than through useMoykaSerials/useMoykaOutput.
//
// 🔒 Request-sequencing guard (found live, Step 9: self-generating test
// fixtures — see DECISIONS.md). `refresh()` is called fire-and-forget by
// callers (e.g. OmborIntakeTab.handleAccept, once per accepted line, never
// awaited) — two overlapping calls are a real scenario, not a hypothetical:
// accepting two lines on the same multi-line order in quick succession
// fires two overlapping fetchEffectiveQty calls. Without ordering
// protection, whichever call's network response happens to resolve LAST
// wins via setData, regardless of which one was STARTED last — an older,
// stale (e.g. one-line-only) result can overwrite a newer, correct
// (both-lines) one. `latestRequestId` is bumped on every refresh() call;
// a response is only applied if no newer call has started since. The
// existing "cancelled" idiom elsewhere in this app (useGateHistory.ts,
// useIntakeHistory.ts) solves the same class of problem for an effect that
// re-runs on a dependency change, via a closure-scoped flag React's own
// cleanup resets per run — that doesn't cover this hook's case (repeat
// manual refresh() calls, not a dependency-driven effect re-run), so this
// uses a ref-based counter instead, scoped to the whole hook instance
// rather than a single effect run.
export function useEffectiveQty(serials: string[], materialVariancePct: number) {
  const [data, setData] = useState<Map<string, EffectiveQtyInfo>>(new Map())
  const [loading, setLoading] = useState(true)
  const key = serials.join(',')
  const latestRequestId = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++latestRequestId.current
    setLoading(true)
    try {
      const result = await fetchEffectiveQty(serials, materialVariancePct)
      // Only apply this response if it's still the most recently STARTED
      // call — an older call resolving after a newer one must not clobber
      // the newer (correct) data with its own stale snapshot.
      if (requestId === latestRequestId.current) setData(result)
    } finally {
      setLoading(false)
    }
    // key/materialVariancePct capture the actual dependency; serials itself
    // is a fresh array every render in every call site here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, materialVariancePct])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { effectiveQty: data, loading, refresh }
}
