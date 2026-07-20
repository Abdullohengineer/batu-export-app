import type { ReportRow } from '../../lib/reportQuery'
import { KirimRowDetail } from './KirimRowDetail'
import { ChiqimRowDetail } from './ChiqimRowDetail'

const STATUS_LABEL: Record<string, string> = {
  omborda: 'Omborda',
  band_qilingan: 'Band qilingan',
  jonatilgan: "Jo'natilgan",
  bekor_qilingan: 'Bekor qilingan',
}

// §3.2.4 result row. Phone-density decision (applies to every later view
// built on this engine — see the task's own walkthrough for the full
// reasoning): PRIORITISED FIELDS + EXPAND, not a literal HTML table or a
// horizontal-scroll grid. This isn't a new choice invented for this screen —
// every existing list in this app (OmborChiqimTab, LaboratorChiqimTab,
// OmborHisobotlar, QorovulHisobotlar) already uses exactly this shape: a
// two-line card (date/plate/driver, then type+qty+flags) with the remaining
// ~7 fields behind the SAME expand toggle OmborChiqimTab established. A
// results "table" here means this card list, not `<table>` — there isn't one
// anywhere in this codebase, and a real grid doesn't reflow to a phone width
// at all, whereas this pattern already works down to 375px throughout the
// app today.
export function ReportRowCard({
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
  return (
    <div className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-2 text-left">
        <span className="text-slate-900 dark:text-slate-100">
          {row.dateBasis ?? '—'} · {row.plate || '—'} · {row.driver || '—'}
        </span>
        <span className="text-slate-500 dark:text-slate-400">{ownerName(row.ownerId)}</span>
      </button>

      {row.kind === 'kirim' ? (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-slate-500 dark:text-slate-400">
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            KIRIM
          </span>
          <span className="font-mono">{row.serial}</span>
          <span>{typeName(row.typeId)}</span>
          <span className="font-medium text-slate-700 dark:text-slate-300">
            {row.provisional ? 'tarozi kutilmoqda' : `${row.effectiveQtyKg.toLocaleString()} kg`}
          </span>
          {row.provisionalVarianceFlag && (
            <span className="font-medium text-red-600 dark:text-red-400" role="alert">
              Diqqat: tarozi farqi
            </span>
          )}
          {!row.provisional && row.truckVarianceDiffKg !== null && Math.abs(row.truckVarianceDiffKg) > 0 && (
            <span className="text-amber-700 dark:text-amber-400">
              {row.truckVarianceDiffKg >= 0 ? '+' : ''}
              {row.truckVarianceDiffKg.toLocaleString()} kg farq
            </span>
          )}
        </div>
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-slate-500 dark:text-slate-400">
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            CHIQIM
          </span>
          <span className="font-mono">{row.barcode2}</span>
          <span>
            {typeName(row.typeId)} · {calibreLabel(row.calibreId)}
          </span>
          <span className="font-medium text-slate-700 dark:text-slate-300">{row.weightKg.toLocaleString()} kg</span>
          <span>sikl {row.washCycle}</span>
          {row.palletStatus === 'bekor_qilingan' ? (
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
        </div>
      )}

      {expanded &&
        (row.kind === 'kirim' ? (
          <KirimRowDetail row={row} />
        ) : (
          <ChiqimRowDetail row={row} typeName={typeName} calibreLabel={calibreLabel} />
        ))}
    </div>
  )
}
