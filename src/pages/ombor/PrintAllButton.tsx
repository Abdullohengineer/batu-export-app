import { isP1PrinterAvailable } from '../../lib/p1Printer'
import { usePrintQueue } from '../../lib/usePrintQueue'
import type { Barcode2LabelData } from '../../lib/barcodeLabel'
import { Button } from '../../components/ui/Button'

// Opening stock, Stage 2 (2026-08-02) — old-washed pallets were never
// labelled at seed time (no barcode2 sticker exists yet, unlike a normal
// finished pallet printed once at receipt), so a truck taking 10+ of them
// needs a way to print the whole line at once rather than tapping "Chop
// etish" per row. Native-only, same feature-detect as Barcode2Display — the
// web build has no print path at all (share/download is a per-row action
// there, not sensibly batched).
//
// The actual sequential-await-then-next-with-resume loop lives in
// usePrintQueue.ts (2026-08-20) — shared with Barcode2Display.tsx's own
// "print N copies of this ONE pallet" control, not reimplemented here.
export function PrintAllButton({ pallets }: { pallets: Barcode2LabelData[] }) {
  const { printed, busy, error, printAll } = usePrintQueue()

  if (!isP1PrinterAvailable() || pallets.length === 0) return null

  const done = printed >= pallets.length

  return (
    <div className="mt-1">
      <Button type="button" variant="secondary" size="md" disabled={busy || done} onClick={() => printAll(pallets)}>
        {busy
          ? `Chop etilmoqda… (${printed}/${pallets.length})`
          : done
            ? `Hammasi chop etildi (${pallets.length})`
            : printed > 0
              ? `Davom ettirish (${printed}/${pallets.length})`
              : `Hammasini chop etish (${pallets.length})`}
      </Button>
      {error && (
        <p className="mt-1 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
