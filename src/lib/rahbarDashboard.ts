// §3.2.10 Rahbar dashboard — trends/ranking/product-mix/exceptions. Backed
// by rahbar_monthly_trends/rahbar_client_ranking/rahbar_product_mix/
// rahbar_exceptions (supabase/migrations/0030). Rahbar-only, unlike the
// shared §3.2 saved views — this task's own title names it that way, and
// §6.1/§6.2 already describe it as the owner's own landing page + exceptions
// list, not an operational screen Menejer also uses.

export interface MonthlyCalibreMixEntry {
  calibreId: string
  kg: number
  pct: number
}

export interface MonthlyTrendRow {
  month: string
  volumeInKg: number
  volumeOutKg: number
  rawConsumedKg: number
  outputKg: number
  grossYieldPct: number | null
  grossLossPct: number | null
  dryMatterTrueLossPct: number | null
  dryMatterSerialCount: number
  yieldSerialCount: number
  rewashRatePct: number | null
  rewashCount: number
  utilizationPct: number | null
  calibreMix: MonthlyCalibreMixEntry[]
}

export interface ClientRankingRow {
  ownerId: string
  ownerName: string
  receivedKg: number
  dispatchedKg: number
}

export interface ProductMixRow {
  typeId: string
  receivedKg: number
  pctOfTotal: number
}

export type ExceptionKind = 'ageing_stock' | 'lab_overdue' | 'high_loss' | 'high_rewash'

export interface ExceptionRow {
  exceptionKind: ExceptionKind
  rowKey: string
  ownerId: string
  serial: string | null
  typeId: string | null
  detail: Record<string, unknown>
}

export const EXCEPTION_KIND_LABEL: Record<ExceptionKind, string> = {
  ageing_stock: 'Eskirgan zaxira (>90 kun)',
  lab_overdue: 'Tahlil kechikdi',
  high_loss: "G'ayrioddiy yo'qotish",
  high_rewash: "Qayta yuvish darajasi yuqori",
}

export const EXCEPTION_KIND_ORDER: ExceptionKind[] = ['lab_overdue', 'high_loss', 'high_rewash', 'ageing_stock']

export function exceptionKindSortIndex(kind: ExceptionKind): number {
  return EXCEPTION_KIND_ORDER.indexOf(kind)
}
