import type { ReportRow } from '../../lib/reportQuery'
import { KirimRowDetail } from './KirimRowDetail'
import { ChiqimRowDetail } from './ChiqimRowDetail'

const STATUS_LABEL: Record<string, string> = {
  omborda: 'Omborda',
  band_qilingan: 'Band qilingan',
  jonatilgan: "Jo'natilgan",
  bekor_qilingan: 'Bekor qilingan',
}

const td = 'px-3 py-2 align-top'

export const REPORT_TABLE_COLUMN_COUNT = 11

// §3.2.4 result row — desktop rework (Menejer/Rahbar are PC-only surfaces;
// see ReportResultsTable.tsx's own header comment for why a real <table>
// replaces the phone-oriented card+expand this screen shipped with first).
// Row expand reuses the SAME behaviour and the SAME detail components
// (KirimRowDetail/ChiqimRowDetail) as before — only the trigger moved, from
// a card's header button to this row's own expand button.
export function ReportTableRow({
  row,
  expanded,
  onToggle,
  ownerName,
  typeName,
  calibreLabel,
}: {
  row: ReportRow
  expanded: boolean
  onToggle: () => void
  ownerName: (id: string) => string
  typeName: (id: string) => string
  calibreLabel: (id: string) => string
}) {
  const qty = row.kind === 'kirim' ? row.effectiveQtyKg : row.weightKg

  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer border-b border-slate-200 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60"
      >
        <td className={td}>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {row.kind === 'kirim' ? 'KIRIM' : 'CHIQIM'}
          </span>
        </td>
        <td className={`${td} whitespace-nowrap text-slate-700 dark:text-slate-300`}>{row.dateBasis ?? '—'}</td>
        <td className={`${td} whitespace-nowrap font-mono text-slate-900 dark:text-slate-100`}>
          {row.kind === 'kirim' ? row.serial : row.barcode2}
        </td>
        <td className={`${td} whitespace-nowrap text-slate-700 dark:text-slate-300`}>{ownerName(row.ownerId)}</td>
        <td className={`${td} whitespace-nowrap text-slate-700 dark:text-slate-300`}>{typeName(row.typeId)}</td>
        <td className={`${td} whitespace-nowrap text-slate-700 dark:text-slate-300`}>
          {row.kind === 'chiqim' ? calibreLabel(row.calibreId) : '—'}
        </td>
        <td className={`${td} whitespace-nowrap text-right tabular-nums font-medium text-slate-900 dark:text-slate-100`}>
          {row.kind === 'kirim' && row.provisional ? 'tarozi kutilmoqda' : `${qty.toLocaleString()} kg`}
        </td>
        <td className={`${td} whitespace-nowrap text-slate-700 dark:text-slate-300`}>{row.plate || '—'}</td>
        <td className={`${td} whitespace-nowrap text-slate-700 dark:text-slate-300`}>{row.driver || '—'}</td>
        <td className={`${td} whitespace-nowrap`}>
          {row.kind === 'kirim' ? (
            <>
              {row.provisionalVarianceFlag && (
                <span className="font-medium text-red-600 dark:text-red-400" role="alert">
                  Diqqat: tarozi farqi
                </span>
              )}
              {!row.provisionalVarianceFlag && !row.provisional && row.truckVarianceDiffKg !== null && Math.abs(row.truckVarianceDiffKg) > 0 && (
                <span className="text-amber-700 dark:text-amber-400">
                  {row.truckVarianceDiffKg >= 0 ? '+' : ''}
                  {row.truckVarianceDiffKg.toLocaleString()} kg farq
                </span>
              )}
              {!row.provisionalVarianceFlag && (row.provisional || row.truckVarianceDiffKg === null || row.truckVarianceDiffKg === 0) && (
                <span className="text-slate-400">—</span>
              )}
            </>
          ) : row.palletStatus === 'bekor_qilingan' ? (
            <span className="font-medium text-red-600 dark:text-red-400">Bekor qilingan</span>
          ) : row.palletStatus !== 'jonatilgan' ? (
            <span className="text-slate-400">{STATUS_LABEL[row.palletStatus]}</span>
          ) : row.labVerdict === 'qayta_yuvish' ? (
            <span className="font-medium text-red-600 dark:text-red-400">Qayta yuvish</span>
          ) : row.labVerdict === 'o_tdi' ? (
            <span className="font-medium text-emerald-600 dark:text-emerald-400">O'tdi</span>
          ) : (
            <span className="text-slate-400">Tekshirilmagan</span>
          )}
        </td>
        <td className={`${td} text-right`}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
            aria-expanded={expanded}
            aria-label={expanded ? 'Yopish' : 'Batafsil'}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            {expanded ? '▲' : '▼'}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-slate-200 dark:border-slate-700">
          <td colSpan={REPORT_TABLE_COLUMN_COUNT} className="bg-slate-50 px-3 py-3 dark:bg-slate-900/40">
            {row.kind === 'kirim' ? (
              <KirimRowDetail row={row} />
            ) : (
              <ChiqimRowDetail row={row} typeName={typeName} calibreLabel={calibreLabel} />
            )}
          </td>
        </tr>
      )}
    </>
  )
}
