import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { renderBarcode2Label, stripBarcode2Prefix, abbreviateCalibre, type Barcode2LabelData } from '../../lib/barcodeLabel'
import { isP1PrinterAvailable } from '../../lib/p1Printer'
import { usePrintQueue } from '../../lib/usePrintQueue'
import { PrinterStatus } from './PrinterStatus'

// Barcode #2 (physical pallet, SPEC §2.2, §5.3): renders the sticker ID as a
// real scannable QR code on screen (DECISIONS.md "Barcode format: CODE_128
// -> QR" — printed 1D bars never resolved reliably at 40x30mm). Two print paths, feature-detected
// (requirement G — web stays exactly as it was): native Android prints
// directly via P1PrinterPlugin.java (LPAPI, drawn at 40×30mm — the printer's
// real stock); the web build keeps the original share/download PNG fallback
// unchanged. `defaultOpen` (native only) also auto-fires one print the
// moment this appears already-expanded — the "just saved" moment from
// OmborTayyorTab.tsx — while the same button remains the reprint action
// everywhere this renders collapsed (historical pallet rows).
//
// Print-N-copies (2026-08-20): the new per-calibre Barcode #2 scheme means
// one barcode can now cover several physical pallets (e.g. a 4-full-pallet
// bundle) — Ombor needs an identical sticker on each, and tapping "Chop
// etish" repeatedly was jamming the paper feed (see DECISIONS.md). The
// copies stepper reuses PrintAllButton's own sequential-await-then-next,
// resume-on-failure loop via usePrintQueue.ts rather than a second copy of
// it, feeding it `data` repeated `copies` times instead of a list of
// distinct pallets — same loop, same jam-safety, either way. Native-only:
// the web share/download fallback has no print-job concept of its own, a
// repeat count there is the OS print dialog's job, not this app's.
const MAX_COPIES = 20 // generous for any realistic full-pallet group (largest seen so far: 4); guards a fat-fingered huge run, not a real ceiling on legitimate use
export function Barcode2Display({ data, defaultOpen = false }: { data: Barcode2LabelData; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        Barcode #2
      </button>
      {open && <Barcode2Label data={data} autoprint={defaultOpen} />}
    </div>
  )
}

