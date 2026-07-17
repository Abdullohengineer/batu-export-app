import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthProvider'
import { useProductTypes } from '../../lib/useProductTypes'
import { useOwners } from '../../lib/useOwners'
import { useCalibres } from '../../lib/useCalibres'
import { useMoykaOutput, type OutputSerial, type FinishedPallet } from '../../lib/useMoykaOutput'
import { useMoykaSerials } from '../../lib/useMoykaSerials'
import { computeFinalLossPct, completionBadge, tugallashWarnings } from '../../lib/tayyorCompletion'
import { hasRawRemainder } from '../../lib/stageMembership'
import { FinishedReceiptForm, type ReceiptValues } from './FinishedReceiptForm'
import { Barcode2Display } from './Barcode2Display'

// §5.3 Tayyor Mahsulot: serials in Moyka awaiting output. Daily receipt form
// (one pallet per save → Barcode #2, form closes on every submit — no
// auto-reopen), per-serial totals (Yuborilgan / Qabul qilingan / Jarayonda,
// floored at 0, with non-blocking Ortiqcha on overage). Finishing is
// ALWAYS manual now (DECISIONS "Manual-only finishing") — there is no
// auto-finalize path; a serial stays in this window, finishable at any
// time regardless of received vs sent, until the operator clicks Tugallash.
// Tugallash shows a non-blocking soft warning (raw remainder still in
// storage, and/or loss > 10%) but never disables the action itself.
// Window 2 (Tugallangan, added — see DECISIONS "Tugallangan window"): finalized
// cycle-1 serials via Tugallash, ⋯ expand reusing the same pallet-list
// pattern as Window 1, with a loss/gain badge (Ortiqcha wins over a negative
// loss reading, same as Window 1's non-blocking overage treatment).
export function OmborTayyorTab() {
  const { profile } = useAuth()
  const { productTypes } = useProductTypes()
  const { owners } = useOwners()
  const { calibres } = useCalibres()
  const { serials, completed, loading, refresh } = useMoykaOutput()
  // Reused (not reimplemented) purely for each serial's actual_qty, to
  // evaluate the Tugallash soft-warning's "raw remainder in storage" leg
  // with the same hasRawRemainder predicate §5.1/§5.2 already use.
  const { serials: moykaSerials, loading: moykaLoading } = useMoykaSerials()
  const [activeForm, setActiveForm] = useState<string | null>(null)
  const [lastBarcode, setLastBarcode] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState<string | null>(null)
  const [expandedActive, setExpandedActive] = useState<string | null>(null)
  const [expandedCompleted, setExpandedCompleted] = useState<string | null>(null)

  function typeName(id: string) {
    return productTypes.find((t) => t.id === id)?.name ?? id
  }
  function ownerName(id: string) {
    return owners.find((o) => o.id === id)?.name ?? id
  }
  function calibreLabel(id: string) {
    return calibres.find((c) => c.id === id)?.label ?? id
  }

  // Shared with both windows — one pallet per row, its Barcode #2 reprintable.
  function palletList(serial: string, typeId: string, ownerId: string, pallets: FinishedPallet[]) {
    if (pallets.length === 0) return null
    return (
      <ul className="mt-2 space-y-1">
        {pallets.map((p) => (
          <li key={p.barcode2} className="flex items-center justify-between gap-2">
            <span className="text-slate-600 dark:text-slate-400">
              <span className="font-mono">{p.barcode2}</span> · {calibreLabel(p.calibre_id)} ·{' '}
              {p.weight_kg.toLocaleString()} kg
            </span>
            <Barcode2Display
              data={{
                barcode2: p.barcode2,
                serial,
                type: typeName(typeId),
                calibre: calibreLabel(p.calibre_id),
                weightKg: p.weight_kg,
                owner: ownerName(ownerId),
              }}
            />
          </li>
        ))}
      </ul>
    )
  }

  // Window 2 badge — decision logic lives in tayyorCompletion.ts (pure,
  // unit-tested); this just renders whichever kind it picks.
  function lossBadge(lossPct: number, excess: number) {
    const badge = completionBadge(lossPct, excess)
    if (badge.kind === 'ortiqcha') {
      return (
        <span className="font-medium text-amber-600 dark:text-amber-400">Ortiqcha: +{badge.excessKg.toLocaleString()} kg</span>
      )
    }
    return (
      <span className={badge.pct > 0 ? 'font-medium text-red-600 dark:text-red-400' : 'font-medium text-slate-500 dark:text-slate-400'}>
        {badge.pct > 0 ? '-' : ''}
        {badge.pct.toFixed(1)}%
      </span>
    )
  }

  // §5.3 Tugallash soft warning (DECISIONS "Manual-only finishing"): never
  // blocks. Which reason(s) apply is decided by the pure, unit-tested
  // tugallashWarnings (tayyorCompletion.ts); this only computes the two
  // inputs it needs and renders the matching Uzbek text — same convention
  // as lossBadge/completionBadge above. Raw remainder uses the same
  // hasRawRemainder predicate §5.1/§5.2 use (section mirroring).
  function tugallashWarningText(s: OutputSerial): string[] {
    const actualQty = moykaSerials.find((m) => m.serial === s.serial)?.actual_qty ?? s.sent
    const remainderKg = hasRawRemainder(actualQty, s.sent) ? actualQty - s.sent : 0
    const lossPct = computeFinalLossPct(s.sent, s.received)
    const reasons = tugallashWarnings(remainderKg, lossPct)
    return reasons.map((reason) =>
      reason === 'remainder'
        ? `${remainderKg.toLocaleString()} kg hali omborda qoldi`
        : `Yo'qotish ${lossPct.toFixed(1)}% — 10% dan yuqori`,
    )
  }

  // §5.3: one pallet per save → one finished_pallets row + its Barcode #2.
  // The form always closes on submit (no auto-reopen — see DECISIONS "Tayyor
  // Mahsulot completion"); a new entry needs an explicit button click. No
  // auto-finalize here anymore (DECISIONS "Manual-only finishing") — saving
  // a receipt never locks the cycle; only Tugallash does that.
  async function handleReceipt(serial: OutputSerial, values: ReceiptValues) {
    const { error } = await supabase.from('finished_pallets').insert({
      barcode2: values.barcode2,
      serial: serial.serial,
      type_id: serial.type_id,
      calibre_id: values.calibreId,
      weight_kg: values.weightKg,
      received_date: new Date().toISOString().slice(0, 10),
      created_by: profile?.id,
    })
    if (error) throw error

    setLastBarcode((m) => ({ ...m, [serial.serial]: values.barcode2 }))
    setActiveForm(null)
    refresh()
  }

  // §5.3 Tugallash: the ONLY way a serial reaches Window 2 (DECISIONS
  // "Manual-only finishing") — always a deliberate operator click, never
  // triggered by any received/sent comparison. Idempotent upsert on
  // (serial, cycle_no); soft-warned (never blocked) in the UI before this
  // runs when raw remainder or loss > 10% applies.
  async function handleTugallash(serial: OutputSerial) {
    const { error } = await supabase.from('wash_cycles').upsert(
      {
        serial: serial.serial,
        cycle_no: 1,
        status: 'final',
        final_loss_pct: computeFinalLossPct(serial.sent, serial.received),
      },
      { onConflict: 'serial,cycle_no' },
    )
    if (error) throw error
    setConfirming(null)
    refresh()
  }

  if (loading || moykaLoading) return null

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Moykada — chiqishi kutilmoqda</h2>
      {serials.length === 0 && <p className="text-sm text-slate-400">Kutilayotgan serial yo'q.</p>}

      {serials.map((s) => {
        const lossPct = computeFinalLossPct(s.sent, s.received)
        const lastB = lastBarcode[s.serial]
        const warnings = tugallashWarningText(s)
        const isExpanded = expandedActive === s.serial
        return (
          <div key={s.serial} className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
            {/* Collapsed by default (density fix) — reuses the same
                toggle-button + minimal-identifying-info pattern already
                used by Window 2 (Tugallangan) below: serial · type · owner
                plus the totals line stay visible collapsed; pallets, the
                receipt form, and Tugallash move behind the expand. */}
            <button
              type="button"
              onClick={() => setExpandedActive(isExpanded ? null : s.serial)}
              className="flex w-full items-center justify-between text-left"
            >
              <div>
                <span className="font-mono text-slate-900 dark:text-slate-100">{s.serial}</span>
                <span className="ml-2 text-slate-500 dark:text-slate-400">
                  {typeName(s.type_id)} · {ownerName(s.owner_id)}
                </span>
              </div>
              <span className="text-slate-500 dark:text-slate-400">⋯</span>
            </button>

            <div className="mt-1 text-slate-500 dark:text-slate-400">
              Yuborilgan: {s.sent.toLocaleString()} kg · Qabul qilingan: {s.received.toLocaleString()} kg · Jarayonda:{' '}
              <span className="font-medium text-slate-900 dark:text-slate-100">{s.inProcess.toLocaleString()} kg</span>
              {s.excess > 0 && (
                <span className="ml-2 font-medium text-amber-600 dark:text-amber-400">
                  Ortiqcha: +{s.excess.toLocaleString()} kg
                </span>
              )}
            </div>

            {isExpanded && (
              <>
                {activeForm !== s.serial && (
                  <button
                    onClick={() => setActiveForm(s.serial)}
                    className="mt-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    {s.pallets.length === 0 ? '+ Qabul qilish' : "+ Yana qo'shish"}
                  </button>
                )}

                {/* pallets received so far, each with its Barcode #2 */}
                {palletList(s.serial, s.type_id, s.owner_id, s.pallets)}

                {/* §5.3 fix: form always closes on submit (no auto-reopen) — a new
                    entry needs the "+ Yana qo'shish" click above. The last
                    sticker stays visible/printable after close, independent of
                    activeForm (see DECISIONS "Tayyor Mahsulot completion"). */}
                {activeForm === s.serial && (
                  <FinishedReceiptForm
                    serial={s}
                    typeName={typeName(s.type_id)}
                    calibres={calibres}
                    onCancel={() => setActiveForm(null)}
                    onSubmit={(values) => handleReceipt(s, values)}
                  />
                )}
                {lastB && (
                  <div className="mt-2">
                    <div className="text-xs text-slate-500 dark:text-slate-400">Oxirgi Barcode #2:</div>
                    <Barcode2Display
                      defaultOpen
                      data={{
                        barcode2: lastB,
                        serial: s.serial,
                        type: typeName(s.type_id),
                        calibre: calibreLabel(s.pallets.find((p) => p.barcode2 === lastB)?.calibre_id ?? ''),
                        weightKg: s.pallets.find((p) => p.barcode2 === lastB)?.weight_kg ?? 0,
                        owner: ownerName(s.owner_id),
                      }}
                    />
                  </div>
                )}

                {/* Tugallash: always clickable (DECISIONS "Manual-only finishing")
                    — enablement never depends on Jarayonda/remaining. Soft
                    warning (never blocks) when raw remainder remains and/or
                    loss exceeds 10%. */}
                <div className="mt-3 border-t border-slate-200 pt-2 dark:border-slate-700">
                  {confirming === s.serial ? (
                    <div className="space-y-2">
                      <p className="text-sm text-slate-700 dark:text-slate-300">
                        Yakuniy hisobot — {s.pallets.length} ta pallet, jami {s.received.toLocaleString()} kg qabul qilindi.
                        Yo'qotish <span className="font-medium">{lossPct.toFixed(1)}%</span> deb qulflanadi.
                      </p>
                      {warnings.length > 0 && (
                        <p className="text-sm font-medium text-red-600 dark:text-red-400" role="alert">
                          {warnings.join(' · ')}. Baribir davom etilsinmi?
                        </p>
                      )}
                      {warnings.length === 0 && <p className="text-sm text-slate-700 dark:text-slate-300">Davom etilsinmi?</p>}
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleTugallash(s)}
                          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900"
                        >
                          Ha, tugallash
                        </button>
                        <button
                          onClick={() => setConfirming(null)}
                          className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400"
                        >
                          Bekor qilish
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirming(s.serial)}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      Tugallash
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )
      })}

      {/* Window 2 — Tugallangan: finalized cycle-1 serials (always via
          Tugallash). ⋯ expand reuses the Window 1 pallet-list pattern; badge
          is Ortiqcha (non-blocking overage, wins) or the locked loss %. */}
      <div>
        <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Tugallangan</h2>
        <div className="mt-2 space-y-2">
          {completed.length === 0 && <p className="text-sm text-slate-400">Tugallangan serial yo'q.</p>}
          {completed.map((c) => (
            <div key={c.serial} className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
              <button
                type="button"
                onClick={() => setExpandedCompleted(expandedCompleted === c.serial ? null : c.serial)}
                className="flex w-full items-center justify-between text-left"
              >
                <div>
                  <span className="font-mono text-slate-900 dark:text-slate-100">{c.serial}</span>
                  <span className="ml-2 text-slate-500 dark:text-slate-400">
                    {ownerName(c.owner_id)} · {typeName(c.type_id)}
                  </span>
                </div>
                <span className="text-slate-500 dark:text-slate-400">⋯</span>
              </button>
              <div className="mt-1 text-slate-500 dark:text-slate-400">
                Yuborilgan {c.sent.toLocaleString()} → tayyor {c.received.toLocaleString()} kg ·{' '}
                {lossBadge(c.lossPct, c.excess)}
              </div>
              {expandedCompleted === c.serial && palletList(c.serial, c.type_id, c.owner_id, c.pallets)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
