// §3.1/§5.4 CHIQIM feasibility — pure, dependency-free (see DECISIONS.md
// "CHIQIM request feasibility checker" and SPEC.md §3.1's whole-pallet soft
// warning, 🔒 already locked: "soft-warns and suggests the nearest workable
// figures... never blocks — the manager can save anyway").
//
// Pallets are atomic (§5.4) — a target is only truly achievable if some
// subset of available pallets sums to it exactly. This is a 0/1 subset-sum
// problem: enumerate every achievable total via a standard DP over a Set,
// scaled to integers (SCALE) so summing kg values never drifts on floats.
// Assumes a warehouse-realistic pallet count (tens, not thousands) — this
// is O(pallets × distinct achievable totals), not built to scale further.

const SCALE = 100 // 0.01 kg precision

export interface FeasibilityResult {
  achievable: boolean
  // When achievable, both equal the target itself (the achievable total).
  // When not, the closest achievable totals on either side — null if no
  // pallet combination exists in that direction (e.g. target below the
  // smallest single pallet has no "above" gap only if total stock < target).
  nearestBelow: number | null
  nearestAbove: number | null
}

export function checkFeasibility(palletWeightsKg: number[], targetKg: number): FeasibilityResult {
  const target = Math.round(targetKg * SCALE)

  const achievable = new Set<number>([0])
  for (const w of palletWeightsKg) {
    const scaled = Math.round(w * SCALE)
    for (const sum of [...achievable]) {
      achievable.add(sum + scaled)
    }
  }

  if (achievable.has(target)) {
    return { achievable: true, nearestBelow: targetKg, nearestAbove: targetKg }
  }

  let below: number | null = null
  let above: number | null = null
  for (const sum of achievable) {
    if (sum <= target && (below === null || sum > below)) below = sum
    if (sum >= target && (above === null || sum < above)) above = sum
  }

  return {
    achievable: false,
    nearestBelow: below === null ? null : below / SCALE,
    nearestAbove: above === null ? null : above / SCALE,
  }
}