function Barcode2Label({ data, autoprint }: { data: Barcode2LabelData; autoprint: boolean }) {
  const barcodeRef = useRef<HTMLCanvasElement>(null)
  // Separate from the print queue's own busy/error (below) — share/download
  // is an independent action from printing, not mutually exclusive with it.
  const [shareBusy, setShareBusy] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [copies, setCopies] = useState(1)
  const nativeAvailable = isP1PrinterAvailable()
  const autoprintedFor = useRef<string | null>(null)
  const { printed: queuePrinted, total: queueTotal, busy: printBusy, error: printError, printAll } = usePrintQueue()

  // Same stripped value as the print path (renderBarcode2Label) and the
  // native plugin — on-screen, print, and preview all encode identically.
  useEffect(() => {
    if (!barcodeRef.current) return
    QRCode.toCanvas(barcodeRef.current, stripBarcode2Prefix(data.barcode2), {
      width: 180,
      margin: 4,
      errorCorrectionLevel: 'Q',
    }).catch(() => {})
  }, [data.barcode2])

  useEffect(() => {
    return () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl)
    }
  }, [downloadUrl])

  // Resets the copies stepper whenever a different barcode appears in this
  // (possibly reused) instance — OmborTayyorTab's "Oxirgi Barcode #2" slot
  // re-renders with new `data` without unmounting (see file header), so a
  // stale N from a prior pallet must never silently carry over onto one
  // Ombor didn't ask N copies of.
  useEffect(() => {
    setCopies(1)
  }, [data.barcode2])

  // Fires once per distinct barcode2 (not once per component instance —
  // OmborTayyorTab.tsx reuses this same mounted instance for every
  // subsequent receipt in a session via its `lastBarcode` state, so a
  // mount-only guard would silently stop auto-printing after the first).
  // Always exactly ONE copy, regardless of whatever the copies stepper
  // currently shows — the "just saved" moment is always one fresh pallet,
  // one sticker; extra copies are a deliberate, separate manual action via
  // the stepper afterward, never implied by it.
  useEffect(() => {
    if (autoprint && nativeAvailable && autoprintedFor.current !== data.barcode2) {
      autoprintedFor.current = data.barcode2
      printAll([data])
    }
    // printAll is stable across renders (usePrintQueue holds no per-render
    // closures over `data`); only barcode2 actually changing should
    // retrigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoprint, nativeAvailable, data.barcode2])

  function handlePrintClick() {
    printAll(Array(copies).fill(data))
  }

  function handleCopiesChange(raw: string) {
    const n = parseInt(raw, 10)
    setCopies(Number.isFinite(n) ? Math.min(MAX_COPIES, Math.max(1, n)) : 1)
  }

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    setDownloadUrl(url)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
  }

  async function handleShare() {
    setShareError(null)
    setShareBusy(true)
    try {
      const blob = await renderBarcode2Label(data)
      const file = new File([blob], `${data.barcode2}.png`, { type: 'image/png' })
      if (
        typeof navigator.share === 'function' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [file] })
      ) {
        await navigator.share({ files: [file], title: `Barcode ${data.barcode2}` })
      } else {
        triggerDownload(blob, `${data.barcode2}.png`)
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setShareError(err instanceof Error ? err.message : 'Xatolik yuz berdi.')
    } finally {
      setShareBusy(false)
    }
  }

  // `queueTotal` is the length of the last job usePrintQueue actually ran —
  // compared against the CURRENT stepper value so that bumping `copies`
  // after a finished/failed run is never misread as progress on a job that
  // hasn't started yet (printAll's own job-key logic already restarts
  // correctly when the arrays differ; this is purely the display's own
  // "is what I'm showing still current" check).
  const printJobIsCurrent = queueTotal === copies
  const displayPrinted = printJobIsCurrent ? queuePrinted : 0
  const printDone = printJobIsCurrent && copies > 0 && queuePrinted >= copies
  const printIncomplete = printJobIsCurrent && displayPrinted > 0 && !printDone

  return (
    <div className="mt-2 rounded-md border-2 border-slate-900 bg-white p-3 text-center dark:border-slate-100">
      <canvas ref={barcodeRef} className="mx-auto max-w-full" />
      <div className="font-mono text-lg font-bold tracking-wide text-slate-900">{data.barcode2}</div>
      <div className="mt-1 text-xs text-slate-600">
        {data.type} · {abbreviateCalibre(data.calibre)} · {data.weightKg.toLocaleString()} kg · {data.owner}
      </div>

      {nativeAvailable && (
        <div className="mt-2 flex justify-center">
          <PrinterStatus />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        {nativeAvailable && (
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_COPIES}
            value={copies}
            onChange={(e) => handleCopiesChange(e.target.value)}
            disabled={printBusy}
            aria-label="Nechta nusxa"
            className="w-14 rounded-md border border-slate-300 px-2 py-1.5 text-center text-sm text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        )}
        <button
          type="button"
          onClick={nativeAvailable ? handlePrintClick : handleShare}
          disabled={nativeAvailable ? printBusy : shareBusy}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {nativeAvailable
            ? printBusy
              ? `Chop etilmoqda… (${displayPrinted}/${copies})`
              : printIncomplete
                ? `Davom ettirish (${displayPrinted}/${copies})`
                : copies > 1
                  ? `Chop etish (${copies})`
                  : 'Chop etish'
            : shareBusy
              ? '…'
              : 'Chop etish / Ulashish'}
        </button>
        <button
          type="button"
          onClick={async () => {
            setShareError(null)
            setShareBusy(true)
            try {
              triggerDownload(await renderBarcode2Label(data), `${data.barcode2}.png`)
            } catch (err) {
              setShareError(err instanceof Error ? err.message : 'Xatolik yuz berdi.')
            } finally {
              setShareBusy(false)
            }
          }}
          disabled={shareBusy}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          Yuklab olish
        </button>
      </div>

      {printDone && !printError && (
        <p className="mt-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          Chop etildi ✓{copies > 1 ? ` (${copies})` : ''}
        </p>
      )}
      {(printError || shareError) && (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {printError || shareError}
        </p>
      )}
    </div>
  )
}
