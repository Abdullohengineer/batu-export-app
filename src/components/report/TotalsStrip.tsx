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
//
// MOVEMENT_COLUMN_CHIPS (2026-08-15) — the row's own kg, summed across
// ROWS. Moyka rows deliberately excluded from Netto's own Kirim/Chiqim/
// Neto split (internal movement, never left the factory — approved
// explicitly, see DECISIONS.md); moykaga_yuborilgan/moykadan_chiqgan get
// their OWN movement chips instead, labelled "(davrda)" to stay distinct
// from their same-named state-group twin below — two numbers under one
// name is a support call waiting to happen, per explicit instruction.
const MOVEMENT_COLUMN_CHIPS: Record<string, (t: ReportTotals) => TotalChip[]> = {
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
  moykaga_yuborilgan: (t) => [{ label: 'Moykaga yuborilgan (davrda)', value: t.totalToMoyka }],
  moykadan_chiqgan: (t) => [{ label: 'Moykadan chiqgan (davrda)', value: t.totalFromMoyka }],
}

// STATE_COLUMN_CHIPS (2026-08-15) — a serial's own as-of-now standing
// balance, summed once per DISTINCT serial (never per row — "the trap").
// Every one of these is genuinely a different question from its
// MOVEMENT-group counterpart, not just a differently-scoped version of the
// same number — see DECISIONS.md "Hisobot: Moyka rows, direction split,
// serial-state columns" for why moykaga_yuborilgan/moykadan_chiqgan in
// particular are EXPECTED to disagree with their movement chip once real
// data exercises the difference.
const STATE_COLUMN_CHIPS: Record<string, (t: ReportTotals) => TotalChip[]> = {
  qabul_qilingan: (t) => [{ label: 'Qabul qilingan', value: t.stateQabulQilingan }],
  omborda_qoldi: (t) => [{ label: 'Omborda qoldi', value: t.stateOmbordaQoldi }],
  moykaga_yuborilgan: (t) => [{ label: 'Moykaga yuborilgan (joriy)', value: t.stateMoykagaYuborilgan }],
  moykada: (t) => [{ label: 'Moykada', value: t.stateMoykada }],
  moykadan_chiqgan: (t) => [{ label: 'Moykadan chiqgan (joriy)', value: t.stateMoykadanChiqgan }],
  xom_jonatilgan: (t) => [{ label: "Xom holda jo'natilgan", value: t.stateXomJonatilgan }],
  olib_ketilgan: (t) => [{ label: 'Olib ketilgan', value: t.stateOlibKetilgan }],
}

function ChipGroup({ title, chips }: { title: string; chips: TotalChip[] }) {
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className={`text-xs font-semibold uppercase tracking-wide ${toneStyles.info.text}`}>{title}</span>
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
  )
}

// §3.2.4 🔒 "Filtered-totals strip... recalculates against the active
// filter... sticky while scrolling" (§2.11 filtered-totals global rule).
//
// Two labelled groups (2026-08-15) — "the trap" this design exists to
// avoid: a serial-state column summed naively down the visible rows would
// count that serial once per row it appears on. Movement totals (row sums)
// and state totals (distinct-serial sums) are computed differently in SQL
// (report_totals) and rendered as two clearly separate, separately
// labelled groups here — never merged into one unlabelled "Jami," which
// would look plausible and be wrong.
export function TotalsStrip({
  totals,
  dateBasisText,
  visibleColumnKeys,
}: {
  totals: ReportTotals
  dateBasisText: string
  visibleColumnKeys: Set<string>
}) {
  const visibleVolumeColumns = REPORT_COLUMNS.filter((c) => c.kind === 'volume' && visibleColumnKeys.has(c.key))

  const movementChips = visibleVolumeColumns
    .filter((c) => (c.totalBasis ?? 'movement') === 'movement' || c.totalBasis === 'both')
    .flatMap((c) => MOVEMENT_COLUMN_CHIPS[c.key]?.(totals) ?? [])

  const stateColumns = visibleVolumeColumns.filter((c) => c.totalBasis === 'state' || c.totalBasis === 'both')
  const stateChips = stateColumns.flatMap((c) => STATE_COLUMN_CHIPS[c.key]?.(totals) ?? [])

  return (
    <div
      className={`sticky top-0 z-10 flex flex-col gap-1.5 rounded-md border px-4 py-2 text-sm backdrop-blur ${toneStyles.info.border} ${toneStyles.info.bg}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1.5">
        <div className="flex flex-col gap-1.5">
          <ChipGroup title="Harakatlar bo'yicha" chips={movementChips} />
          {stateChips.length > 0 && (
            <ChipGroup title={`Seriyalar bo'yicha (${totals.stateSerialCount} ta seriya)`} chips={stateChips} />
          )}
        </div>
        <span className="text-xs text-slate-400">{dateBasisText}</span>
      </div>
    </div>
  )
}
