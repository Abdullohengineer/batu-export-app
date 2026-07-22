import type { ReportRow } from '../../lib/reportQuery'
import { KirimRowDetail } from './KirimRowDetail'
import { ChiqimRowDetail } from './ChiqimRowDetail'
import { Card } from '../../components/ui/Card'
import { SerialChip } from '../../components/ui/SerialChip'
import { StatusPill } from '../../components/ui/StatusPill'
import { type Tone } from '../../components/ui/tokens'

const STATUS_LABEL: Record<string, string> = {
  omborda: 'Omborda',
  band_qilingan: 'Band qilingan',
  jonatilgan: "Jo'natilgan",
  bekor_qilingan: 'Bekor qilingan',
}

// Card rendering of a report row for narrow viewports (mockup's mobile
// "Tarix" cards), alongside ReportTableRow's existing <table> row for wide
// ones -- ReportResultsTable picks one or the other via a CSS breakpoint,
// both read the exact same `rows`/`onToggle`/`onOpenPassport` props, same
// KirimRowDetail/ChiqimRowDetail expand content, no new data or logic.
export function ReportRowCard({
  row,
  expanded,
  onToggle,
  ownerName,
  typeName,
  calibreLabel,
  onOpenPassport,
}: {
  row: ReportRow
  expanded: boolean
  onToggle: () => void
  ownerName: (id: string) => string
  typeName: (id: string) => string
  calibreLabel: (id: string) => string
  onOpenPassport: (serial: string) => void
}) {
  const qty = row.kind === 'kirim' ? row.effectiveQtyKg : row.weightKg

  let tone: Tone = 'neutral'
  let label = ''
  if (row.kind === 'kirim') {
    if (row.provisionalVarianceFlag) {
      tone = 'problem'
      label = 'Tarozi farqi'
    } else if (row.provisional) {
      tone = 'pending'
      label = 'Tarozi kutilmoqda'
    } else {
      tone = 'ok'
      label = `${qty.toLocaleString()} kg`
    }
  } else if (row.palletStatus === 'bekor_qilingan') {
    tone = 'problem'
    label = 'Bekor qilingan'
  } else if (row.palletStatus !== 'jonatilgan') {
    tone = 'neutral'
    label = STATUS_LABEL[row.palletStatus]
  } else if (row.labVerdict === 'qayta_yuvish') {
    tone = 'problem'
    label = 'Qayta yuvish'
  } else if (row.labVerdict === 'o_tdi') {
    tone = 'ok'
    label = "O'tdi"
  } else {
    tone = 'neutral'
    label = 'Tekshirilmagan'
  }

  return (
    <Card padding="compact">
      <button type="button" onClick={onToggle} className="flex min-h-12 w-full items-center gap-3 text-left">
        <SerialChip>{row.kind === 'kirim' ? row.serial : row.barcode2}</SerialChip>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base text-slate-900 dark:text-slate-100">
            {ownerName(row.ownerId)} · {typeName(row.typeId)}
            {row.kind === 'chiqim' && ` · ${calibreLabel(row.calibreId)}`}
          </span>
          <span className="block text-sm text-slate-500 dark:text-slate-400">
            {row.dateBasis ?? '—'} · {row.plate || '—'} ·{' '}
            {row.kind === 'kirim' ? `${qty.toLocaleString()} kg` : `${qty.toLocaleString()} kg`}
          </span>
        </span>
        <StatusPill tone={tone}>{label}</StatusPill>
      </button>
      {expanded && (
        <div className="mt-1">
          {row.kind === 'kirim' ? (
            <KirimRowDetail row={row} onOpenPassport={onOpenPassport} />
          ) : (
            <ChiqimRowDetail row={row} typeName={typeName} calibreLabel={calibreLabel} onOpenPassport={onOpenPassport} />
          )}
        </div>
      )}
    </Card>
  )
}
