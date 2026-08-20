import { useRef, useState } from 'react'
import { P1Printer, printFailureMessage, pluginErrorMessage } from './p1Printer'
import type { Barcode2LabelData } from './barcodeLabel'

// Shared resumable sequential-print loop. Extracted from PrintAllButton.tsx
// (2026-08-02, "Opening stock, Stage 2") so its exact behaviour — the P1
// printer is a single in-flight request and can't fan out concurrently, so
// this awaits each job before starting the next, and a hardware failure
// (no paper, cover open) stops rather than skips so a retry resumes instead
// of reprinting labels that already came out — is reused, not duplicated,
// by Barcode2Display.tsx's own "print N copies of this ONE pallet" control
// (2026-08-20). Both call sites feed this the same `Barcode2LabelData[]`
// shape; PrintAllButton passes several DISTINCT pallets, Barcode2Label
// passes the same pallet repeated `copies` times — the loop doesn't care
// which.
//
// Resume-vs-restart is decided by a content key (joined barcode2 list), not
// by the caller tracking its own "is this the same job" state: a second
// printAll() call with the identical pallets list (same barcode2s in the
// same order) resumes from `printed`; a call with a DIFFERENT list (a new
// barcode, or the same barcode with a different copy count) starts fresh.
// A call with the SAME list after it already finished also starts fresh
// (this is a deliberate re-print, not a resume of a completed job) — only
// an INCOMPLETE matching job resumes.
function jobKey(pallets: Barcode2LabelData[]): string {
  return pallets.map((p) => p.barcode2).join('|')
}

export function usePrintQueue() {
  const [printed, setPrinted] = useState(0)
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const currentJobKey = useRef<string | null>(null)
  const currentPrinted = useRef(0)

  async function printAll(pallets: Barcode2LabelData[]) {
    const key = jobKey(pallets)
    const resuming = key === currentJobKey.current && currentPrinted.current < pallets.length
    const startAt = resuming ? currentPrinted.current : 0
    currentJobKey.current = key
    currentPrinted.current = startAt
    setTotal(pallets.length)
    setPrinted(startAt)
    setError(null)
    setBusy(true)
    try {
      for (let i = startAt; i < pallets.length; i++) {
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
          currentPrinted.current = i
          setPrinted(i)
          return
        }
        currentPrinted.current = i + 1
        setPrinted(i + 1)
      }
    } catch (err) {
      setError(pluginErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return { printed, total, busy, error, printAll }
}
