import { useEffect, useRef, useState } from 'react'
import JsBarcode from 'jsbarcode'
import { renderBarcode1Label, type Barcode1LabelData } from '../../lib/barcodeLabel'

// Barcode #1 (SPEC §2.2, §5.1): renders the stored serial as a real,
// scannable Code128 barcode on screen (readable directly off the display in
// a pinch), plus a print/share action that generates a 50×30mm label PNG for
// the Detonger P1 via WePrint (PHASE0.md Part E). The stored barcode1 value
// (== the serial) is unchanged by this step — only its rendering.
export function Barcode1Display({ data }: { data: Barcode1LabelData }) {
  const [open, setOpen] = useState(false)

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        Barcode #1
      </button>
      {open && <Barcode1Label data={data} />}
    </div>
  )
}

function Barcode1Label({ data }: { data: Barcode1LabelData }) {
  const barcodeRef = useRef<SVGSVGElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)

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

      {error && (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
