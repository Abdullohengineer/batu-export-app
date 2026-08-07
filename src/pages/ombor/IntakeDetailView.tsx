import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { IntakeLine, IntakeRecord } from '../../lib/useIntakeLines'
import { Barcode1Display } from './Barcode1Display'
import { Stat } from '../../components/ui/Stat'
import { formatDate } from '../../lib/formatDate'

// §5.1 item 5: the on-demand full story for one serial — manager's
// declared figures, the gate's weights (or "kutilmoqda" if stage 2 hasn't
// happened yet — never an error), and what storage entered.
export function IntakeDetailView({
  line,
  ownerName,
  typeName,
}: {
  line: IntakeLine & { intake: IntakeRecord }
  ownerName: string
  typeName: string
}) {
  const [pileUrl, setPileUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!line.intake.pile_photo) return
    supabase.storage
      .from('intake-photos')
      .createSignedUrl(line.intake.pile_photo, 3600)
      .then(({ data }) => setPileUrl(data?.signedUrl ?? null))
  }, [line.intake.pile_photo])

  const gateStage2Done = line.gate_completed_at !== null

  return (
    <div className="space-y-3 border-t border-slate-200 px-3 py-3 text-sm dark:border-slate-700">
      {/* Ombor card-polish pass: Aniq + arrival date moved to the top and made
          prominent -- the two figures the operator looks for first when
          opening this detail, previously buried inline in the Ombor/Menejer
          paragraphs below. `Stat` with tone="info" (this app's existing
          "informational highlight" token, not a status/warning color) gives
          both their own tinted panel, same component/tone already used for
          every other "big glanceable figure" in the app -- not a one-off
          background invented for this screen. */}
      <div className="grid grid-cols-2 gap-2">
        <Stat value={`${line.intake.actual_qty.toLocaleString()} kg`} label="Aniq" tone="info" valueSize="compact" />
        <Stat value={formatDate(line.order_date)} label="Sana" tone="info" valueSize="compact" />
      </div>

      <div>
        <div className="font-medium text-slate-700 dark:text-slate-300">Menejer</div>
        <div className="text-slate-500 dark:text-slate-400">
          {typeName} · {line.declared_qty.toLocaleString()} kg (kutilgan) · {ownerName} · {line.plate} · {line.driver}
        </div>
      </div>

      <div>
        <div className="font-medium text-slate-700 dark:text-slate-300">Darvoza</div>
        <div className="text-slate-500 dark:text-slate-400">
          Yuk bilan: {line.gruzheny_kg !== null ? `${line.gruzheny_kg.toLocaleString()} kg` : 'kutilmoqda'} · Bo'sh:{' '}
          {gateStage2Done && line.pustoy_kg !== null ? `${line.pustoy_kg.toLocaleString()} kg` : 'kutilmoqda'} · Net:{' '}
          {gateStage2Done && line.net_kg !== null ? `${line.net_kg.toLocaleString()} kg` : 'kutilmoqda'}
        </div>
      </div>

      <div>
        <div className="font-medium text-slate-700 dark:text-slate-300">Ombor</div>
        <div className="text-slate-500 dark:text-slate-400">
          Quti massasi: {line.intake.box_mass_kg.toLocaleString()} kg
          {line.intake.komment ? ` · ${line.intake.komment}` : ''}
        </div>
        {pileUrl && (
          <img
            src={pileUrl}
            alt="Uyum rasmi"
            className="mt-2 max-w-xs rounded-md border border-slate-200 dark:border-slate-700"
          />
        )}
        {line.intake.barcode1 && (
          <div className="mt-2">
            <Barcode1Display
              data={{
                serial: line.intake.barcode1,
                type: typeName,
                owner: ownerName,
                weightKg: line.intake.actual_qty,
                date: line.order_date,
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
