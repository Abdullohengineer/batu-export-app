// §3.2.9 Kutilayotgan ishlar (WIP/stuck) — row shape mirrors reportQuery.ts's
// own split: this file holds shape + labels, useWipRows.ts is the I/O layer.
// Backed by wip_rows (supabase/migrations/0028_stock_on_hand_and_wip.sql).

export type WipKind =
  | 'raw_not_sent'
  | 'moyka_not_returned'
  | 'awaiting_lab'
  | 'so2_pending'
  | 'qayta_yuvish_pending'
  | 'chiqim_open'
  | 'provisional_weight'

export interface WipRow {
  wipKind: WipKind
  rowKey: string
  serial: string | null
  requestId: string | null
  ownerId: string
  typeId: string | null
  daysWaiting: number | null
  thresholdDays: number | null
}

// Order matches §3.2.9's own numbered list — row 3 (awaiting_lab) is named
// there as the highest-value row, so it sorts first regardless of kg or age.
export const WIP_KIND_ORDER: WipKind[] = [
  'awaiting_lab',
  'raw_not_sent',
  'moyka_not_returned',
  'so2_pending',
  'qayta_yuvish_pending',
  'chiqim_open',
  'provisional_weight',
]

export const WIP_KIND_LABEL: Record<WipKind, string> = {
  raw_not_sent: 'Xom ashyo kutilmoqda',
  moyka_not_returned: 'Moykada turib qoldi',
  awaiting_lab: 'Tahlil kechikdi',
  so2_pending: 'Sera kechikdi',
  qayta_yuvish_pending: "Qayta yuvish kutilmoqda",
  chiqim_open: "Jo'natish kechikdi",
  provisional_weight: 'Tarozi kutilmoqda (2-bosqich)',
}

export function wipKindSortIndex(kind: WipKind): number {
  return WIP_KIND_ORDER.indexOf(kind)
}
