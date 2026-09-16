import type { RahbarStockSnapshot, RahbarDashboardLedger, ByCalibreTypeRow } from './rahbarDashboardV2'
import type { Calibre } from './useCalibres'

export interface CalibreKgRow {
  calibreId: string
  kg: number
}

export interface DashboardDerived {
  stockByCalibre: CalibreKgRow[]
  stockKn: CalibreKgRow[]
  stockMax: number
  stockCalibredTotal: number
  stockKnTotal: number
  stockTotal: number
  dispatchedByCalibre: CalibreKgRow[]
  dispatchedKnRows: CalibreKgRow[]
  dispatchedMax: number
  dispatchedKalibrliPeriod: number
  dispatchedKnPeriod: number
  grandTotal: number
}

// Extracted from RahbarHome.tsx (2026-09-16, HeroTiles/OmborHozirSection
// extraction for the client Панель mirror — see docs/decisions/) so
// ClientPanelTab.tsx's own mirror can't independently re-derive (and drift
// from) this exact re-slicing. Pure function, no React — a straight lift of
// what RahbarHome.tsx always computed inline, byte-identical arithmetic.
// `stockTotal` in particular is now a shared value: RahbarHome's own
// "Omborda hozir" prose AND the client's Eski-scope "Эски ювилган" hero
// tile both read it, so the two can never show two different numbers for
// the same underlying figure.
export function computeDashboardDerived(
  snapshot: RahbarStockSnapshot | null,
  ledger: RahbarDashboardLedger | null,
  selectedTypeIds: string[] | null,
  calibres: Calibre[],
): DashboardDerived {
  function isKn(id: string): boolean {
    return calibres.find((c) => c.id === id)?.is_numberless ?? false
  }

  function sliceByType(rows: ByCalibreTypeRow[]): ByCalibreTypeRow[] {
    return selectedTypeIds === null ? rows : rows.filter((r) => selectedTypeIds.includes(r.typeId))
  }

  function regroupByCalibre(rows: ByCalibreTypeRow[]): CalibreKgRow[] {
    const map = new Map<string, number>()
    for (const r of sliceByType(rows)) map.set(r.calibreId, (map.get(r.calibreId) ?? 0) + r.kg)
    return [...map.entries()].map(([calibreId, kg]) => ({ calibreId, kg })).sort((a, b) => b.kg - a.kg)
  }

  const dispatchedKalibrliPeriod = ledger ? ledger.byCalibreType.dispatched.filter((r) => !isKn(r.calibreId)).reduce((s, r) => s + r.kg, 0) : 0
  const dispatchedKnPeriod = ledger ? ledger.byCalibreType.dispatched.filter((r) => isKn(r.calibreId)).reduce((s, r) => s + r.kg, 0) : 0

  const dispatchedByCalibre = ledger ? regroupByCalibre(ledger.byCalibreType.dispatched).filter((r) => !isKn(r.calibreId)) : []
  const dispatchedKnRows = ledger ? regroupByCalibre(ledger.byCalibreType.dispatched).filter((r) => isKn(r.calibreId)) : []

  // 2026-08-30: the per-calibre bars are a LIVE BALANCE, not a period flow.
  // They used to plot the period's output under a heading a reader takes for
  // stock: for August that read K4 = 23,570 kg while only 960 kg was on hand,
  // the rest dispatched. Now off stock_on_hand_rows via rahbar_stock_snapshot
  // -- the same view Ombor qoldig'i reads, so the two screens cannot disagree.
  const stockByCalibre = snapshot ? regroupByCalibre(snapshot.byCalibre).filter((r) => !isKn(r.calibreId)) : []
  const stockKn = snapshot ? regroupByCalibre(snapshot.byCalibre).filter((r) => isKn(r.calibreId)) : []
  const stockMax = Math.max(1, ...stockByCalibre.map((r) => r.kg), ...stockKn.map((r) => r.kg))
  // 2026-08-31: split out explicitly, and derived from the SAME filtered
  // arrays the bars are drawn from (never from snapshot.finishedCalibredKg,
  // which the Turlar picker does not narrow) so a summary sentence can never
  // describe a different set than the bars directly above it.
  const stockCalibredTotal = stockByCalibre.reduce((sum, r) => sum + r.kg, 0)
  const stockKnTotal = stockKn.reduce((sum, r) => sum + r.kg, 0)
  const stockTotal = stockCalibredTotal + stockKnTotal
  const dispatchedMax = Math.max(1, ...dispatchedByCalibre.map((r) => r.kg), ...dispatchedKnRows.map((r) => r.kg))

  // 2026-08-30: oldKnKg deliberately EXCLUDED from the headline -- see
  // RahbarHome.tsx's own comment history / DECISIONS.md "Rahbar dashboard
  // corrections". Old KN is reachable via Ombor qoldig'i, Hisobot, and (as
  // of the 6th hero tile) its own always-visible tile.
  const grandTotal = snapshot ? snapshot.rawKg + snapshot.moykadaKg + snapshot.finishedCalibredKg + snapshot.konditirskiyKg : 0

  return {
    stockByCalibre,
    stockKn,
    stockMax,
    stockCalibredTotal,
    stockKnTotal,
    stockTotal,
    dispatchedByCalibre,
    dispatchedKnRows,
    dispatchedMax,
    dispatchedKalibrliPeriod,
    dispatchedKnPeriod,
    grandTotal,
  }
}
