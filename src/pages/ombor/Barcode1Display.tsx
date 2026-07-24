import { useEffect, useRef, useState } from 'react'
import JsBarcode from 'jsbarcode'
import { renderBarcode1Label, type Barcode1LabelData } from '../../lib/barcodeLabel'
import { P1Printer, isP1PrinterAvailable, printFailureMessage, pluginErrorMessage, type PrintLabelOptions } from '../../lib/p1Printer'
import { PrinterStatus } from './PrinterStatus'

// Barcode #1 (SPEC §2.2, §5.1): renders the stored serial as a real,
// scannable Code128 barcode on screen (readable directly off the display in
// a pinch). Same native-vs-web print split as Barcode2Display (requirement
// F treats both the same way — Ombor prints and sticks both on the same
// floor with the same printer, so they shouldn't behave differently): native
// Android prints via P1PrinterPlugin.java at 40×30mm, web keeps the original
// share/download PNG fallback. `defaultOpen` (native only) auto-fires one
// print for the raw-material fields (serial, type, weight, client — no
// calibre, no date; date is a web-preview-only field) the moment this
// appears already-expanded, mirroring OmborIntakeTab.tsx's "just accepted"
// moment. The stored barcode1 value (== the serial) is unchanged by this
// step — only its rendering/printing.
export function Barcode1Display({ data, defaultOpen = false }: { data: Barcode1LabelData; defaultOpen?: boolean }) {
  // Only actually auto-open on native — on web there's no auto-print to show
  // for, so this stays collapsed exactly like before this feature existed.
  // (Found live, not assumed: unconditionally honoring defaultOpen here
  // made the label panel's own wrapper div match a rewash-hard-gate.spec.ts
  // locator meant only for the accepted-serial Card next to it — a real
  // strict-mode-violation regression, not a flake, fixed by narrowing this
  // rather than the test.)
  const [open, setOpen] = useState(defaultOpen && isP1PrinterAvailable())

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        Barcode #1
      </button>
      {open && <Barcode1Label data={data} autoprint={defaultOpen} />}
    </div>
  )
}

function toPrintOptions(data: Barcode1LabelData): PrintLabelOptions {
  return {
    barcode: data.serial,
    serial: data.serial,
    typeName: data.type,
    weightKg: data.weightKg,
    clientName: data.owner,
  }
}

function Barcode1Label({ data, autoprint }: { data: Barcode1LabelData; autoprint: boolean }) {
  const barcodeRef = useRef<SVGSVGElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [printed, setPrinted] = useState(false)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const nativeAvailable = isP1PrinterAvailable()
  const autoprintedFor = useRef<string | null>(null)

  // On-screen scannable bars (SVG so it stays crisp at any display size).
  useEffect(() => {
    if (!barcodeRef.current) return
    JsBarcode(barcodeRef.current, data.serial, {
      format: 'CODE128',
      displayValue: false,
      width: 2,
      height: 60,
      margin: 8,
    })
  }, [data.serial])

  // Revoke any object URL we created for the download fallback.
  useEffect(() => {
    return () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl)
    }
  }, [downloadUrl])

  async function handlePrint() {
    setError(null)
    setPrinted(false)
    setBusy(true)
    try {
      const result = await P1Printer.printLabel(toPrintOptions(data))
      if (result.success) {
        setPrinted(true)
      } else {
        setError(printFailureMessage(result.reason))
      }
    } catch (err) {
      setError(pluginErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  // Fires once per distinct serial, not once per component instance — see
  // the identical comment in Barcode2Display.tsx for why a mount-only guard
  // would be wrong here (this component instance is reused across accepts).
  useEffect(() => {
    if (autoprint && nativeAvailable && autoprintedFor.current !== data.serial) {
      autoprintedFor.current = data.serial
      handlePrint()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoprint, nativeAvailable, data.serial])

  async function handleShare() {
    setError(null)
    setBusy(true)
    try {
      const blob = await renderBarcode1Label(data)
      const file = new File([blob], `${data.serial}.png`, { type: 'image/png' })

      // Feature-detect BEFORE calling: some browsers have navigator.share but
      // not file sharing (canShare with files). Fall through to download.
      if (
        typeof navigator.share === 'function' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [file] })
      ) {
        await navigator.share({ files: [file], title: `Barcode ${data.serial}` })
      } else {
        triggerDownload(blob, `${data.serial}.png`)
      }
    } catch (err) {
      // AbortError = user dismissed the share sheet; not an error to show.
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Xatolik yuz berdi.')
    } finally {
      setBusy(false)
    }
  }

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    setDownloadUrl(url)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
  }

  return (
    <div className="mt-2 rounded-md border-2 border-slate-900 bg-white p-3 text-center dark:border-slate-100">
      <svg ref={barcodeRef} className="mx-auto max-w-full" />
      <div className="font-mono text-2xl font-bold tracking-widest text-slate-900">{data.serial}</div>
      <div className="mt-1 text-xs text-slate-600">
        {data.type} · {data.owner} · {data.weightKg.toLocaleString()} kg · {data.date}
      </div>

      {nativeAvailable && (
        <div className="mt-2 flex justify-center">
          <PrinterStatus />
        </div>
      )}

      <div className="mt-3 flex justify-center gap-2">
        <button
          type="button"
          onClick={nativeAvailable ? handlePrint : handleShare}
          disabled={busy}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {busy ? '…' : nativeAvailable ? 'Chop etish' : 'Chop etish / Ulashish'}
        </button>
        <button
          type="button"
          onClick={async () => {
            setError(null)
            setBusy(true)
            try {
              triggerDownload(await renderBarcode1Label(data), `${data.serial}.png`)
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Xatolik yuz berdi.')
            } finally {
              setBusy(false)
            }
          }}
          disabled={busy}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          Yuklab olish
        </button>
      </div>

      {printed && !error && <p className="mt-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">Chop etildi ✓</p>}
      {error && (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
