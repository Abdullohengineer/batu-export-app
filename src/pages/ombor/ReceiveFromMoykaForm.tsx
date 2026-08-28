import { useState } from 'react'
import type { Calibre } from '../../lib/useCalibres'
import type { OutputSerial, FinishedPallet } from '../../lib/useMoykaOutput'
import { FinishedReceiptForm, type ReceiptValues } from './FinishedReceiptForm'
import { Barcode2Display } from './Barcode2Display'
import { Card } from '../../components/ui/Card'

// §5.3 single-tile receive picker (2026-08-28 — see DECISIONS.md "Section 3
// single-tile receive picker"). Chip-picks ONE in-Moyka serial (serial +
// live Qoladi kg only — same chip shape as section 2's NewStockToMoykaForm),
// then launches the existing FinishedReceiptForm AS-IS (no changes to it —
// see that file/DECISIONS.md for why none were needed). No old/new-stock
// split here, unlike section 2: origin (delivery/minted) is metadata
// FinishedReceiptForm already reads off the serial internally
// (`serial.isMinted`), never a workflow branch Ombor has to choose.
//
// Chips are scoped to `labStatus === 'passed'` — an untested/rejected
// serial does not appear here at all (not shown-but-blocked, per the task
// brief). `serials` is already pre-filtered to a positive live in-Moyka
// balance by useMoykaOutput itself (isInMoyka), so no further balance math
// is needed here.
export function ReceiveFromMoykaForm({
  serials,
  typeName,
  ownerName,
  calibreLabel,
  calibres,
  onCancel,
  onSubmit,
}: {
  serials: OutputSerial[]
  typeName: (id: string) => string
  ownerName: (id: string) => string
  calibreLabel: (id: string) => string
  calibres: Calibre[]
  onCancel: () => void
  onSubmit: (serial: OutputSerial, values: ReceiptValues) => Promise<void>
}) {
  const available = serials.filter((s) => s.labStatus === 'passed')
  const [selected, setSelected] = useState<OutputSerial | null>(null)
  const [lastReceipt, setLastReceipt] = useState<ReceiptValues | null>(null)
  const [expandedHistory, setExpandedHistory] = useState(false)

  function selectSerial(s: OutputSerial) {
    setSelected(s)
    setLastReceipt(null)
    setExpandedHistory(false)
  }

  // §5.3: the form stays open after a save (task requirement — receiving
  // several pallets for one serial back-to-back is the common case), so
  // "Shu paytgacha qabul"/barcode-sequence/history must all stay correct
  // for this same session even after this exact save drops the serial's
  // live in-Moyka balance to <= 0 and it falls out of the `serials` prop on
  // the next refresh() — patched locally here rather than re-derived from
  // that (isInMoyka-filtered) prop, which would otherwise make the form
  // vanish mid-session the instant the balance hits 0. Only "Yopish"
  // (closing the tile) re-derives the picker's own chip list from scratch.
  async function handleSubmit(values: ReceiptValues) {
    if (!selected) return
    await onSubmit(selected, values)
    setSelected((prev) =>
      prev
        ? {
            ...prev,
            received: prev.received + values.weightKg,
            pallets: [
              ...prev.pallets,
              {
                barcode2: values.barcode2,
                calibre_id: values.calibreId,
                weight_kg: values.weightKg,
                received_date: new Date().toISOString().slice(0, 10),
              },
            ],
            barcodeSeqByCalibre: {
              ...prev.barcodeSeqByCalibre,
              [values.calibreId]: (prev.barcodeSeqByCalibre[values.calibreId] ?? 0) + 1,
            },
          }
        : prev,
    )
    setLastReceipt(values)
  }

  // Same helper shape as the old per-row layout's own palletList() — barcode
  // + kalibr + kg + received_date, each reprintable via Barcode2Display.
  function palletList(pallets: FinishedPallet[]) {
    if (!selected) return null
    return (
      <ul className="mt-2 space-y-1">
        {pallets.map((p) => (
          <li key={p.barcode2} className="flex items-center justify-between gap-2">
            <span className="text-slate-600 dark:text-slate-400">
              <span className="font-mono">{p.barcode2}</span> · {calibreLabel(p.calibre_id)} · {p.weight_kg.toLocaleString()} kg ·{' '}
              {p.received_date}
            </span>
            <Barcode2Display
              data={{
                barcode2: p.barcode2,
                serial: selected.serial,
                type: typeName(selected.type_id),
                calibre: calibreLabel(p.calibre_id),
                weightKg: p.weight_kg,
                owner: ownerName(selected.owner_id),
              }}
            />
          </li>
        ))}
      </ul>
    )
  }

  return (
    <Card tone="pending">
      <span className="text-sm font-semibold text-amber-800 dark:text-amber-400">Moykadan qabul qilish</span>

      {!selected ? (
        available.length === 0 ? (
          <p className="mt-2 text-xs text-slate-400">Qabul qilinadigan serial yo'q.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {available.map((s) => (
              <button
                key={s.serial}
                type="button"
                onClick={() => selectSerial(s)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <span className="font-mono">{s.serial}</span>
                <span className="ml-1.5">~{Math.round(s.inProcess).toLocaleString()} kg</span>
              </button>
            ))}
          </div>
        )
      ) : (
        <div className="mt-2 space-y-2 border-t border-amber-200 pt-2 dark:border-amber-900">
          <FinishedReceiptForm
            serial={selected}
            typeName={typeName(selected.type_id)}
            ownerName={ownerName(selected.owner_id)}
            calibres={calibres}
            onCancel={onCancel}
            onSubmit={handleSubmit}
          />

          {lastReceipt && (
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Oxirgi Barcode #2:</div>
              <Barcode2Display
                defaultOpen
                data={{
                  barcode2: lastReceipt.barcode2,
                  serial: selected.serial,
                  type: typeName(selected.type_id),
                  calibre: calibreLabel(lastReceipt.calibreId),
                  weightKg: lastReceipt.weightKg,
                  owner: ownerName(selected.owner_id),
                }}
              />
            </div>
          )}

          {selected.pallets.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setExpandedHistory((v) => !v)}
                className="text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                Shu seriyaga qabul qilingan ({selected.pallets.length}) {expandedHistory ? '▲' : '▼'}
              </button>
              {expandedHistory && palletList(selected.pallets)}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
