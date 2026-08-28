import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthProvider'
import { useProductTypes } from '../../lib/useProductTypes'
import { useOwners } from '../../lib/useOwners'
import { useCalibres } from '../../lib/useCalibres'
import { useMoykaOutput, type OutputSerial, type FinishedPallet } from '../../lib/useMoykaOutput'
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
// floored at 0, with non-blocking Ortiqcha on overage).
//
// Tugallash and Window 2 (Tugallangan) are removed (DECISIONS.md "Moyka
// loss becomes live; remove Tugallash") — no user action ever closes a
// serial any more. Membership is now purely the live balance (isInMoyka,
// stageMembership.ts): a serial appears here as long as sent > received,
// and drops off on its own once packing catches up, with no separate
// finalized list to graduate into. Historical loss now lives in reports
// (Yield/Hisobot) and the serial passport — not this screen.
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
  const { serials, loading, refresh } = useMoykaOutput()
  const [activeForm, setActiveForm] = useState<string | null>(null)
  const [lastBarcode, setLastBarcode] = useState<Record<string, string>>({})
  // §5.3 "Ombor printing gaps": reprint access for an already-received
  // pallet independent of `lastBarcode` (which only covers this session's
  // own just-saved pallet, cleared on a fresh mount) — toggle-one-at-a-time.
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

  // §5.3: one pallet per save → one finished_pallets row + its Barcode #2.
  // The form always closes on submit (no auto-reopen — see DECISIONS "Tayyor
  // Mahsulot completion"); a new entry needs an explicit button click. A
  // serial simply drops off this window on its own once its live balance
  // reaches 0 — there is no separate close/lock action any more.
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

  if (loading) return null

  return (
    <div className="space-y-4">
      <SectionHeading>1 · Moykada — chiqishi kutilmoqda</SectionHeading>
      {serials.length === 0 && <p className="text-sm text-slate-400">Kutilayotgan serial yo'q.</p>}

      {serials.map((s) => {
        const lastB = lastBarcode[s.serial]
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
                this in-progress serial, reprintable at any time. */}
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

            <div className="mt-3">
              {s.labStatus === 'passed' ? (
                <Button variant="primary" size="lg" className="w-full" onClick={() => setActiveForm(s.serial)}>
                  {s.pallets.length === 0 ? '+ Qabul qilish' : "+ Yana qo'shish"}
                </Button>
              ) : (
                // Hard availability gate (SPEC.md §5.5.3). Without a passing
                // verdict, "received" can only ever be 0.
                <StatusNote tone={s.labStatus === 'failed' ? 'problem' : 'pending'}>
                  {s.labStatus === 'failed'
                    ? "Rad etildi — qayta tekshirilmoqda. Qabul qilish uchun o'tdi natijasi kerak."
                    : "Tahlil kutilmoqda — qabul qilish uchun Laborator tekshiruvi (o'tdi natijasi) kerak."}
                </StatusNote>
              )}
            </div>

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
          </Card>
        )
      })}
    </div>
  )
}
