import { useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthProvider'
import { useOwners } from '../../lib/useOwners'
import { useProductTypes } from '../../lib/useProductTypes'
import { useCalibres } from '../../lib/useCalibres'
import { useOmborChiqimRequests, type ChiqimRequest } from '../../lib/useOmborChiqimRequests'
import { useDispatchManifestLines } from '../../lib/useDispatchManifestLines'
import { resolveScan, lineStatus, shortfallLines as computeShortfallLines } from '../../lib/chiqimScan'
import { currentCycleLabStatus } from '../../lib/labVerdict'
import { BarcodeCameraScanner } from '../../components/BarcodeCameraScanner'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { IconButton } from '../../components/ui/IconButton'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { StatusNote } from '../../components/ui/StatusNote'
import { Stat } from '../../components/ui/Stat'
import { StatusPill } from '../../components/ui/StatusPill'
import { TextInput } from '../../components/ui/FormField'
import type { Tone } from '../../components/ui/tokens'

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
// UX pass prompt 1/2 (see docs/DECISIONS.md "UX pass: design system + Ombor
// scan-load"): reference implementation for the shared `components/ui/`
// system, plus camera scanning (`BarcodeCameraScanner`). Presentation and
// one new input path only — every Supabase call, every `chiqimScan.ts`
// decision, and every existing button/heading/placeholder string below is
// unchanged from before this pass; only their layout, styling, and (for
// the scan input) camera-vs-typed source changed. `processBarcode` is the
// one factored-out piece: both the manual form and the camera call it, so
// a camera read behaves byte-for-byte like typing the same code, including
// a voided/claimed/wrong-stage barcode failing exactly the same way.
//
// 🔒 Totals are tracked PER LINE, not per whole request (§5.4: "target
// LINES with progress bars"; "auto-adds ... to the matching type+calibre
// LINE") — confirmed from SPEC.md's locked text, not assumed. Each
// chiqim_lines row gets its own scanned-kg total and its own exact/
// shortfall/overage status.
export function OmborChiqimTab() {
  const { profile } = useAuth()
  // §3.3: includeInactive=true -- resolves ids on in-flight/historical rows;
  // this screen scans barcodes, it has no creation dropdown of its own.
  const { owners } = useOwners(true)
  const { productTypes } = useProductTypes(true)
  const { calibres } = useCalibres(true)
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
  const [undoError, setUndoError] = useState<string | null>(null)
  const [undoingId, setUndoingId] = useState<string | null>(null)
  const { lines: manifestLines, loading: manifestLoading, refresh: refreshManifest } = useDispatchManifestLines(expandedFinished)

  function ownerName(id: string) {
    return owners.find((o) => o.id === id)?.name ?? id
  }
  function typeName(id: string) {
    return productTypes.find((t) => t.id === id)?.name ?? id
  }
  function calibreLabel(id: string) {
    return calibres.find((c) => c.id === id)?.label ?? id
  }

  function lineTotal(requestId: string, lineId: string): number {
    return (scannedByRequest[requestId] ?? [])
      .filter((s) => s.lineId === lineId)
      .reduce((sum, s) => sum + s.weight_kg, 0)
  }
  function requestTarget(request: ChiqimRequest): number {
    return request.lines.reduce((sum, l) => sum + l.qty_kg, 0)
  }

  function lineTotalsFor(requestId: string): Record<string, number> {
    const totals: Record<string, number> = {}
    for (const s of scannedByRequest[requestId] ?? []) totals[s.lineId] = (totals[s.lineId] ?? 0) + s.weight_kg
    return totals
  }

  // The one shared scan-resolution path — manual submit and the camera
  // both call this with a raw barcode string, unchanged from the original
  // handleScan's own lookups/resolveScan call/state update. Returns
  // whether the scan was accepted, so the manual form knows whether to
  // clear its input (only on success — same as before this pass, an
  // operator seeing a rejected code stays able to read/correct it).
  async function processBarcode(request: ChiqimRequest, barcode2: string): Promise<boolean> {
    setScanError(null)
    if (!barcode2) return false

    const { data: pallet } = await supabase
      .from('finished_pallets')
      .select('barcode2, type_id, calibre_id, weight_kg, status, serial')
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

    // §5.5.3/§8 hard gate (v1.9): same currentCycleLabStatus helper
    // Menejer's feasibility checker uses — untested/re-wash-flagged stock
    // must be refused here too, not just hidden from the request form.
    const labStatus = pallet ? (await currentCycleLabStatus([pallet.serial])).get(pallet.serial) : undefined

    const result = resolveScan({
      barcode2,
      alreadyScannedBarcodes: (scannedByRequest[request.id] ?? []).map((s) => s.barcode2),
      pallet: pallet ? { type_id: pallet.type_id, calibre_id: pallet.calibre_id, status: pallet.status } : null,
      labPassed: labStatus === 'passed',
      alreadyClaimed: !!claimed,
      lines: request.lines,
      scannedTotalsByLineId: lineTotalsFor(request.id),
    })

    if (!result.ok) {
      const messages: Record<typeof result.reason, string> = {
        duplicate: 'Bu pallet allaqachon shu ro\'yxatga skanerlangan.',
        not_found: 'Bunday barcode topilmadi.',
        not_in_stock: 'Bu pallet omborda emas (allaqachon jo\'natilgan yoki bekor qilingan).',
        not_lab_passed: 'Bu pallet hali laboratoriya tekshiruvidan o\'tmagan yoki qayta yuvishga yuborilgan.',
        claimed: 'Bu pallet allaqachon boshqa yuklashda ishlatilgan.',
        no_matching_line: 'Bu tur/kalibr ushbu so\'rovda yo\'q.',
      }
      setScanError(messages[result.reason])
      return false
    }

    setScannedByRequest((m) => ({
      ...m,
      [request.id]: [...(m[request.id] ?? []), { barcode2: pallet!.barcode2, lineId: result.lineId, weight_kg: pallet!.weight_kg }],
    }))
    return true
  }

  async function handleScan(request: ChiqimRequest, e: FormEvent) {
    e.preventDefault()
    const barcode2 = barcodeInput.trim()
    if (!barcode2) return
    const ok = await processBarcode(request, barcode2)
    if (ok) setBarcodeInput('')
  }

  function removeScan(requestId: string, barcode2: string) {
    setScannedByRequest((m) => ({
      ...m,
      [requestId]: (m[requestId] ?? []).filter((s) => s.barcode2 !== barcode2),
    }))
  }

  // Undo a scan that already made it into dispatch_manifest (post-finish,
  // pre-gate-stage-2). A real DELETE, not a void — these are Ombor's own
  // in-progress scans, not finalized records (see this session's task).
  // The RLS policy (ombor_deletes, 0021) is the actual enforcement: once
  // Qorovul's stage 2 completes, PostgREST doesn't raise 42501 for a
  // DELETE's USING clause the way it would for an INSERT's WITH CHECK —
  // a row outside the policy's visible set is just silently excluded from
  // the delete, returning success with zero rows affected. `.select()`
  // after the delete is what surfaces that: an empty array means "matched
  // nothing" (either already gone, or RLS-filtered), which for a manifest
  // row we can see in the UI can only mean the latter.
  async function handleUndoScan(manifestId: string) {
    setUndoError(null)
    setUndoingId(manifestId)
    try {
      const { data, error } = await supabase.from('dispatch_manifest').delete().eq('id', manifestId).select('id')
      if (error) {
        setUndoError(error.message)
        return
      }
      if (!data || data.length === 0) {
        setUndoError('Bu so\'rov allaqachon qorovul tomonidan yakunlangan — skanerlashni bekor qilib bo\'lmaydi.')
        return
      }
      await refreshManifest()
    } finally {
      setUndoingId(null)
    }
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
        .update({ ombor_finished_at: new Date().toISOString(), ombor_finished_by: profile?.id })
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
        <SectionHeading>1 · Yuklashga tayyor — moshina keldi</SectionHeading>
        <div className="mt-2 space-y-2">
          {open.length === 0 && <p className="text-sm text-slate-400">Ochiq so'rov yo'q.</p>}
          {open.map((request) => {
            const isExpanded = expandedOpen === request.id
            const target = requestTarget(request)
            const scanned = (scannedByRequest[request.id] ?? []).reduce((sum, s) => sum + s.weight_kg, 0)
            const totalsByLine = lineTotalsFor(request.id)
            const shortfalls = computeShortfallLines(request.lines, totalsByLine)
            // Aggregate glance-state for the running-total banner —
            // composed here from the SAME per-line lineStatus() every line
            // row below already uses, not a new decision. Mirrors the
            // existing per-line convention exactly: shortfall stays
            // neutral (still in progress, never a problem on its own),
            // overage on ANY line is the pending/amber signal, and emerald
            // only once every line is exact.
            const lineStatuses = request.lines.map((l) => lineStatus(l.qty_kg, lineTotal(request.id, l.id)))
            const aggregateTone: Tone =
              scanned === 0
                ? 'neutral'
                : lineStatuses.some((s) => s === 'overage')
                  ? 'pending'
                  : lineStatuses.every((s) => s === 'exact')
                    ? 'ok'
                    : 'neutral'

            return (
              <Card key={request.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-slate-900 dark:text-slate-100">
                      {ownerName(request.owner_id)}
                    </div>
                    <div className="truncate text-sm text-slate-500 dark:text-slate-400">
                      So'rov · {request.request_date} · {request.plate} · {request.driver}
                    </div>
                  </div>
                  <StatusPill tone="info">Nishon {target.toLocaleString()} kg</StatusPill>
                </div>

                <div className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                  {request.lines
                    .map((l) => `${typeName(l.type_id)} ${calibreLabel(l.calibre_id)} · ${l.qty_kg.toLocaleString()}`)
                    .join('   ')}
                </div>

                {/* Gate-weighing status (flagged item #2 of this task's inspect-
                    and-report): informational only, never gates "Yuklashni
                    boshlash" below — matches this app's consistent never-block
                    philosophy (Kam chiqdi, Tugallash warnings, this same
                    screen's own shortfall note). Both states shown explicitly
                    so a not-yet-weighed request reads as a real state, not a
                    rendering gap. */}
                <div className="mt-2">
                  {request.gateStage1CompletedAt ? (
                    <StatusNote tone="ok">
                      ✓ Qorovul bo'sh vaznni oldi ({(request.gatePustoyKg ?? 0).toLocaleString()} kg) — yuklasa bo'ladi
                    </StatusNote>
                  ) : (
                    <StatusNote tone="pending">Qorovul hali bo'sh vaznni olmagan</StatusNote>
                  )}
                </div>

                {!isExpanded && (
                  <div className="mt-3">
                    <Button variant="primary" size="lg" fullWidth onClick={() => setExpandedOpen(request.id)}>
                      Yuklashni boshlash
                    </Button>
                  </div>
                )}

                {isExpanded && (
                  <div className="mt-3 space-y-4 border-t border-slate-200 pt-3 dark:border-slate-700">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1.5 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500 dark:text-slate-400">Buyurtmachi</span>
                          <span className="font-medium text-slate-900 dark:text-slate-100">{ownerName(request.owner_id)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500 dark:text-slate-400">So'rov sanasi</span>
                          <span className="font-medium text-slate-900 dark:text-slate-100">{request.request_date}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500 dark:text-slate-400">Moshina · haydovchi</span>
                          <span className="font-medium text-slate-900 dark:text-slate-100">
                            {request.plate} · {request.driver}
                          </span>
                        </div>
                      </div>
                      <Button variant="ghost" size="md" onClick={() => setExpandedOpen(null)}>
                        Yopish
                      </Button>
                    </div>

                    {/* Nishon lines with live progress bars, replacing the
                        prior plain-number Cards — same lineStatus()/lineTotal()
                        data, just visualised per the mockup. */}
                    <div>
                      <div className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                        Nishon — tur va kalibr bo'yicha
                      </div>
                      <div className="space-y-2">
                        {request.lines.map((line) => {
                          const lineScanned = lineTotal(request.id, line.id)
                          const status = lineStatus(line.qty_kg, lineScanned)
                          const pct = line.qty_kg > 0 ? Math.min(100, (lineScanned / line.qty_kg) * 100) : 0
                          return (
                            <div key={line.id}>
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-slate-700 dark:text-slate-300">
                                  {typeName(line.type_id)} · {calibreLabel(line.calibre_id)}
                                </span>
                                <span
                                  className={
                                    status === 'exact'
                                      ? 'font-medium text-emerald-600 dark:text-emerald-400'
                                      : status === 'overage'
                                        ? 'font-medium text-amber-600 dark:text-amber-400'
                                        : 'text-slate-500 dark:text-slate-400'
                                  }
                                >
                                  {lineScanned.toLocaleString()} / {line.qty_kg.toLocaleString()}
                                  {status === 'exact' ? ' ✓' : ''}
                                </span>
                              </div>
                              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                                <div
                                  className={`h-full rounded-full ${
                                    status === 'exact'
                                      ? 'bg-emerald-500'
                                      : status === 'overage'
                                        ? 'bg-amber-500'
                                        : 'bg-slate-900 dark:bg-slate-100'
                                  }`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {/* Scan zone — the repeated action (10-20x per truck).
                        Camera first (the primary, minimal-tap path), manual
                        entry kept directly beneath as a fallback — both
                        call the same processBarcode. */}
                    <div className="space-y-2">
                      <BarcodeCameraScanner onDecode={(code) => processBarcode(request, code)} />
                      <form onSubmit={(e) => handleScan(request, e)} className="flex items-center gap-2">
                        <TextInput
                          placeholder="Barcode #2 ni kiriting yoki skanerlang"
                          value={barcodeInput}
                          onChange={(e) => setBarcodeInput(e.target.value)}
                          className="flex-1"
                        />
                        <Button type="submit" variant="secondary" size="md">
                          Skanerlash
                        </Button>
                      </form>
                      {scanError && <StatusNote tone="problem">{scanError}</StatusNote>}
                    </div>

                    {/* Flat scanned-pallet list (mockup: "Skanerlangan
                        palletlar (N)") — chronological, not regrouped by
                        line; each row still resolves back to its line for the
                        type/calibre caption. */}
                    <div>
                      <div className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">
                        Skanerlangan palletlar ({(scannedByRequest[request.id] ?? []).length})
                      </div>
                      {(scannedByRequest[request.id] ?? []).length === 0 ? (
                        <p className="text-sm text-slate-400">Hali skanerlangan yo'q.</p>
                      ) : (
                        <ul className="space-y-1">
                          {(scannedByRequest[request.id] ?? []).map((sc) => {
                            const line = request.lines.find((l) => l.id === sc.lineId)
                            return (
                              <li
                                key={sc.barcode2}
                                className="flex items-center justify-between gap-2 border-b border-slate-100 py-1 text-sm last:border-0 dark:border-slate-800"
                              >
                                <span className="min-w-0 flex-1 truncate">
                                  <span className="font-mono text-xs text-slate-600 dark:text-slate-400">{sc.barcode2}</span>
                                  {line && (
                                    <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">
                                      · {typeName(line.type_id)} · {calibreLabel(line.calibre_id)}
                                    </span>
                                  )}
                                </span>
                                <span className="shrink-0 font-medium text-slate-900 dark:text-slate-100">
                                  {sc.weight_kg.toLocaleString()} kg
                                </span>
                                <IconButton
                                  label="Skanerlashni bekor qilish"
                                  tone="danger"
                                  onClick={() => removeScan(request.id, sc.barcode2)}
                                >
                                  ✕
                                </IconButton>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>

                    {/* Total footer + finish — kept together at the bottom,
                        thumb-reachable without scrolling past the pallet
                        list, never blocked by a shortfall (§5.4/§3.1). The
                        shortfall note is now live during scanning (not just
                        at confirm), same missingKg computation as before —
                        no "no whole pallet" claim (flagged item #3, not built). */}
                    <div className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-700">
                      <Stat
                        value={`${scanned.toLocaleString()} / ${target.toLocaleString()} kg`}
                        label="Umumiy yuklangan"
                        tone={aggregateTone}
                      />
                      {shortfalls.length > 0 && (
                        <StatusNote tone="pending">
                          Yetarli emas: {shortfalls
                            .map((s) => `${typeName(s.line.type_id)} ${calibreLabel(s.line.calibre_id)} — ${s.missingKg.toLocaleString()} kg kam`)
                            .join(' · ')}
                          . Baribir yakunlash mumkin — sabab qayd sifatida yoziladi.
                        </StatusNote>
                      )}

                      {confirming === request.id ? (
                        <div className="space-y-2">
                          <p className="text-sm text-slate-700 dark:text-slate-300">
                            {(scannedByRequest[request.id] ?? []).length} ta pallet, jami {scanned.toLocaleString()} kg
                            yuklanadi.
                          </p>
                          {finishError && <StatusNote tone="problem">{finishError}</StatusNote>}
                          <div className="flex gap-2">
                            <Button variant="primary" size="lg" onClick={() => handleFinish(request)} disabled={finishing}>
                              {finishing ? 'Yakunlanmoqda…' : 'Ha, yakunlash'}
                            </Button>
                            <Button
                              variant="ghost"
                              size="md"
                              onClick={() => {
                                setConfirming(null)
                                setFinishError(null)
                              }}
                            >
                              Bekor qilish
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button variant="primary" size="lg" fullWidth onClick={() => setConfirming(request.id)}>
                          Yuklashni yakunlash
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      </div>

      {/* Ombor's own Window 2 — finished loading (ombor_finished_at set),
          independent of Qorovul's gate weighing (CHIQIM per-role
          finalization). Same collapsed-by-default pattern as S3W2. */}
      <div>
        <SectionHeading>2 · Yuklandi · qorovulga topshirildi</SectionHeading>
        <div className="mt-2 space-y-2">
          {finished.length === 0 && <p className="text-sm text-slate-400">Hali yuklangan so'rov yo'q.</p>}
          {finished.map((request) => (
            <Card key={request.id} padding="compact">
              <button
                type="button"
                onClick={() => {
                  setExpandedFinished(expandedFinished === request.id ? null : request.id)
                  setUndoError(null)
                }}
                className="flex w-full items-center justify-between gap-2 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                    {ownerName(request.owner_id)}
                    {request.lines.length > 0 &&
                      ` · ${[...new Set(request.lines.map((l) => typeName(l.type_id)))].join(' + ')}`}
                  </div>
                  <div className="truncate text-sm text-slate-500 dark:text-slate-400">
                    {request.plate} · {request.driver} · maqsad {requestTarget(request).toLocaleString()} kg · yuklangan{' '}
                    {request.ombor_finished_at ? new Date(request.ombor_finished_at).toLocaleString() : ''}
                  </div>
                </div>
                <span className="shrink-0 text-slate-500 dark:text-slate-400">⋯</span>
              </button>
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

                  {/* Scanned pallets, flat (not regrouped by line) — see
                      useDispatchManifestLines: dispatch_manifest doesn't
                      persist which line a pallet was assigned to. Undo here
                      is a real DELETE, enforced server-side by the
                      ombor_deletes RLS policy (0021) up to gate stage 2. */}
                  <div className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-700">
                    <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                      <span>Skanerlangan palletlar</span>
                      <span>
                        {manifestLines.reduce((sum, l) => sum + l.weight_kg, 0).toLocaleString()} kg
                      </span>
                    </div>
                    {manifestLoading && <p className="mt-1 text-xs text-slate-400">Yuklanmoqda…</p>}
                    {!manifestLoading && manifestLines.length === 0 && (
                      <p className="mt-1 text-xs text-slate-400">Skanerlangan pallet yo'q.</p>
                    )}
                    {manifestLines.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {manifestLines.map((m) => (
                          <li key={m.id} className="flex items-center justify-between text-xs">
                            <span className="font-mono text-slate-600 dark:text-slate-400">
                              {m.barcode2} · {typeName(m.type_id)} · {calibreLabel(m.calibre_id)} · {m.weight_kg.toLocaleString()} kg
                            </span>
                            <IconButton
                              label="Skanerlashni bekor qilish"
                              tone="danger"
                              disabled={undoingId === m.id}
                              onClick={() => handleUndoScan(m.id)}
                            >
                              ✕
                            </IconButton>
                          </li>
                        ))}
                      </ul>
                    )}
                    {undoError && <StatusNote tone="problem">{undoError}</StatusNote>}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
