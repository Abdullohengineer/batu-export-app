import type { KirimReportRow } from '../../lib/reportQuery'

// Row-expand content — NOT the full serial passport (§3.2.5, out of scope
// this prompt: no wash-cycle-by-wash-cycle breakdown, no dispatches). Just
// this row's own additional fields, same "expand reveals the rest" contract
// as every other card in this app.
export function KirimRowDetail({ row }: { row: KirimReportRow }) {
  const hasTarget = row.targetMoisturePct !== null || row.targetSo2MgKg !== null

  return (
    <div className="mt-2 space-y-2 border-t border-slate-200 pt-2 text-slate-500 dark:border-slate-700 dark:text-slate-400">
      <div>
        E'lon qilingan: {row.declaredQty.toLocaleString()} kg
        {!row.provisional && (
          <>
            {' · '}
            {row.dateBasisSource === 'gate_stage1' ? 'Darvoza (1-bosqich) sanasi' : 'Buyurtma sanasi'}
          </>
        )}
      </div>
      {row.truckVarianceDiffKg !== null && row.truckVarianceDiffPct !== null && (
        <div className="text-amber-700 dark:text-amber-400">
          Darvoza netto e'lon qilingandan {row.truckVarianceDiffKg >= 0 ? '+' : ''}
          {row.truckVarianceDiffKg.toLocaleString()} kg ({row.truckVarianceDiffPct >= 0 ? '+' : ''}
          {row.truckVarianceDiffPct.toFixed(1)}%) farq qiladi.
        </div>
      )}
      {(hasTarget || row.kirimMoisturePct !== null) && (
        <div>
          Namligi: {row.kirimMoisturePct !== null ? `${row.kirimMoisturePct}%` : 'tekshirilmagan'}
          {row.targetMoisturePct !== null && ` (talab: ${row.targetMoisturePct}%)`}
          {' · '}
          SO₂: {row.kirimSo2MgKg !== null ? `${row.kirimSo2MgKg} mg/kg` : row.targetSo2MgKg === null ? "yo'q · naturel" : 'tekshirilmagan'}
          {row.targetSo2MgKg !== null && ` (talab: ${row.targetSo2MgKg} mg/kg)`}
        </div>
      )}
    </div>
  )
}
