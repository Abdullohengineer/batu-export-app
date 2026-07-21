// §3.2.8 Moisture-adjusted yield — row shape mirrors stockOnHand.ts's own
// split: this file holds shape + formatting, useYieldRows.ts is the I/O
// layer. Backed by the yield_rows view (supabase/migrations/0030).

export interface YieldCalibreMixEntry {
  calibreId: string
  kg: number
  pct: number
}

export interface YieldRow {
  serial: string
  typeId: string
  ownerId: string
  plate: string
  driver: string
  rawReceivedKg: number
  rawConsumedKg: number
  rawOverageKg: number
  completedDate: string
  maxCycleNo: number
  rewashed: boolean
  liveCalibreKg: number
  liveKonditirskiyKg: number
  outputKg: number
  lossKg: number
  lossPct: number
  grossYieldPct: number
  intakeMoisturePct: number | null
  deliveredMoisturePct: number | null
  dryMatterAvailable: boolean
  dryMatterInKg: number | null
  dryMatterOutKg: number | null
  trueLossPct: number | null
  calibreMix: YieldCalibreMixEntry[]
}

// §3.2.8 header note (confirmed with the user): loss here is measured
// against the ACTUAL, uncapped amount sent to Moyka (raw_consumed_kg) — the
// right basis for judging machine/process performance. The client report
// (§3.2.7) instead CAPS at effective_qty (least(actual_sent, effective_qty))
// so its balance arithmetic ties. The same serial can therefore show two
// different loss %s on the two screens — this is deliberate, not a bug on
// either side, and raw_overage_kg on each row is the visible explanation
// (never a silent clamp) when the two would otherwise disagree.
export const YIELD_LOSS_BASIS_NOTE =
  "Yo'qotish asosi: yuvishga yuborilgan haqiqiy miqdor (cheklanmagan) — Mijoz hisobotidagi effective_qty'ga cheklangan miqdordan farqli. Xuddi shu seriya ikki ekranda boshqa foiz ko'rsatishi mumkin — sabab: pastdagi \"ortiqcha yuborilgan\" ustuni."
