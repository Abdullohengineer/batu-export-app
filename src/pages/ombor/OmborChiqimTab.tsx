import { useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useOwners } from '../../lib/useOwners'
import { useProductTypes } from '../../lib/useProductTypes'
import { useCalibres } from '../../lib/useCalibres'
import { useOmborChiqimRequests, type ChiqimRequest } from '../../lib/useOmborChiqimRequests'
import { resolveScan, lineStatus, shortfallLines as computeShortfallLines } from '../../lib/chiqimScan'

interface ScannedPallet {
  barcode2: string
  lineId: string
  weight_kg: number
}

// §5.4 Ombor CHIQIM: scan-to-load + finish. Two windows, same collapsed-by-
// default / toggle-to-expand shape already established for S3W1/S3W2
// (OmborTayyorTab) — collapsed shows request_date · plate · driver · owner
// + a target-kg summary line; expand reveals the scan form (W1) or the
// pallet list (W2), never both fetched or rendered eagerly.
//
// 🔒 Totals are tracked PER LINE, not per whole request (§5.4: "target
// LINES with progress bars"; "auto-adds ... to the matching type+calibre
// LINE") — confirmed from SPEC.md's locked text, not assumed. Each
// chiqim_lines row gets its own scanned-kg total and its own exact/
// shortfall/overage status.
export function OmborChiqimTab() {
  const { owners } = useOwners()
  const { productTypes } = useProductTypes()
  const { calibres } = useCalibres()
  const { open, finished, loading, refresh } = useOmborChiqimRequests()

  const [expandedOpen, setExpandedOpen] = useState<string | null>(null)
  const [expandedFinished, setExpandedFinished] = useState<string | null>(null)
  // Keyed by request id so collapsing a request mid-scan doesn't lose
  // progress — only one row is expanded at a time, but the operator may
  // still switch between requests while scanning.
  const [scannedByRequest, setScannedByRequest] = useState<Record<string, ScannedPallet[]>>({})
  const [barcodeInput, setBarcodeInput] = useState('')
  const [scanError, setScanError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [finishError, setFinishError] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)

  function ownerName(id: string) {
    return owners.find((o) => o.id === id)?.name ?? id
  }
  function typeName(id: string) {
    return productTypes.find((t) => t.id === id)?.name ?? id
  }
  function calibreLabel(id: string) {
    return calibres.find((c) => c.id === id)?.label ?? id
  }

  function scannedForLine(requestId: string, lineId: string): ScannedPallet[] {
    return (scannedByRequest[requestId] ?? []).filter((s) => s.lineId === lineId)
  }
  function lineTotal(requestId: string, lineId: string): number {
    return scannedForLine(requestId, lineId).reduce((sum, s) => sum + s.weight_kg, 0)
  }
  function requestTarget(request: ChiqimRequest): number {
    return request.lines.reduce((sum, l) => sum + l.qty_kg, 0)
  }

  function lineTotalsFor(requestId: string): Record<string, number> {
    const totals: Record<string, number> = {}
    for (const s of scannedByRequest[requestId] ?? []) totals[s.lineId] = (totals[s.lineId] ?? 0) + s.weight_kg
    return totals
  }

  async function handleScan(request: ChiqimRequest, e: FormEvent) {
    e.preventDefault()
    setScanError(null)
    const barcode2 = barcodeInput.trim()
    if (!barcode2) return

    const { data: pallet } = await supabase
      .from('finished_pallets')
      .select('barcode2, type_id, calibre_id, weight_kg, status')
      .eq('barcode2', barcode2)
      .maybeSingle()

    // Real enforcement point for the overcommit gap (DECISIONS "Step 7
    // prompt 1"): relies on dispatch_manifest.barcode2's existing UNIQUE
    // constraint rather than a reservation system. This check is a fast,
    // friendly early warning — the constraint itself (checked again at
    // finish time) is the actual guarantee against a race with another
    // request claiming the same pallet in between.
    const { data: claimed } = pallet
      ? await supabase.from('dispatch_manifest').select('barcode2').eq('barcode2', barcode2).maybeSingle()
      : { data: null }

    const result = resolveScan({
      barcode2,
      alreadyScannedBarcodes: (scannedByRequest[request.id] ?? []).map((s) => s.barcode2),
      pallet: pallet ? { type_id: pallet.type_id, calibre_id: pallet.calibre_id, status: pallet.status } : null,
      alreadyClaimed: !!claimed,
      lines: request.lines,
      scannedTotalsByLineId: lineTotalsFor(request.id),
    })

    if (!result.ok) {
      const messages: Record<typeof result.reason, string> = {
        duplicate: 'Bu pallet allaqachon shu ro\'yxatga skanerlangan.',
        not_found: 'Bunday barcode topilmadi.',
        not_in_stock: 'Bu pallet omborda emas (allaqachon jo\'natilgan yoki bekor qilingan).',
        claimed: 'Bu pallet allaqachon boshqa yuklashda ishlatilgan.',
        no_matching_line: 'Bu tur/kalibr ushbu so\'rovda yo\'q.',
      }
      setScanError(messages[result.reason])
      return
    }

    setScannedByRequest((m) => ({
      ...m,
      [request.id]: [...(m[request.id] ?? []), { barcode2: pallet!.barcode2, lineId: result.lineId, weight_kg: pallet!.weight_kg }],
    }))
    setBarcodeInput('')
  }

  function removeScan(requestId: string, barcode2: string) {
    setScannedByRequest((m) => ({
      ...m,
      [requestId]: (m[requestId] ?? []).filter((s) => s.barcode2 !== barcode2),
    }))
  }

  // §5.4: `Yuklashni yakunlash` is always enabled and never blocks on a
  // shortfall (SPEC §5.4, §3.1's same "never blocks" philosophy) — this is
  // the acceptance click itself (placement-vs-acceptance, pattern 2).
  async function handleFinish(request: ChiqimRequest) {
    setFinishing(true)
    setFinishError(null)
    try {
      const scanned = scannedByRequest[request.id] ?? []
      if (scanned.length > 0) {
        const { error: manifestErr } = await supabase.from('dispatch_manifest').insert(
          scanned.map((s) => ({ request_id: request.id, barcode2: s.barcode2 })),
        )
        if (manifestErr) {
          setFinishError(
            manifestErr.code === '23505'
              ? 'Skanerlangan palletlardan biri shu orada boshqa so\'rov uchun band qilindi — ro\'yxatni tekshirib qayta urinib ko\'ring.'
              : manifestErr.message,
          )
          return
        }
      }

      const { error: reqErr } = await supabase
        .from('chiqim_requests')
        .update({ ombor_finished_at: new Date().toISOString() })
        .eq('id', request.id)
      if (reqErr) throw reqErr

      setScannedByRequest((m) => {
        const next = { ...m }
        delete next[request.id]
        return next
      })
      setConfirming(null)
      setExpandedOpen(null)
      refresh()
    } catch (err) {
      setFinishError(err instanceof Error ? err.message : 'Yakunlashda xatolik yuz berdi.')
    } finally {
      setFinishing(false)
    }
  }

  if (loading) return null

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Yuklash uchun so'rovlar</h2>
        <div className="mt-2 space-y-2">
          {open.length === 0 && <p className="text-sm text-slate-400">Ochiq so'rov yo'q.</p>}
          {open.map((request) => {
            const isExpanded = expandedOpen === request.id
            const target = requestTarget(request)
            const scanned = (scannedByRequest[request.id] ?? []).reduce((sum, s) => sum + s.weight_kg, 0)
            const totalsByLine = lineTotalsFor(request.id)
            const shortfalls = computeShortfallLines(request.lines, totalsByLine)
            return (
              <div key={request.id} className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setExpandedOpen(isExpanded ? null : request.id)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <div>
                    <span className="text-slate-900 dark:text-slate-100">
                      {request.request_date} · {request.plate} · {request.driver}
                    </span>
                    <span className="ml-2 text-slate-500 dark:text-slate-400">{ownerName(request.owner_id)}</span>
                  </div>
                  <span className="text-slate-500 dark:text-slate-400">⋯</span>
                </button>
                <div className="mt-1 text-slate-500 dark:text-slate-400">
                  {request.lines.length} qator · maqsad {target.toLocaleString()} kg
                  {scanned > 0 && <> · skanerlangan {scanned.toLocaleString()} kg</>}
                </div>

                {isExpanded && (
                  <div className="mt-3 space-y-3 border-t border-slate-200 pt-3 dark:border-slate-700">
                    {request.lines.map((line) => {
                      const lineScanned = lineTotal(request.id, line.id)
                      const status = lineStatus(line.qty_kg, lineScanned)
                      return (
                        <div key={line.id} className="rounded-md bg-slate-50 p-2 dark:bg-slate-900">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-slate-700 dark:text-slate-300">
                              {typeName(line.type_id)} · {calibreLabel(line.calibre_id)}
                            </span>
                            <span className="text-slate-500 dark:text-slate-400">
                              {lineScanned.toLocaleString()} / {line.qty_kg.toLocaleString()} kg
                            </span>
                          </div>
                          {status === 'exact' && (
                            <p className="mt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                              ✓ Aniq mos keldi
                            </p>
                          )}
                          {status === 'overage' && (
                            <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                              Ortiqcha: +{(lineScanned - line.qty_kg).toLocaleString()} kg
                            </p>
                          )}
                          {scannedForLine(request.id, line.id).length > 0 && (
                            <ul className="mt-1 space-y-0.5">
                              {scannedForLine(request.id, line.id).map((s) => (
                                <li key={s.barcode2} className="flex items-center justify-between text-xs">
                                  <span className="font-mono text-slate-600 dark:text-slate-400">
                                    {s.barcode2} · {s.weight_kg.toLocaleString()} kg
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => removeScan(request.id, s.barcode2)}
                                    aria-label="Skanerlashni bekor qilish"
                                    className="text-slate-400 hover:text-red-600"
                                  >
                                    ✕
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )
                    })}

                    <form onSubmit={(e) => handleScan(request, e)} className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Barcode #2 ni kiriting yoki skanerlang"
                        value={barcodeInput}
                        onChange={(e) => setBarcodeInput(e.target.value)}
                        className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                      <button
                        type="submit"
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        Skanerlash
                      </button>
                    </form>
                    {scanError && (
                      <p className="text-sm font-medium text-red-600 dark:text-red-400" role="alert">
                        {scanError}
                      </p>
                    )}

                    <div className="border-t border-slate-200 pt-2 dark:border-slate-700">
                      {confirming === request.id ? (
                        <div className="space-y-2">
                          <p className="text-sm text-slate-700 dark:text-slate-300">
                            {(scannedByRequest[request.id] ?? []).length} ta pallet, jami {scanned.toLocaleString()} kg
                            yuklanadi.
                          </p>
                          {shortfalls.length > 0 && (
                            <p className="text-sm font-medium text-red-600 dark:text-red-400" role="alert">
                              Yetarli emas: {shortfalls
                                .map((s) => `${typeName(s.line.type_id)} ${calibreLabel(s.line.calibre_id)} — ${s.missingKg.toLocaleString()} kg kam`)
                                .join(' · ')}
                              . Baribir yakunlansinmi?
                            </p>
                          )}
                          {finishError && (
                            <p className="text-sm font-medium text-red-600 dark:text-red-400" role="alert">
                              {finishError}
                            </p>
                          )}
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleFinish(request)}
                              disabled={finishing}
                              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                            >
                              {finishing ? 'Yakunlanmoqda…' : 'Ha, yakunlash'}
                            </button>
                            <button
                              onClick={() => {
                                setConfirming(null)
                                setFinishError(null)
                              }}
                              className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400"
                            >
                              Bekor qilish
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirming(request.id)}
                          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          Yuklashni yakunlash
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Ombor's own Window 2 — finished loading (ombor_finished_at set),
          independent of Qorovul's gate weighing (CHIQIM per-role
          finalization). Same collapsed-by-default pattern as S3W2. */}
      <div>
        <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Yuklandi</h2>
        <div className="mt-2 space-y-2">
          {finished.length === 0 && <p className="text-sm text-slate-400">Hali yuklangan so'rov yo'q.</p>}
          {finished.map((request) => (
            <div key={request.id} className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
              <button
                type="button"
                onClick={() => setExpandedFinished(expandedFinished === request.id ? null : request.id)}
                className="flex w-full items-center justify-between text-left"
              >
                <div>
                  <span className="text-slate-900 dark:text-slate-100">
                    {request.request_date} · {request.plate} · {request.driver}
                  </span>
                  <span className="ml-2 text-slate-500 dark:text-slate-400">{ownerName(request.owner_id)}</span>
                </div>
                <span className="text-slate-500 dark:text-slate-400">⋯</span>
              </button>
              <div className="mt-1 text-slate-500 dark:text-slate-400">
                maqsad {requestTarget(request).toLocaleString()} kg · yuklangan {request.ombor_finished_at}
              </div>
              {expandedFinished === request.id && (
                <div className="mt-2 space-y-1 border-t border-slate-200 pt-2 dark:border-slate-700">
                  {request.lines.map((line) => (
                    <div key={line.id} className="flex items-center justify-between text-sm">
                      <span className="text-slate-600 dark:text-slate-400">
                        {typeName(line.type_id)} · {calibreLabel(line.calibre_id)}
                      </span>
                      <span className="text-slate-600 dark:text-slate-400">{line.qty_kg.toLocaleString()} kg</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
