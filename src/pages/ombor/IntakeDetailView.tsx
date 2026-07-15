import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { IntakeLine, IntakeRecord } from '../../lib/useIntakeLines'
import { Barcode1Display } from './Barcode1Display'

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
      <div>
        <div className="font-medium text-slate-700 dark:text-slate-300">Menejer</div>
        <div className="text-slate-500 dark:text-slate-400">
          {typeName} · {line.declared_qty.toLocaleString()} kg (kutilgan) · {ownerName} · {line.plate} ·{' '}
          {line.driver} · {line.order_date}
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
          Aniq: {line.intake.actual_qty.toLocaleString()} kg
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
            <Barcode1Display code={line.intake.barcode1} />
          </div>
        )}
      </div>
    </div>
  )
}
