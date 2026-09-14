import type { ReportRow } from '../../lib/reportQuery'
import { KirimRowDetail } from './KirimRowDetail'
import { ChiqimDispatchRowDetail } from './ChiqimDispatchRowDetail'
import { MoykaSendRowDetail } from './MoykaSendRowDetail'
import { MoykaOutputRowDetail } from './MoykaOutputRowDetail'
import { formatDate } from '../../lib/formatDate'
import { Card } from '../../components/ui/Card'
import { SerialChip } from '../../components/ui/SerialChip'
import { PartiyaBadge } from '../../components/ui/PartiyaBadge'
import { FuraBadge } from '../../components/ui/FuraBadge'
import { StatusPill } from '../../components/ui/StatusPill'
import { type Tone } from '../../components/ui/tokens'

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
  truckType,
  onOpenPassport,
  onOpenChiqimRequest,
}: {
  row: ReportRow
  expanded: boolean
  onToggle: () => void
  ownerName: (id: string) => string
  typeName: (id: string) => string
  calibreLabel: (id: string) => string
  // CHIQIM truck type resolver (2026-08-30) — same resolver ReportTableRow
  // takes, threaded here too so the narrow-viewport rendering can never
  // drift from the table one (this file's own header warns about exactly
  // that hazard).
  truckType: (requestId: string) => string
  onOpenPassport: (serial: string) => void
  onOpenChiqimRequest: (requestId: string) => void
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
  } else if (row.kind === 'moyka_send') {
    tone = 'neutral'
    label = `${qty.toLocaleString()} kg`
  } else {
    // moyka_output (per-serial aggregate, 2026-09-03) and chiqim_dispatch
    // (rolled-up dispatch line, 2026-09-14) both have no single pallet
    // status any more — each row's own kg is already the relevant
    // exclusion-filtered/matched total (see reportQuery.ts's
    // MoykaOutputReportRow / ChiqimDispatchReportRow comments).
    tone = 'neutral'
    label = `${qty.toLocaleString()} kg`
  }

  return (
    <Card padding="compact">
      <button type="button" onClick={onToggle} className="flex min-h-12 w-full items-center gap-3 text-left">
        <SerialChip>{row.kind === 'chiqim_dispatch' ? row.plate || '—' : row.serial}</SerialChip>
        {row.kind !== 'chiqim_dispatch' && <PartiyaBadge partiyaNo={row.partiyaNo} typeName={typeName(row.typeId)} />}
        {row.kind === 'chiqim_dispatch' && row.requestId ? <FuraBadge truckType={truckType(row.requestId)} /> : null}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base text-slate-900 dark:text-slate-100">
            {ownerName(row.ownerId)}
            {row.kind !== 'chiqim_dispatch' && ` · ${typeName(row.typeId)}`}
          </span>
          <span className="block text-sm text-slate-500 dark:text-slate-400">
            {formatDate(row.dateBasis)} · {row.plate || '—'} · {qty.toLocaleString()} kg
          </span>
        </span>
        <StatusPill tone={tone}>{label}</StatusPill>
      </button>
      {expanded && (
        <div className="mt-1">
          {row.kind === 'kirim' ? (
            <KirimRowDetail row={row} onOpenPassport={onOpenPassport} />
          ) : row.kind === 'moyka_send' ? (
            <MoykaSendRowDetail row={row} onOpenPassport={onOpenPassport} />
          ) : row.kind === 'moyka_output' ? (
            <MoykaOutputRowDetail row={row} typeName={typeName} onOpenPassport={onOpenPassport} />
          ) : (
            <ChiqimDispatchRowDetail
              row={row}
              typeName={typeName}
              calibreLabel={calibreLabel}
              onOpenPassport={onOpenPassport}
              onOpenChiqimRequest={onOpenChiqimRequest}
            />
          )}
        </div>
      )}
    </Card>
  )
}
