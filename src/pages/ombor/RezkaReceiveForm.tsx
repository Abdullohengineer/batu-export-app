import { useState } from 'react'
import type { Calibre } from '../../lib/useCalibres'
import type { RezkaOutputSerial } from '../../lib/useRezkaOutput'
import { FinishedReceiptForm, type ReceiptValues } from './FinishedReceiptForm'
import { Card } from '../../components/ui/Card'
import { PartiyaBadge } from '../../components/ui/PartiyaBadge'
import { RezkaBadge } from '../../components/ui/RezkaBadge'
import { todayInTashkent } from '../../lib/dateRange'

// §5.R section 3 receive picker under the Rezka pill -- the Rezka twin of
// ReceiveFromMoykaForm, separate component. Differences, all deliberate:
// - no lab gate: every in-Rezka serial is a chip (Rezka has no lab);
// - FinishedReceiptForm gets `rezka`, so only the Standard calibre is offered;
// - nothing prints: the saved barcode2 id is shown as text, no
//   Barcode2Display (Prompt 2: no printing on the Rezka path);
// - over-receive is allowed (a gain is normal), so a chip stays until the
//   cycle is closed, not until received catches up with sent.
export function RezkaReceiveForm({
  serials,
  typeName,
  ownerName,
  calibreLabel,
  calibres,
  onCancel,
  onSubmit,
}: {
  serials: RezkaOutputSerial[]
  typeName: (id: string) => string
  ownerName: (id: string) => string
  calibreLabel: (id: string) => string
  calibres: Calibre[]
  onCancel: () => void
  onSubmit: (serial: RezkaOutputSerial, values: ReceiptValues) => Promise<void>
}) {
  const [selected, setSelected] = useState<RezkaOutputSerial | null>(null)
  const [lastReceipt, setLastReceipt] = useState<ReceiptValues | null>(null)

  function selectSerial(s: RezkaOutputSerial) {
    setSelected(s)
    setLastReceipt(null)
  }

  // Stays in the form after a save; patched locally (same reason as
  // ReceiveFromMoykaForm) so the running total and barcode sequence stay
  // right even if this save auto-closes the cycle and drops it from `serials`.
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
                received_date: todayInTashkent(),
                created_at: new Date().toISOString(),
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

  return (
    <Card tone="pending">
      <span className="text-sm font-semibold text-amber-800 dark:text-amber-400">Rezkadan qabul qilish</span>

      {!selected ? (
        serials.length === 0 ? (
          <p className="mt-2 text-xs text-slate-400">Qabul qilinadigan serial yo'q.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {serials.map((s) => (
              <button
                key={`${s.serial}-${s.cycleNo}`}
                type="button"
                onClick={() => selectSerial(s)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <span className="font-mono">{s.serial}</span>
                <PartiyaBadge partiyaNo={s.partiyaNo} typeName={typeName(s.type_id)} />
                <span className="ml-1.5">~{Math.round(s.sent - s.received).toLocaleString()} kg</span>
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
            rezka
            headerBadge={<RezkaBadge provenance={selected.provenance} />}
            onCancel={onCancel}
            onSubmit={handleSubmit}
          />
          {lastReceipt && (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">
              Saqlandi: <span className="font-mono">{lastReceipt.barcode2}</span> · {calibreLabel(lastReceipt.calibreId)} ·{' '}
              {lastReceipt.weightKg.toLocaleString()} kg
            </p>
          )}
        </div>
      )}
    </Card>
  )
}
