import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthProvider'
import { useProductTypes } from '../../lib/useProductTypes'
import { useOwners } from '../../lib/useOwners'
import { useCalibres } from '../../lib/useCalibres'
import { useMoykaOutput, type OutputSerial, type FinishedPallet, type CompletedSerial } from '../../lib/useMoykaOutput'
import { useMoykaSerials } from '../../lib/useMoykaSerials'
import { computeFinalLossPct, completionBadge, tugallashWarnings } from '../../lib/tayyorCompletion'
import { hasRawRemainder } from '../../lib/stageMembership'
import { FinishedReceiptForm, type ReceiptValues } from './FinishedReceiptForm'
import { Barcode2Display } from './Barcode2Display'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { StatusNote } from '../../components/ui/StatusNote'
import { SerialChip } from '../../components/ui/SerialChip'
import { Stat } from '../../components/ui/Stat'

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
// serials via Tugallash, ⋯ expand reusing the same pallet-list pattern as
// Window 1, with a loss/gain badge (Ortiqcha wins over a negative loss
// reading, same as Window 1's non-blocking overage treatment).
//
// Laborator v2 (2026-07-28 — see DECISIONS.md "Lab moves inside Moyka,
// wash-cycle concept removed"): the hard gate moved HERE, to packing —
// Barcode #2 assignment (handleReceipt) is blocked until the serial's
// CURRENT lab verdict is a pass (labStatus, from useMoykaOutput.ts via
// labVerdict.ts's currentLabStatus). This is a UI convenience only; the
// real enforcement is a Postgres RLS policy on finished_pallets' INSERT
// (0035_lab_relocation_core.sql) that refuses the write outright — hiding
// the button here just avoids Ombor hitting that rejection in the normal
// case. Re-wash re-send/void UI removed entirely (not just hidden) — there
// is nothing left for Ombor to action; a reject reappears in Laborator's
// own CHIQIM window for immediate re-test with no Ombor step in between.
export function OmborTayyorTab() {
  const { profile } = useAuth()
  // §3.3: includeInactive=true -- typeName/ownerName/calibreLabel resolve
  // historical rows. The NEW-pallet creation dropdown (FinishedReceiptForm,
  // below) gets a derived active-only subset instead of this full list.
  const { productTypes } = useProductTypes(true)
  const { owners } = useOwners(true)
  const { calibres } = useCalibres(true)
  const activeCalibres = calibres.filter((c) => c.active)
  const { serials, completed, loading, refresh } = useMoykaOutput()
  // Reused (not reimplemented) purely for each serial's actual_qty, to
  // evaluate the Tugallash soft-warning's "raw remainder in storage" leg
  // with the same hasRawRemainder predicate §5.1/§5.2 already use.
  const { serials: moykaSerials, loading: moykaLoading } = useMoykaSerials()
  const [activeForm, setActiveForm] = useState<string | null>(null)
  const [lastBarcode, setLastBarcode] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState<string | null>(null)
  const [expandedCompleted, setExpandedCompleted] = useState<string | null>(null)
  // §5.3 "Ombor printing gaps": Window 1's only reprint access used to be
  // `lastBarcode` (this session's own just-saved pallet) or going through
  // Tugallash-confirm — meaning leaving and returning to the screen (a
  // fresh mount clears `lastBarcode`) left no way back to an
  // already-received pallet's sticker short of finishing the serial. Mirrors
  // `expandedCompleted` below — same toggle-one-at-a-time pattern Window 2
  // already uses for the identical "show this serial's pallets" content.
  const [expandedPallets, setExpandedPallets] = useState<string | null>(null)

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
    const input = moykaSerials.find((m) => m.serial === s.serial)?.inputKg ?? s.sent
    const remainderKg = hasRawRemainder(input, s.sent) ? input - s.sent : 0
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
  // a receipt never locks the serial; only Tugallash does that.
  //
  // The real hard gate is the RLS policy on this INSERT (see file header) —
  // if it somehow fires (a lab verdict flipping between render and submit),
  // this throws and FinishedReceiptForm's own error handling surfaces it.
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

    // Opening stock, Stage 3 (2026-08-02) — output packed out of a MINTED
    // serial carries a note recording its old-stock lineage, so the fact
    // survives on the goods themselves and not only in the mint record.
    // Written against the serial (entity_type='moyka'), not a new
    // per-pallet entity_type, deliberately: that key is already rendered in
    // three places (Ombor's Moyka tab, Laborator's CHIQIM card, the
    // passport's Qaydlar section), so this note is readable the moment it
    // is written rather than being an orphan nobody displays. The barcode2
    // is named in the body to keep it pallet-precise; the passport's
    // Kelib chiqishi section carries the full source-pallet breakdown.
    if (serial.isMinted) {
      const { error: noteErr } = await supabase.from('notes').insert({
        entity_type: 'moyka',
        entity_id: serial.serial,
        author: profile?.id,
        body: `${values.barcode2} — eski zaxiradan qayta yuvilgan mahsulot (${values.weightKg.toLocaleString()} kg).`,
      })
      if (noteErr) throw noteErr
    }

    setLastBarcode((m) => ({ ...m, [serial.serial]: values.barcode2 }))
    setActiveForm(null)
    refresh()
  }

  // §5.3 Tugallash: the ONLY way a serial reaches Window 2 (DECISIONS
  // "Manual-only finishing") — always a deliberate operator click, never
  // triggered by any received/sent comparison. Idempotent upsert on serial
  // (the row already exists from OmborMoykaTab's first-send upsert — this
  // just updates it); soft-warned (never blocked) in the UI before this
  // runs when raw remainder or loss > 10% applies.
  //
  // Hard availability gate (2026-08-14 restoration, see DECISIONS.md "Ombor
  // Moyka finalize: restore the lab-verdict hard gate on Tugallash"): the
  // button that calls this is no longer rendered while labStatus !==
  // 'passed', so this check should be unreachable in normal use -- it's
  // defense in depth, same shape as handleReceipt's reliance on the RLS
  // gate above. The database-level gate (mirroring finished_pallets'
  // ombor_writes policy) is a separate, explicitly-confirmed migration --
  // see the PR/DECISIONS entry for whether it has landed.
  async function handleTugallash(serial: OutputSerial) {
    if (serial.labStatus !== 'passed') {
      throw new Error("Tugallash bloklangan: seriyada o'tdi natijasi yo'q.")
    }
    const { error } = await supabase.from('wash_cycles').upsert(
      {
        serial: serial.serial,
        status: 'final',
        final_loss_pct: computeFinalLossPct(serial.sent, serial.received),
        // §5.3 "Ombor printing gaps": the real completion-time signal Window
        // 2's newest-first sort needs (useMoykaOutput.ts) — this upsert only
        // ever fires from this one Tugallash click, so it's always a genuine
        // finalization moment, not a value that needs separate "don't
        // overwrite on update" handling.
        finalized_at: new Date().toISOString(),
      },
      { onConflict: 'serial' },
    )
    if (error) throw error
    setConfirming(null)
    refresh()
  }

  if (loading || moykaLoading) return null

  return (
    <div className="space-y-4">
      <SectionHeading>1 · Moykada — chiqishi kutilmoqda</SectionHeading>
      {serials.length === 0 && <p className="text-sm text-slate-400">Kutilayotgan serial yo'q.</p>}

      {serials.map((s) => {
        const lossPct = computeFinalLossPct(s.sent, s.received)
        const lastB = lastBarcode[s.serial]
        const warnings = tugallashWarningText(s)
        const isConfirming = confirming === s.serial
        return (
          <Card key={s.serial}>
            <div className="flex items-center gap-2">
              <SerialChip>{s.serial}</SerialChip>
              <span className="min-w-0 flex-1 truncate font-semibold text-slate-900 dark:text-slate-100">
                {ownerName(s.owner_id)} · {typeName(s.type_id)}
              </span>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-2">
              <Stat value={s.sent.toLocaleString()} label="Yuborilgan" />
              <Stat value={s.received.toLocaleString()} label="Qabul qilingan" tone="ok" />
              <Stat value={s.inProcess.toLocaleString()} label="Jarayonda" tone="pending" />
            </div>
            {s.excess > 0 && (
              <div className="mt-2">
                <StatusNote tone="pending">Ortiqcha: +{s.excess.toLocaleString()} kg</StatusNote>
              </div>
            )}

            {/* §5.3 "Ombor printing gaps": every already-received pallet for
                this in-progress serial, reprintable, independent of the
                Tugallash-confirm flow below — the same palletList() helper
                that flow already used, just no longer gated behind it. */}
            {s.pallets.length > 0 && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setExpandedPallets(expandedPallets === s.serial ? null : s.serial)}
                  className="text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  Qabul qilingan palletlar ({s.pallets.length}) {expandedPallets === s.serial ? '▲' : '▼'}
                </button>
                {expandedPallets === s.serial && palletList(s.serial, s.type_id, s.owner_id, s.pallets)}
              </div>
            )}

            {!isConfirming && (
              <div className="mt-3">
                {s.labStatus === 'passed' ? (
                  <div className="flex gap-2">
                    <Button variant="primary" size="lg" className="flex-1" onClick={() => setActiveForm(s.serial)}>
                      {s.pallets.length === 0 ? '+ Qabul qilish' : "+ Yana qo'shish"}
                    </Button>
                    <Button variant="secondary" size="lg" className="flex-1" onClick={() => setConfirming(s.serial)}>
                      Tugallash
                    </Button>
                  </div>
                ) : (
                  // Hard availability gate (SPEC.md §5.5.3), the documented
                  // exception to the §5.3 soft-warning rule -- NOT a warning.
                  // No Tugallash here: without a passing verdict, "received"
                  // can only ever be 0, so finishing now could only lock in a
                  // fabricated 100% loss, never a real result. Restores the
                  // receive/finish symmetry the 2026-07-28 lab-relocation
                  // change (d85664d) established for receiving but never
                  // extended to Tugallash -- see DECISIONS.md "Ombor Moyka
                  // finalize: restore the lab-verdict hard gate on Tugallash."
                  <StatusNote tone={s.labStatus === 'failed' ? 'problem' : 'pending'}>
                    {s.labStatus === 'failed'
                      ? "Rad etildi — qayta tekshirilmoqda. Qabul qilish va tugallash uchun o'tdi natijasi kerak."
                      : "Tahlil kutilmoqda — qabul qilish va tugallash uchun Laborator tekshiruvi (o'tdi natijasi) kerak."}
                  </StatusNote>
                )}
              </div>
            )}

            {/* §5.3 fix: form always closes on submit (no auto-reopen) — a new
                entry needs the "+ Yana qo'shish" click above. The last
                sticker stays visible/printable after close, independent of
                activeForm (see DECISIONS "Tayyor Mahsulot completion"). */}
            {activeForm === s.serial && (
              <FinishedReceiptForm
                serial={s}
                typeName={typeName(s.type_id)}
                ownerName={ownerName(s.owner_id)}
                calibres={activeCalibres}
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
                — enablement never depends on Jarayonda/remaining or lab
                status (a serial can legitimately finish at 0 output).
                Soft warning (never blocks) when raw remainder remains
                and/or loss exceeds 10%. Mockup ("Qabul tarixi + 'Tugallash'
                tasdiqi"): the receipt history and the double-confirm are the
                same view — folded together here rather than a separate
                always-on expand. */}
            {isConfirming && (
              <div className="mt-3 space-y-3 border-t border-slate-200 pt-3 dark:border-slate-700">
                {palletList(s.serial, s.type_id, s.owner_id, s.pallets)}
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-200">Tugallashni tasdiqlang</p>
                  <div className="mt-2 space-y-1 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 dark:text-slate-400">Yuborilgan (xom)</span>
                      <span className="font-medium text-slate-900 dark:text-slate-100">{s.sent.toLocaleString()} kg</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 dark:text-slate-400">Jami tayyor mahsulot</span>
                      <span className="font-medium text-slate-900 dark:text-slate-100">{s.received.toLocaleString()} kg</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 dark:text-slate-400">Yakuniy yo'qotish</span>
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {(s.sent - s.received).toLocaleString()} kg · {lossPct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  {warnings.length > 0 && (
                    <p className="mt-2 text-sm font-medium text-red-600 dark:text-red-400" role="alert">
                      {warnings.join(' · ')}. Baribir davom etilsinmi?
                    </p>
                  )}
                  <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">
                    Tugallangach seriya faol ro'yxatdan chiqadi va yo'qotish raqami qulflanadi.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button variant="ghost" size="md" onClick={() => setConfirming(null)}>
                      Bekor
                    </Button>
                    <Button variant="primary" size="md" onClick={() => handleTugallash(s)}>
                      Ha, tugallash
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </Card>
        )
      })}

      {/* Window 2 — Tugallangan: finalized serials (always via Tugallash). ⋯
          expand reuses the Window 1 pallet-list pattern; badge is Ortiqcha
          (non-blocking overage, wins) or the locked loss %. */}
      <div>
        <SectionHeading>2 · Tugallangan</SectionHeading>
        <div className="mt-2 space-y-2">
          {completed.length === 0 && <p className="text-sm text-slate-400">Tugallangan serial yo'q.</p>}
          {completed.map((c: CompletedSerial) => (
            <Card key={c.serial} padding="compact">
              <button
                type="button"
                onClick={() => setExpandedCompleted(expandedCompleted === c.serial ? null : c.serial)}
                className="flex w-full items-center gap-2 text-left"
              >
                <SerialChip>{c.serial}</SerialChip>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                  {ownerName(c.owner_id)} · {typeName(c.type_id)}
                </span>
                <span className="shrink-0 text-slate-500 dark:text-slate-400">⋯</span>
              </button>
              <div className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">
                Yuborilgan {c.sent.toLocaleString()} → tayyor {c.received.toLocaleString()} kg ·{' '}
                {lossBadge(c.lossPct, c.excess)}
              </div>
              {expandedCompleted === c.serial && palletList(c.serial, c.type_id, c.owner_id, c.pallets)}
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
