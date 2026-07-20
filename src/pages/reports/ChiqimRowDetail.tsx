import type { ChiqimReportRow } from '../../lib/reportQuery'

// Row-expand content — see KirimRowDetail.tsx's own note: this row's extra
// fields only, not the full serial passport (§3.2.5, out of scope).
export function ChiqimRowDetail({
  row,
  typeName,
  calibreLabel,
}: {
  row: ChiqimReportRow
  typeName: (id: string) => string
  calibreLabel: (id: string) => string
}) {
  return (
    <div className="mt-2 space-y-2 border-t border-slate-200 pt-2 text-slate-500 dark:border-slate-700 dark:text-slate-400">
      <div>
        Ona seriya: <span className="font-mono">{row.serial}</span> · {typeName(row.typeId)} · {calibreLabel(row.calibreId)}
      </div>

      {row.voidInfo ? (
        <div className="font-medium text-red-600 dark:text-red-400" role="alert">
          Bekor qilindi — qayta yuvilgan, sikl {row.voidInfo.voidedCycle}.{' '}
          {row.voidInfo.successorBarcodes.length > 0
            ? `Yangi barkod${row.voidInfo.successorBarcodes.length > 1 ? 'lar' : ''}: ${row.voidInfo.successorBarcodes.join(', ')}.`
            : `Sikl ${row.voidInfo.successorCycle} hali yangi barkod chiqarilmagan.`}
        </div>
      ) : (
        <>
          <div>
            Laboratoriya (chiqim): namligi {row.moisturePct !== null ? `${row.moisturePct}%` : 'tekshirilmagan'}
            {row.targetMoisturePct !== null && ` (talab: ${row.targetMoisturePct}%)`}
            {' · '}
            SO₂: {row.so2MgKg !== null ? `${row.so2MgKg} mg/kg` : row.targetSo2MgKg === null ? "yo'q · naturel" : 'tekshirilmagan'}
            {row.targetSo2MgKg !== null && ` (talab: ${row.targetSo2MgKg} mg/kg)`}
          </div>
          {!row.requestId && <div>Hali hech qanday CHIQIM so'roviga bog'lanmagan.</div>}
        </>
      )}
    </div>
  )
}
