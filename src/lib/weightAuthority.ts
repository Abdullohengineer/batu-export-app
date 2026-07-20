// §2.15 (SPEC.md v1.10) — pure weight-authority calculation, dependency-free
// (mirrors rewash.ts's split from activeCycles.ts: this file holds the pure
// rule, effectiveQty.ts is the I/O + combination layer around it). Three
// weights exist for the same material (declared / intake / gate net, see
// §2.15); this derives the ONE effective_qty everything downstream reads —
// derived, never stored (§2.15.1).
//
// Priority order (not three independent branches — see DECISIONS.md
// "Weight authority & effective quantity"): whether gate stage 2 is done
// gates provisional-vs-final; single-vs-multi-line then decides WHICH
// figure becomes effective_qty. A multi-line truck's effective_qty is
// ALWAYS its own line's intake actual_qty — the gate produces one figure
// for the whole truck and cannot split it, so gate net only ever feeds the
// reconciliation variance (see computeVariance below), never becomes the
// line's own number, even once gate stage 2 completes and the figure is no
// longer provisional.

export type WeightAuthorityBasis =
  | 'declared_pre_intake' // §5.1 not yet accepted — nothing measured yet, still showing the manager's declared figure
  | 'intake_provisional' // intake exists, gate stage 2 not yet complete — "tarozi kutilmoqda" (§2.15.2)
  | 'intake_multi_line_final' // multi-line truck, gate stage 2 complete — value is still intake, gate net never adopted (§2.15.1)
  | 'gate_net_final' // single-line truck, gate stage 2 complete — the accounting truth (§2.15)

export interface WeightAuthorityInput {
  declaredQty: number
  intakeActualQty: number | null // null = §5.1 not yet accepted
  isMultiLine: boolean
  gateNet: number | null
  gateStage2Done: boolean
}

export interface WeightAuthorityResult {
  value: number
  provisional: boolean
  basis: WeightAuthorityBasis
}

export function deriveEffectiveQty(input: WeightAuthorityInput): WeightAuthorityResult {
  if (input.intakeActualQty === null) {
    return { value: input.declaredQty, provisional: false, basis: 'declared_pre_intake' }
  }
  if (!input.gateStage2Done) {
    return { value: input.intakeActualQty, provisional: true, basis: 'intake_provisional' }
  }
  if (input.isMultiLine) {
    return { value: input.intakeActualQty, provisional: false, basis: 'intake_multi_line_final' }
  }
  // gateNet should always be non-null once gateStage2Done (net_kg is a
  // generated column, populated the same instant completed_at is set) —
  // the intake fallback is defensive only, never expected in practice.
  return { value: input.gateNet ?? input.intakeActualQty, provisional: false, basis: 'gate_net_final' }
}

// §5.1 amend: "variance reporting is computed gate-vs-declared, never
// intake-vs-declared" — a general two-figure comparison, reused for both
// that truck-level check (§3.1/§5.1) and the multi-line sum-of-lines
// reconciliation (§2.15.1) and the §2.15.2 edge-case check (§5.5.5-style
// "did the final figure land materially different from what was shown at
// send time"). fromKg is always the reference figure quoted first in the
// spec text (declared, or gate net for the multi-line reconciliation).
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
