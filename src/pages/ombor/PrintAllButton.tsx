import { useState } from 'react'
import { P1Printer, isP1PrinterAvailable, printFailureMessage, pluginErrorMessage } from '../../lib/p1Printer'
import type { Barcode2LabelData } from '../../lib/barcodeLabel'
import { Button } from '../../components/ui/Button'
import { StatusNote } from '../../components/ui/StatusNote'

// Opening stock, Stage 2 (2026-08-02) — old-washed pallets were never
// labelled at seed time (no barcode2 sticker exists yet, unlike a normal
// finished pallet printed once at receipt), so a truck taking 10+ of them
// needs a way to print the whole line at once rather than tapping "Chop
// etish" per row. The P1 Bluetooth printer is a single in-flight request
// (see Barcode2Display.tsx's own printLabel call) — it can't fan out
// concurrently, so this fires each print sequentially and waits for the
// result before starting the next, exactly the reprint action
// Barcode2Display already exposes per row, just looped. Native-only, same
// feature-detect as Barcode2Display — the web build has no print path at
// all (share/download is a per-row action there, not sensibly batched).
export function PrintAllButton({ pallets }: { pallets: Barcode2LabelData[] }) {
  const [printed, setPrinted] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isP1PrinterAvailable() || pallets.length === 0) return null

  async function handlePrintAll() {
    setError(null)
    setBusy(true)
    try {
      // Resumes from where a prior attempt stopped (see printed state) —
      // a hardware failure (no paper, cover open) would fail every
      // subsequent label the same way, so stopping rather than skipping is
      // the right default; retrying continues instead of reprinting
      // labels that already came out.
      for (let i = printed; i < pallets.length; i++) {
        const result = await P1Printer.printLabel({
          barcode: pallets[i].barcode2,
          serial: pallets[i].serial,
          typeName: pallets[i].type,
          calibreLabel: pallets[i].calibre,
          weightKg: pallets[i].weightKg,
          clientName: pallets[i].owner,
        })
        if (!result.success) {
          setError(`${i + 1}/${pallets.length}: ${printFailureMessage(result.reason)}`)
          setPrinted(i)
          return
        }
        setPrinted(i + 1)
      }
    } catch (err) {
      setError(pluginErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const done = printed >= pallets.length

  return (
    <div className="mt-1">
      <Button type="button" variant="secondary" size="sm" disabled={busy || done} onClick={handlePrintAll}>
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
