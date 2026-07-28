// §2.15 (SPEC.md v1.10) — pure weight-authority calculation, dependency-free
// (mirrors rewash.ts's split from activeCycles.ts: this file holds the pure
// rule, effectiveQty.ts is the I/O + combination layer around it). Three
// weights exist for the same material (declared / intake / gate net, see
// §2.15); this derives the ONE effective_qty everything downstream reads —
// derived, never stored (§2.15.1).
//
// Priority order (not three independent branches — see DECISIONS.md
// "Weight authority & effective quantity"): whether gate stage 2 AND box
// mass are both known gates provisional-vs-final; single-vs-multi-line then
// decides WHICH figure becomes effective_qty. A multi-line truck's
// effective_qty is ALWAYS its own line's intake actual_qty — the gate
// produces one figure for the whole truck and cannot split it, so gate net
// only ever feeds the reconciliation variance (see computeVariance below),
// never becomes the line's own number, even once both gate stage 2 and box
// mass are known and the figure is no longer provisional.
//
// Box mass (2026-07-28, KIRIM only — see DECISIONS.md): the truck's raw
// gate_weighings.net_kg (gruzheny_kg − pustoy_kg) is product + boxes, not
// true product. `totalBoxMassKg` — Σ storage_intake.box_mass_kg across every
// line on the order — must be subtracted to get true net. It is `null`
// until EVERY line on the order has been accepted (box mass is mandatory at
// accept time, so "line accepted" and "line's box mass known" are the same
// event; the caller in effectiveQty.ts is the one that aggregates across
// sibling lines to decide this). Gate stage 2 and box mass are two
// independent pending inputs that can arrive in either order — finalization
// (dropping `provisional`) requires BOTH.

export type WeightAuthorityBasis =
  | 'declared_pre_intake' // §5.1 not yet accepted — nothing measured yet, still showing the manager's declared figure
  | 'intake_provisional' // intake exists, but gate stage 2 and/or box mass aren't both known yet — "tarozi kutilmoqda" / "quti massasi kutilmoqda" (§2.15.2, §2.16)
  | 'intake_multi_line_final' // multi-line truck, gate stage 2 + box mass both known — value is still intake, true net never adopted (§2.15.1)
  | 'gate_net_final' // single-line truck, gate stage 2 + box mass both known — the accounting truth, box-mass-adjusted (§2.15, §2.16)

// Which of the two independent pending inputs (§2.16) is still missing.
// Only meaningful while basis === 'intake_provisional' — every other basis
// has nothing left pending, by construction.
export interface PendingOn {
  gate: boolean // gate stage 2 (empty-truck weigh) not yet complete
  boxMass: boolean // at least one line on this order hasn't been accepted yet, so the truck's total box mass isn't fully known
}

export interface WeightAuthorityInput {
  declaredQty: number
  intakeActualQty: number | null // null = §5.1 not yet accepted
  isMultiLine: boolean
  gateNet: number | null // raw gruzheny_kg − pustoy_kg, box-inclusive — never used directly as effective_qty once box mass exists
  gateStage2Done: boolean
  totalBoxMassKg: number | null // Σ box_mass_kg across the order's lines; null until every line is accepted (§2.16)
}

export interface WeightAuthorityResult {
  value: number
  provisional: boolean
  basis: WeightAuthorityBasis
  pendingOn: PendingOn
}

const NOTHING_PENDING: PendingOn = { gate: false, boxMass: false }

export function deriveEffectiveQty(input: WeightAuthorityInput): WeightAuthorityResult {
  if (input.intakeActualQty === null) {
    return { value: input.declaredQty, provisional: false, basis: 'declared_pre_intake', pendingOn: NOTHING_PENDING }
  }
  if (!input.gateStage2Done || input.totalBoxMassKg === null) {
    return {
      value: input.intakeActualQty,
      provisional: true,
      basis: 'intake_provisional',
      pendingOn: { gate: !input.gateStage2Done, boxMass: input.totalBoxMassKg === null },
    }
  }
  if (input.isMultiLine) {
    return { value: input.intakeActualQty, provisional: false, basis: 'intake_multi_line_final', pendingOn: NOTHING_PENDING }
  }
  // trueNet = gate net minus the truck's total box mass — both operands are
  // non-null by construction here (gateStage2Done + totalBoxMassKg checked
  // above; net_kg is a generated column populated the same instant
  // completed_at is set). The intake fallback is defensive only, never
  // expected in practice — same posture the pre-box-mass code already had.
  const trueNet = input.gateNet !== null ? input.gateNet - input.totalBoxMassKg : null
  return { value: trueNet ?? input.intakeActualQty, provisional: false, basis: 'gate_net_final', pendingOn: NOTHING_PENDING }
}

// §5.1 amend: "variance reporting is computed gate-vs-declared, never
// intake-vs-declared" — a general two-figure comparison, reused for both
// that truck-level check (§3.1/§5.1) and the multi-line sum-of-lines
// reconciliation (§2.15.1) and the §2.15.2 edge-case check (§5.5.5-style
// "did the final figure land materially different from what was shown at
// send time"). fromKg is always the reference figure quoted first in the
// spec text (declared, or true net for the multi-line reconciliation).
export interface QtyVariance {
  fromKg: number
  toKg: number
  diffKg: number
  diffPct: number
}

export function computeVariance(fromKg: number, toKg: number): QtyVariance {
  const diffKg = toKg - fromKg
  const diffPct = fromKg > 0 ? (diffKg / fromKg) * 100 : 0
  return { fromKg, toKg, diffKg, diffPct }
}

// No fixed "materiality" threshold exists in the spec for §2.15.2's edge
// case (§7 NEW OPEN — deliberately unresolved, not to be built this
// prompt). Reuses the EXISTING kam_chiqdi_pct setting (§5.1's own
// declared-vs-actual threshold) rather than inventing a new one — see
// DECISIONS.md.
export function isMaterialVariance(diffPct: number, thresholdPct: number): boolean {
  return Math.abs(diffPct) > thresholdPct
}

// Shared wording for the two independent pending inputs (§2.16), read by
// every live screen that shows the "tarozi kutilmoqda" provisional label
// (OmborIntakeTab.tsx, KirimOrdersList.tsx) — one place so the two can never
// drift in phrasing.
export function pendingLabel(pendingOn: PendingOn): string {
  if (pendingOn.gate && pendingOn.boxMass) return 'tarozi va quti massasi kutilmoqda'
  if (pendingOn.boxMass) return 'quti massasi kutilmoqda'
  return 'tarozi kutilmoqda'
}
