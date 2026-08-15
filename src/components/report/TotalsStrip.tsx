import type { ReportTotals } from '../../lib/reportQuery'
import { REPORT_COLUMNS } from '../../lib/reportColumns'
import { toneStyles } from '../../components/ui/tokens'

function kg(v: number) {
  return `${Math.round(v).toLocaleString()} kg`
}

interface TotalChip {
  label: string
  value: number
  signed?: boolean
}

// One entry per "volume" column key (src/lib/reportColumns.ts) — every
// VISIBLE volume column contributes whatever chips it maps to here,
// automatically (2026-08-15, see HisobotTab.tsx's visibleColumnKeys). This
// is the "general rule, not per-column wiring" the task asked for: the
// loop below is generic over whichever volume columns are visible: it's
// only each column's own chip SHAPE that's declared once, here, not
// re-wired per caller.
//
// Netto and Tara keep their existing, deliberately-split multi-chip
// shapes (in/out/net, in/out) rather than collapsing to one number each —
// undoing that split would silently sum unrelated figures again (KIRIM
// tara vs. raw-dispatch tara share a column name but aren't the same
// thing; kirim vs. chiqim volume are opposite directions, not one pile).
// E'lon qilingan and Hisobiy need no such split: declared_qty is a
// KIRIM-only concept (null on every chiqim/chiqim_raw/chiqim_old_kn row),
// so there is no "out" side to separate against.
const VOLUME_COLUMN_CHIPS: Record<string, (t: ReportTotals) => TotalChip[]> = {
  netto: (t) => [
    { label: 'Kirim', value: t.kgIn },
    { label: 'Chiqim', value: t.kgOut },
    { label: 'Neto', value: t.net, signed: true },
  ],
  declared: (t) => [{ label: "E'lon qilingan", value: t.totalDeclared }],
  hisobiy: (t) => [{ label: 'Hisobiy', value: t.totalHisobiy }],
  tara: (t) => [
    { label: 'Tara (kirim)', value: t.taraIn },
    { label: 'Tara (chiqim)', value: t.taraOut },
  ],
}

// §3.2.4 🔒 "Filtered-totals strip... recalculates against the active
// filter... sticky while scrolling" (§2.11 filtered-totals global rule).
export function TotalsStrip({
  totals,
  dateBasisText,
  visibleColumnKeys,
}: {
  totals: ReportTotals
  dateBasisText: string
  visibleColumnKeys: Set<string>
}) {
  const chips = REPORT_COLUMNS.filter((c) => c.kind === 'volume' && visibleColumnKeys.has(c.key)).flatMap(
    (c) => VOLUME_COLUMN_CHIPS[c.key]?.(totals) ?? [],
  )

  return (
    <div
      className={`sticky top-0 z-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded-md border px-4 py-2 text-sm backdrop-blur ${toneStyles.info.border} ${toneStyles.info.bg}`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className={`text-xs font-semibold uppercase tracking-wide ${toneStyles.info.text}`}>Filtrlangan jami</span>
        {chips.map((chip) => (
          <span key={chip.label} className="text-slate-700 dark:text-slate-300">
            {chip.label}:{' '}
            <span className="font-medium text-slate-900 dark:text-slate-100">
              {chip.signed && chip.value >= 0 ? '+' : ''}
              {kg(chip.value)}
            </span>
          </span>
        ))}
      </div>
      <span className="text-xs text-slate-400">{dateBasisText}</span>
    </div>
  )
}
