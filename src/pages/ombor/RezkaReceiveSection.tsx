import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { run, callRpc } from '../../lib/rpc'
import { invalidateReportData } from '../../lib/queryClient'
import { useAuth } from '../../lib/AuthProvider'
import { useProductTypes } from '../../lib/useProductTypes'
import { useOwners } from '../../lib/useOwners'
import { useCalibres } from '../../lib/useCalibres'
import { useRezkaOutput, type RezkaOutputSerial } from '../../lib/useRezkaOutput'
import { sortByDateDesc } from '../../lib/sortByDate'
import { formatDateTime } from '../../lib/formatDate'
import { computeRezkaLossDisplay, formatLossKg } from '../../lib/formatLoss'
import { todayInTashkent } from '../../lib/dateRange'
import { RezkaReceiveForm } from './RezkaReceiveForm'
import type { ReceiptValues } from './FinishedReceiptForm'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { SerialChip } from '../../components/ui/SerialChip'
import { PartiyaBadge } from '../../components/ui/PartiyaBadge'
import { RezkaBadge } from '../../components/ui/RezkaBadge'
import { StatusNote } from '../../components/ui/StatusNote'

// §5.R Ombor section 3 under the Rezka pill (Rezka Prompt 2) -- the Rezka
// twin of MoykaReceiveSection, separate component:
// - Window 1: one tile -> RezkaReceiveForm over useRezkaOutput().inRezka
//   (the same set section 2's Window 2 shows -- section mirroring). No lab
//   gate, Standard calibre only, no printing.
// - Window 2: every serial with output or a closed cycle. Yakunlash
//   (close_rezka_cycle_serial) is offered whenever the cycle is open, at any
//   residual -- positive (loss), zero, or negative (gain, "Ortiqcha").
export function RezkaReceiveSection() {
  const { profile } = useAuth()
  const { productTypes } = useProductTypes(true)
  const { owners } = useOwners(true)
  const { calibres } = useCalibres(true)
  const activeCalibres = calibres.filter((c) => c.active)
  const { inRezka, received, loading, refresh } = useRezkaOutput()
  const [tileOpen, setTileOpen] = useState(false)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [confirmingClose, setConfirmingClose] = useState<string | null>(null)
  const [closeError, setCloseError] = useState<string | null>(null)

  function typeName(id: string) {
    return productTypes.find((t) => t.id === id)?.name ?? id
  }
  function ownerName(id: string) {
    return owners.find((o) => o.id === id)?.name ?? id
  }
  function calibreLabel(id: string) {
    return calibres.find((c) => c.id === id)?.label ?? id
  }

  // One pallet per save, then the exact-settlement auto-close (no-op unless
  // received now equals sent exactly -- 0141).
  async function handleReceipt(serial: RezkaOutputSerial, values: ReceiptValues) {
    await run(
      supabase.from('finished_pallets').insert({
        barcode2: values.barcode2,
        serial: serial.serial,
        type_id: serial.type_id,
        calibre_id: values.calibreId,
        weight_kg: values.weightKg,
        received_date: todayInTashkent(),
        created_by: profile?.id,
      }),
    )
    await callRpc('close_rezka_cycle_if_settled', { p_serial: serial.serial })
    refresh()
    invalidateReportData()
  }

  async function handleYakunlash(serial: string) {
    setCloseError(null)
    try {
      await callRpc('close_rezka_cycle_serial', { p_serial: serial })
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : 'Yakunlashda xatolik yuz berdi.')
      return
    }
    setConfirmingClose(null)
    refresh()
    invalidateReportData()
  }

  if (loading) return null

  const tileButtonClass =
    'border border-dashed !border-amber-400 !text-amber-800 hover:bg-amber-50 dark:!border-amber-700 dark:!text-amber-400 dark:hover:bg-amber-950/30'

  // Signed wording for the close confirmation: loss bare, gain as Ortiqcha.
  function closeMessage(residualKg: number) {
    const kg = Math.round(Math.abs(residualKg)).toLocaleString()
    if (residualKg > 0) return `Bu seriya uchun ${kg} kg yo'qotish sifatida qayd etiladi. Davom etasizmi?`
    if (residualKg < 0) return `Bu seriya uchun Ortiqcha +${kg} kg qayd etiladi. Davom etasizmi?`
    return 'Bu seriya 0 kg farq bilan yakunlanadi. Davom etasizmi?'
  }

  return (
    <div className="space-y-4">
      <SectionHeading>Rezkadan qabul qilish</SectionHeading>
      <div className="mt-2">
        {tileOpen ? (
          <RezkaReceiveForm
            serials={inRezka}
            typeName={typeName}
            ownerName={ownerName}
            calibreLabel={calibreLabel}
            calibres={activeCalibres}
            onCancel={() => setTileOpen(false)}
            onSubmit={handleReceipt}
          />
        ) : (
          <Button variant="ghost" size="md" fullWidth onClick={() => setTileOpen(true)} className={tileButtonClass}>
            + Rezkadan qabul qilish
          </Button>
        )}
      </div>

      <div>
        <SectionHeading>2 · Qabul qilingan seriyalar</SectionHeading>
        <div className="mt-2 space-y-2">
          {received.length === 0 && <p className="text-sm text-slate-400">Hali qabul qilingan seriya yo'q.</p>}
          {received.map((s) => {
            const rowKey = `${s.serial}-${s.cycleNo}`
            const expanded = expandedRow === rowKey
            const sortedPallets = sortByDateDesc(s.pallets, (p) => p.created_at)
            const loss = computeRezkaLossDisplay(s.sent, s.received, s.closedAt)
            const residualKg = s.sent - s.received
            const canYakunlash = s.closedAt === null
            const confirming = confirmingClose === rowKey
            return (
              <Card key={rowKey} padding="compact">
                <button
                  type="button"
                  onClick={() => setExpandedRow(expanded ? null : rowKey)}
                  className="flex w-full items-center gap-2 text-left"
                >
                  <SerialChip>{s.serial}</SerialChip>
                  <PartiyaBadge partiyaNo={s.partiyaNo} typeName={typeName(s.type_id)} />
                  <RezkaBadge provenance={s.provenance} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                    {ownerName(s.owner_id)} · {typeName(s.type_id)}
                  </span>
                  <span className="shrink-0 text-right text-sm text-slate-500 dark:text-slate-400">
                    <span className="block">
                      {loss.isRealized ? (
                        <>
                          {loss.yoqotishKg !== null && loss.yoqotishKg < 0 ? 'Ortiqcha' : "Yo'qotish"}{' '}
                          {formatLossKg(loss.yoqotishKg ?? 0)}
                        </>
                      ) : (
                        <>Rezkada {Math.round(loss.rezkadaKg).toLocaleString()} kg</>
                      )}
                    </span>
                    <span className="block">{s.pallets.length} ta pallet</span>
                  </span>
                  <span className="shrink-0 text-slate-400">{expanded ? '▲' : '▼'}</span>
                </button>

                {canYakunlash && !confirming && (
                  <button
                    type="button"
                    onClick={() => {
                      setCloseError(null)
                      setConfirmingClose(rowKey)
                    }}
                    className="mt-2 rounded-md border border-amber-300 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/30"
                  >
                    Yakunlash
                  </button>
                )}
                {confirming && (
                  <div className="mt-2 space-y-2 rounded-md border border-amber-300 bg-amber-50 p-2 dark:border-amber-700 dark:bg-amber-950/30">
                    <p className="text-sm text-slate-700 dark:text-slate-300">{closeMessage(residualKg)}</p>
                    {closeError && <StatusNote tone="problem">{closeError}</StatusNote>}
                    <div className="flex gap-2">
                      <Button variant="primary" size="md" onClick={() => handleYakunlash(s.serial)}>
                        Yakunlash
                      </Button>
                      <Button variant="ghost" size="md" onClick={() => setConfirmingClose(null)}>
                        Bekor qilish
                      </Button>
                    </div>
                  </div>
                )}

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
