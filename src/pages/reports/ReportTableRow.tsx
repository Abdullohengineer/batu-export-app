import type { ReportRow } from '../../lib/reportQuery'
import type { ReportColumnDef } from '../../lib/reportColumns'
import { KirimRowDetail } from './KirimRowDetail'
import { ChiqimRowDetail } from './ChiqimRowDetail'
import { RawDispatchRowDetail } from './RawDispatchRowDetail'
import { OldKnRowDetail } from './OldKnRowDetail'
import { formatDate } from '../../lib/formatDate'

const STATUS_LABEL: Record<string, string> = {
  omborda: 'Omborda',
  band_qilingan: 'Band qilingan',
  jonatilgan: "Jo'natilgan",
  bekor_qilingan: 'Bekor qilingan',
  ishlatilgan: 'Ishlatilgan',
}

const td = 'px-3 py-2 align-top'

// §3.2.4 result row — desktop rework (Menejer/Rahbar are PC-only surfaces;
// see ReportResultsTable.tsx's own header comment for why a real <table>
// replaces the phone-oriented card+expand this screen shipped with first).
// Row expand reuses the SAME behaviour and the SAME detail components
// (KirimRowDetail/ChiqimRowDetail) as before — only the trigger moved, from
// a card's header button to this row's own expand button.
//
// Column picker (2026-08-15): `visibleColumns` (already filtered + ordered
// by ReportResultsTable, from the shared registry in reportColumns.ts)
// drives which <td>s render, in what order — cellContent below is the one
// place each column's value/formatting is defined, replacing what used to
// be a fixed sequence of <td>s hardcoded independently of the header.
export function ReportTableRow({
  row,
  visibleColumns,
  expanded,
  onToggle,
  ownerName,
  typeName,
  calibreLabel,
  onOpenPassport,
}: {
  row: ReportRow
  visibleColumns: ReportColumnDef[]
  expanded: boolean
  onToggle: () => void
  ownerName: (id: string) => string
  typeName: (id: string) => string
  calibreLabel: (id: string) => string
  onOpenPassport: (serial: string) => void
}) {
  const qty = row.kind === 'kirim' ? row.effectiveQtyKg : row.weightKg
  // Blank, not zero, wherever a figure doesn't exist for this row kind —
  // a zero would silently drag the totals-strip sum down and read as a
  // real measurement (2026-08-15, matching the existing Tara/boxMassKg
  // convention below, extended to the two new volume columns and the two
  // measurement columns).
  const declared = row.kind === 'kirim' ? row.declaredQty : null
  const hisobiy = row.kind === 'kirim' ? row.hisobiyKg : null
  const moisture = row.kind === 'kirim' ? row.kirimMoisturePct : row.kind === 'chiqim' ? row.moisturePct : null
  const so2 = row.kind === 'kirim' ? row.kirimSo2MgKg : row.kind === 'chiqim' ? row.so2MgKg : null

  function cellContent(key: string): React.ReactNode {
    switch (key) {
      case 'direction':
        return (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {row.kind === 'kirim'
              ? 'KIRIM'
              : row.kind === 'chiqim_raw'
                ? 'CHIQIM (xom)'
                : row.kind === 'chiqim_old_kn'
                  ? 'CHIQIM (eski KN)'
                  : 'CHIQIM'}
          </span>
        )
      case 'date':
        return <span className="whitespace-nowrap text-slate-700 dark:text-slate-300">{formatDate(row.dateBasis)}</span>
      case 'serial':
        return (
          <span className="whitespace-nowrap font-mono text-slate-900 dark:text-slate-100">
            {row.kind === 'chiqim_old_kn' ? '—' : row.serial}
          </span>
        )
      case 'owner':
        return <span className="whitespace-nowrap text-slate-700 dark:text-slate-300">{ownerName(row.ownerId)}</span>
      case 'type':
        return <span className="whitespace-nowrap text-slate-700 dark:text-slate-300">{typeName(row.typeId)}</span>
      case 'calibre':
        return (
          <span className="whitespace-nowrap text-slate-700 dark:text-slate-300">
            {row.kind === 'chiqim' ? calibreLabel(row.calibreId) : '—'}
          </span>
        )
      case 'barcode2':
        return (
          <span className="whitespace-nowrap font-mono text-slate-900 dark:text-slate-100">
            {row.kind === 'chiqim' ? row.barcode2 : '—'}
          </span>
        )
      case 'netto':
        return (
          <span className="whitespace-nowrap tabular-nums font-medium text-slate-900 dark:text-slate-100">
            {row.kind === 'kirim' && row.provisional ? 'tarozi kutilmoqda' : `${qty.toLocaleString()} kg`}
          </span>
        )
      case 'declared':
        return (
          <span className="whitespace-nowrap tabular-nums text-slate-700 dark:text-slate-300">
            {declared !== null ? `${declared.toLocaleString()} kg` : '—'}
          </span>
        )
      case 'hisobiy':
        return (
          <span className="whitespace-nowrap tabular-nums text-slate-700 dark:text-slate-300">
            {hisobiy !== null ? `${hisobiy.toLocaleString()} kg` : '—'}
          </span>
        )
      case 'tara':
        return (
          <span className="whitespace-nowrap tabular-nums text-slate-700 dark:text-slate-300">
            {row.boxMassKg !== null ? `${row.boxMassKg.toLocaleString()} kg` : '—'}
          </span>
        )
      case 'plate':
        return <span className="whitespace-nowrap text-slate-700 dark:text-slate-300">{row.plate || '—'}</span>
      case 'driver':
        return <span className="whitespace-nowrap text-slate-700 dark:text-slate-300">{row.driver || '—'}</span>
      case 'moisture':
        return (
          <span className="whitespace-nowrap tabular-nums text-slate-700 dark:text-slate-300">
            {moisture !== null ? `${moisture}%` : '—'}
          </span>
        )
      case 'so2':
        return (
          <span className="whitespace-nowrap tabular-nums text-slate-700 dark:text-slate-300">
            {so2 !== null ? so2.toLocaleString() : '—'}
          </span>
        )
      case 'status':
        return (
          <span className="whitespace-nowrap">
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
            ) : row.kind === 'chiqim_raw' ? (
              <span className="text-slate-400">Xom</span>
            ) : row.kind === 'chiqim_old_kn' ? (
              <span className="text-slate-400">Eski KN</span>
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
          </span>
        )
      default:
        return null
    }
  }

  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer border-b border-slate-200 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60"
      >
        {visibleColumns.map((col) => (
          <td key={col.key} className={col.align === 'right' ? `${td} text-right` : td}>
            {cellContent(col.key)}
          </td>
        ))}
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
          <td colSpan={visibleColumns.length + 1} className="bg-slate-50 px-3 py-3 dark:bg-slate-900/40">
            {row.kind === 'kirim' ? (
              <KirimRowDetail row={row} onOpenPassport={onOpenPassport} />
            ) : row.kind === 'chiqim_raw' ? (
              <RawDispatchRowDetail row={row} onOpenPassport={onOpenPassport} />
            ) : row.kind === 'chiqim_old_kn' ? (
              <OldKnRowDetail row={row} />
            ) : (
              <ChiqimRowDetail row={row} typeName={typeName} calibreLabel={calibreLabel} onOpenPassport={onOpenPassport} />
            )}
          </td>
        </tr>
      )}
    </>
  )
}
