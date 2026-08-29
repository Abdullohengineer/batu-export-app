import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthProvider'
import { useProductTypes } from '../../lib/useProductTypes'
import { useOwners } from '../../lib/useOwners'
import { useCalibres } from '../../lib/useCalibres'
import { useMoykaOutput, type OutputSerial } from '../../lib/useMoykaOutput'
import { sortByDateDesc } from '../../lib/sortByDate'
import { formatDateTime } from '../../lib/formatDate'
import { ReceiveFromMoykaForm } from './ReceiveFromMoykaForm'
import type { ReceiptValues } from './FinishedReceiptForm'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { SerialChip } from '../../components/ui/SerialChip'
import { PartiyaBadge } from '../../components/ui/PartiyaBadge'

// §5.3 Tayyor Mahsulot: single-tile receive picker (2026-08-28 — see
// DECISIONS.md "Section 3 single-tile receive picker"). Replaces the old
// per-serial card list: one dashed tile, "+ Moykadan qabul qilish", opens a
// chip picker (ReceiveFromMoykaForm) over every in-Moyka, lab-passed serial.
// No old/new-stock split, unlike section 2 — a serial's origin (delivery vs
// minted from old stock) is metadata FinishedReceiptForm already reads
// internally (isMinted), never a workflow choice Ombor makes here.
//
// Tugallash and the old Tugallangan Window 2 are removed (DECISIONS.md
// "Moyka loss becomes live; remove Tugallash") — no user action ever
// closes a serial any more. The receive-picker tile's own membership is
// purely the live balance (isInMoyka, stageMembership.ts, via
// useMoykaOutput): a serial appears there as long as sent > received, and
// drops off on its own once packing catches up. Historical loss now lives
// in reports (Yield/Hisobot) and the serial passport — not this screen.
//
// Window 2 restored (2026-08-29, Prompt 9, see DECISIONS.md "Restore Ombor
// Tayyor Window 2...") — a DIFFERENT thing from the removed Tugallangan
// window above: read-only, persistent, membership is `received > 0`
// (regardless of live balance), not a manual close event. The single-tile
// redesign had collapsed this per-serial output history into the intake
// sub-form's own "Shu seriyaga qabul qilingan" panel, which only shows the
// serial currently being received — there was no way to browse everything
// ever received without opening each serial one at a time via the picker.
// Sourced from the same useMoykaOutput() call already made for the tile
// above (its new `receivedSerials` view) — no new hook, no new read.
//
// Laborator v2 (2026-07-28 — see DECISIONS.md "Lab moves inside Moyka,
// wash-cycle concept removed"): the hard gate is at packing — Barcode #2
// assignment (handleReceipt) is blocked until the serial's CURRENT lab
// verdict is a pass (labStatus, from useMoykaOutput.ts via labVerdict.ts's
// currentLabStatus). This is a UI convenience only; the real enforcement is
// a Postgres RLS policy on finished_pallets' INSERT (0035_lab_relocation_
// core.sql) that refuses the write outright. An untested/rejected serial
// doesn't appear as a receivable chip at all (not shown-but-blocked).
export function OmborTayyorTab() {
  const { profile } = useAuth()
  // §3.3: includeInactive=true -- typeName/ownerName/calibreLabel resolve
  // historical rows. The NEW-pallet creation dropdown (FinishedReceiptForm)
  // gets a derived active-only subset instead of this full list.
  const { productTypes } = useProductTypes(true)
  const { owners } = useOwners(true)
  const { calibres } = useCalibres(true)
  const activeCalibres = calibres.filter((c) => c.active)
  const { serials, receivedSerials, loading, refresh } = useMoykaOutput()
  const [tileOpen, setTileOpen] = useState(false)
  const [expandedSerial, setExpandedSerial] = useState<string | null>(null)

  function typeName(id: string) {
    return productTypes.find((t) => t.id === id)?.name ?? id
  }
  function ownerName(id: string) {
    return owners.find((o) => o.id === id)?.name ?? id
  }
  function calibreLabel(id: string) {
    return calibres.find((c) => c.id === id)?.label ?? id
  }

  // §5.3: one pallet per save → one finished_pallets row + its Barcode #2.
  // Unchanged by the single-tile redesign — only the UI calling this
  // changed (ReceiveFromMoykaForm.tsx now owns keeping its own form open
  // across saves); this write logic stays byte-for-byte identical.
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

    refresh()
  }

  if (loading) return null

  // Same dashed-tile treatment as section 2's tiles (reused verbatim — see
  // OmborMoykaTab.tsx / DECISIONS.md "Two-tile Moyka send picker").
  const tileButtonClass =
    'border border-dashed !border-amber-400 !text-amber-800 hover:bg-amber-50 dark:!border-amber-700 dark:!text-amber-400 dark:hover:bg-amber-950/30'

  return (
    <div className="space-y-4">
      <SectionHeading>Moykadan qabul qilish</SectionHeading>
      <div className="mt-2">
        {tileOpen ? (
          <ReceiveFromMoykaForm
            serials={serials}
            typeName={typeName}
            ownerName={ownerName}
            calibreLabel={calibreLabel}
            calibres={activeCalibres}
            onCancel={() => setTileOpen(false)}
            onSubmit={(serial, values) => handleReceipt(serial, values)}
          />
        ) : (
          <Button variant="ghost" size="md" fullWidth onClick={() => setTileOpen(true)} className={tileButtonClass}>
            + Moykadan qabul qilish
          </Button>
        )}
      </div>

      <div>
        <SectionHeading>2 · Qabul qilingan seriyalar</SectionHeading>
        <div className="mt-2 space-y-2">
          {receivedSerials.length === 0 && <p className="text-sm text-slate-400">Hali qabul qilingan seriya yo'q.</p>}
          {receivedSerials.map((s) => {
            const expanded = expandedSerial === s.serial
            const sortedPallets = sortByDateDesc(s.pallets, (p) => p.created_at)
            return (
              <Card key={s.serial} padding="compact">
                <button
                  type="button"
                  onClick={() => setExpandedSerial(expanded ? null : s.serial)}
                  className="flex w-full items-center gap-2 text-left"
                >
                  <SerialChip>{s.serial}</SerialChip>
                  <PartiyaBadge partiyaNo={s.partiyaNo} typeName={typeName(s.type_id)} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                    {ownerName(s.owner_id)} · {typeName(s.type_id)}
                  </span>
                  <span className="shrink-0 text-sm text-slate-500 dark:text-slate-400">
                    {Math.round(s.received).toLocaleString()} kg · {s.pallets.length} ta pallet
                  </span>
                  <span className="shrink-0 text-slate-400">{expanded ? '▲' : '▼'}</span>
                </button>
                {expanded && (
                  <ul className="mt-2 space-y-1 border-t border-slate-200 pt-2 text-sm dark:border-slate-700">
                    {sortedPallets.map((p) => (
                      <li key={p.barcode2} className="text-slate-600 dark:text-slate-400">
                        <span className="font-mono">{p.barcode2}</span> · {calibreLabel(p.calibre_id)} ·{' '}
                        {p.weight_kg.toLocaleString()} kg · {formatDateTime(p.created_at)}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}
