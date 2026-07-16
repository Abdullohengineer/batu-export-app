import { useEffect, useRef, useState } from 'react'
import JsBarcode from 'jsbarcode'
import { renderBarcode2Label, type Barcode2LabelData } from '../../lib/barcodeLabel'

// Barcode #2 (physical pallet, SPEC §2.2, §5.3): renders the sticker ID as a
// real scannable Code128 barcode on screen, plus a print/share action that
// generates the 50×30mm label PNG for the Detonger P1 via WePrint. Same
// share/download pattern as Barcode1Display (CLAUDE.md "reuse, don't
// rebuild"), but encodes the barcode2 (PLT-…) value and shows §2.2's #2
// fields (parent serial · tur · kalibr · og'irlik · egasi).
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
      {open && <Barcode2Label data={data} />}
    </div>
  )
}

function Barcode2Label({ data }: { data: Barcode2LabelData }) {
  const barcodeRef = useRef<SVGSVGElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)

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

      <div className="mt-3 flex justify-center gap-2">
        <button
          type="button"
          onClick={handleShare}
          disabled={busy}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {busy ? '…' : 'Chop etish / Ulashish'}
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

      {error && (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
