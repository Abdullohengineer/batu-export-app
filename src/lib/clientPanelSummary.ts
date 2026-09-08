import { supabase } from './supabase'
import type { OldStockSection } from '../components/OldStockDrilldown'

// Панель tab (CLAUDE.md task "Rebuild the client portal..." Part B.1) —
// current stock by state + dispatched total (client_panel_summary) and the
// Эски drill-down data (client_old_stock_breakdown), both self-scoped via
// my_owner_id(). supabase/migrations/0113_client_old_stock_and_panel_summary.sql.

export interface ClientPanelStock {
  rawKg: number
  moykaKg: number
  finishedKg: number
  oldStockKg: number
}

export interface ClientPanelSummary {
  stock: ClientPanelStock
  dispatchedKg: number
}

export interface ClientOldStockBreakdown {
  oldWashed: OldStockSection
  oldKn: OldStockSection
}

function n(v: number | string): number {
  return Number(v)
}

export async function fetchClientPanelSummary(): Promise<ClientPanelSummary> {
  const { data, error } = await supabase.rpc('client_panel_summary')
  if (error) throw error
  const d = data as { stock: Record<string, number | string>; dispatchedKg: number | string }
  return {
    stock: {
      rawKg: n(d.stock.rawKg),
      moykaKg: n(d.stock.moykaKg),
      finishedKg: n(d.stock.finishedKg),
      oldStockKg: n(d.stock.oldStockKg),
    },
    dispatchedKg: n(d.dispatchedKg),
  }
}

export async function fetchClientOldStockBreakdown(): Promise<ClientOldStockBreakdown> {
  const { data, error } = await supabase.rpc('client_old_stock_breakdown')
  if (error) throw error
  const d = data as {
    oldWashed: { totalKg: number | string; byCalibre: { calibreId: string; label: string; code: string; kg: number | string }[] }
    oldKn: { totalKg: number | string; byType: { typeId: string; typeName: string; kg: number | string }[] }
  }
  return {
    oldWashed: {
      totalKg: n(d.oldWashed.totalKg),
      series: d.oldWashed.byCalibre.map((c) => ({ label: c.label, kg: n(c.kg) })),
    },
    oldKn: {
      totalKg: n(d.oldKn.totalKg),
      series: d.oldKn.byType.map((t) => ({ label: t.typeName, kg: n(t.kg) })),
    },
  }
}
