import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { run, callRpc } from '../../lib/rpc'
import { invalidateReportData } from '../../lib/queryClient'
import { useAuth } from '../../lib/AuthProvider'
import { useProductTypes } from '../../lib/useProductTypes'
import { useOwners } from '../../lib/useOwners'
import { useRezkaSerials, type RezkaSerial } from '../../lib/useRezkaSerials'
import { useRezkaOutput, type RezkaOutputSerial } from '../../lib/useRezkaOutput'
import { useRezkaKnAvailability } from '../../lib/useRezkaKnAvailability'
import { computeRezkaLossDisplay } from '../../lib/formatLoss'
import { todayInTashkent } from '../../lib/dateRange'
import { TashqiToRezkaForm } from './TashqiToRezkaForm'
import { IchkiToRezkaForm } from './IchkiToRezkaForm'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { SerialChip } from '../../components/ui/SerialChip'
import { PartiyaBadge } from '../../components/ui/PartiyaBadge'
import { RezkaBadge } from '../../components/ui/RezkaBadge'

// §5.R Ombor section 2 under the Rezka pill (Rezka Prompt 2). Same two-window
// shape as MoykaSendSection, separate component (not a process flag):
// - Window 1 "Yuborishga tayyor": two dashed tiles, one open at a time.
//   Tashqaridan olish = a Tashqi (process='rezka' delivery) serial's raw
//   balance -> rezka_sends. Ichkaridan olish = Konditerka pallets ->
//   send_kn_to_rezka, which mints a fresh Rezka serial.
// - Window 2 "Rezkada" = section 3's Window 1 (section mirroring): the same
//   useRezkaOutput().inRezka set (isInRezka), read-only.
export function RezkaSendSection() {
  const { profile } = useAuth()
  // §3.3: includeInactive=true -- resolves names on in-flight serials.
  const { productTypes } = useProductTypes(true)
  const { owners } = useOwners(true)
  const { serials, loading, refresh } = useRezkaSerials()
  const { inRezka, loading: outputLoading, refresh: refreshOutput } = useRezkaOutput()
  const { rows: knRows, loading: knLoading, refresh: refreshKn } = useRezkaKnAvailability()
  const [expandedTile, setExpandedTile] = useState<'tashqi' | 'ichki' | null>(null)

  function typeName(id: string) {
    return productTypes.find((t) => t.id === id)?.name ?? id
  }
  function ownerName(id: string) {
    return owners.find((o) => o.id === id)?.name ?? id
  }

  // Tashqi: open (or reuse) the serial's Rezka cycle, then record the send.
  // Mirrors MoykaSendSection.handleSend (ensure_open_wash_cycle + insert);
  // over-send is allowed -- the kg entered is what was weighed out.
  async function handleTashqiSend(serial: RezkaSerial, qtyKg: number) {
    await callRpc('ensure_open_rezka_cycle', { p_serial: serial.serial })
    await run(
      supabase.from('rezka_sends').insert({
        serial: serial.serial,
        sent_date: todayInTashkent(),
        qty_kg: qtyKg,
        created_by: profile?.id,
      }),
    )
    refresh()
    refreshOutput()
    invalidateReportData()
  }

  // Ichki: one RPC does the whole draw (FIFO over rezka_kn_candidate_pallets,
  // mint, cycle, send) and returns the minted serial.
  async function handleIchkiSend(ownerId: string, typeId: string, kg: number): Promise<string> {
    const minted = await callRpc<string>('send_kn_to_rezka', { p_owner_id: ownerId, p_type_id: typeId, p_kg: kg })
    refreshKn()
    refreshOutput()
    invalidateReportData()
    return minted
  }

  if (loading || outputLoading || knLoading) return null

  const tileButtonClass =
    'border border-dashed !border-amber-400 !text-amber-800 hover:bg-amber-50 dark:!border-amber-700 dark:!text-amber-400 dark:hover:bg-amber-950/30'

  function rezkaRow(s: RezkaOutputSerial) {
    const loss = computeRezkaLossDisplay(s.sent, s.received, s.closedAt)
    return (
      <Card key={`${s.serial}-${s.cycleNo}`} padding="compact">
        <div className="flex items-center gap-2">
          <SerialChip>{s.serial}</SerialChip>
          <PartiyaBadge partiyaNo={s.partiyaNo} typeName={typeName(s.type_id)} />
          <RezkaBadge provenance={s.provenance} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 dark:text-slate-100">
            {ownerName(s.owner_id)} · {typeName(s.type_id)}
          </span>
        </div>
        <div className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">
          Yuborilgan {s.sent.toLocaleString()} kg · Qabul {s.received.toLocaleString()} kg · Rezkada{' '}
          {Math.round(loss.rezkadaKg).toLocaleString()} kg
        </div>
        {s.provenance === 'ichki' && s.parentDraws.length > 0 && (
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Manba:{' '}
            {s.parentDraws.map((d, i) => (
              <span key={d.barcode2}>
                {i > 0 && ', '}
                <span className="font-mono">{d.barcode2}</span> ({d.qtyKg.toLocaleString()} kg)
              </span>
            ))}
          </div>
        )}
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <SectionHeading>1 · Yuborishga tayyor</SectionHeading>
        <div className="mt-2 space-y-2">
          {expandedTile === 'tashqi' ? (
            <TashqiToRezkaForm
              serials={serials}
              typeName={typeName}
              ownerName={ownerName}
              onCancel={() => setExpandedTile(null)}
              onSubmit={handleTashqiSend}
            />
          ) : (
            <Button variant="ghost" size="md" fullWidth onClick={() => setExpandedTile('tashqi')} className={tileButtonClass}>
              + Tashqaridan olish
            </Button>
          )}

          {expandedTile === 'ichki' ? (
            <IchkiToRezkaForm
              rows={knRows}
              ownerName={ownerName}
              typeName={typeName}
              onCancel={() => setExpandedTile(null)}
              onSubmit={handleIchkiSend}
            />
          ) : (
            <Button variant="ghost" size="md" fullWidth onClick={() => setExpandedTile('ichki')} className={tileButtonClass}>
              + Ichkaridan olish
            </Button>
          )}
        </div>
      </div>

      <div>
        <SectionHeading>2 · Rezkada</SectionHeading>
        <div className="mt-2 space-y-2">
          {inRezka.length === 0 && <p className="text-sm text-slate-400">Rezkada jarayondagi serial yo'q.</p>}
          {inRezka.map((s) => rezkaRow(s))}
        </div>
      </div>
    </div>
  )
}
