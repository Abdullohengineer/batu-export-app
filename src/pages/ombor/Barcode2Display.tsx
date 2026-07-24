import { useEffect, useRef, useState } from 'react'
import JsBarcode from 'jsbarcode'
import { renderBarcode2Label, type Barcode2LabelData } from '../../lib/barcodeLabel'
import { P1Printer, isP1PrinterAvailable, printFailureMessage, pluginErrorMessage, type PrintLabelOptions } from '../../lib/p1Printer'
import { PrinterStatus } from './PrinterStatus'

// Barcode #2 (physical pallet, SPEC §2.2, §5.3): renders the sticker ID as a
// real scannable Code128 barcode on screen. Two print paths, feature-detected
// (requirement G — web stays exactly as it was): native Android prints
// directly via P1PrinterPlugin.java (LPAPI, drawn at 40×30mm — the printer's
// real stock); the web build keeps the original share/download PNG fallback
// unchanged. `defaultOpen` (native only) also auto-fires one print the
// moment this appears already-expanded — the "just saved" moment from
// OmborTayyorTab.tsx — while the same button remains the reprint action
// everywhere this renders collapsed (historical pallet rows).
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

function toPrintOptions(data: Barcode2LabelData): PrintLabelOptions {
  return {
    barcode: data.barcode2,
    serial: data.serial,
    typeName: data.type,
    calibreLabel: data.calibre,
    weightKg: data.weightKg,
    clientName: data.owner,
  }
}

function Barcode2Label({ data, autoprint }: { data: Barcode2LabelData; autoprint: boolean }) {
  const barcodeRef = useRef<SVGSVGElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [printed, setPrinted] = useState(false)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const nativeAvailable = isP1PrinterAvailable()
  const autoprintedFor = useRef<string | null>(null)

  useEffect(() => {
    if (!barcodeRef.current) return
    JsBarcode(barcodeRef.current, data.barcode2, {
      format: 'CODE128',
      displayValue: false,
      width: 2,
      height: 60,
      margin: 8,
    })
  }, [data.barcode2])

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

  // Fires once per distinct barcode2 (not once per component instance —
  // OmborTayyorTab.tsx reuses this same mounted instance for every
  // subsequent receipt in a session via its `lastBarcode` state, so a
  // mount-only guard would silently stop auto-printing after the first).
  useEffect(() => {
    if (autoprint && nativeAvailable && autoprintedFor.current !== data.barcode2) {
      autoprintedFor.current = data.barcode2
      handlePrint()
    }
    // handlePrint always closes over the latest `data` via render; only
    // barcode2 actually changing should retrigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoprint, nativeAvailable, data.barcode2])

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    setDownloadUrl(url)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
  }

  async function handleShare() {
    setError(null)
    setBusy(true)
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
      setError(err instanceof Error ? err.message : 'Xatolik yuz berdi.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 rounded-md border-2 border-slate-900 bg-white p-3 text-center dark:border-slate-100">
      <svg ref={barcodeRef} className="mx-auto max-w-full" />
      <div className="font-mono text-lg font-bold tracking-wide text-slate-900">{data.barcode2}</div>
      <div className="mt-1 text-xs text-slate-600">
        {data.serial} · {data.type} · {data.calibre} · {data.weightKg.toLocaleString()} kg · {data.owner}
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
              triggerDownload(await renderBarcode2Label(data), `${data.barcode2}.png`)
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
