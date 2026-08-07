import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useOwners } from '../../lib/useOwners'
import { useProductTypes } from '../../lib/useProductTypes'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { StatusPill } from '../../components/ui/StatusPill'
import { StatusNote } from '../../components/ui/StatusNote'
import { formatDate } from '../../lib/formatDate'

type CloseoutKind = 'old_washed' | 'old_kn' | 'old_raw'

const KIND_LABEL: Record<CloseoutKind, string> = {
  old_washed: 'Eski zaxira (yuvilgan)',
  old_kn: 'Eski zaxira (KN)',
  old_raw: 'Eski zaxira (xom)',
}

interface CloseoutLine {
  kind: CloseoutKind
  owner_id: string
  type_id: string
  opening_kg: number
  collected_kg: number
  remaining_kg: number
  closed_at: string | null
  closed_book_remaining_kg: number | null
}

// §"Old-stock reconciliation" (2026-08-05, see DECISIONS.md) — Menejer's
// "Eski zaxira hisob-kitobi": opening stock was seeded with approximate
// weights and has lost mass to dehydration over a year, so a fully
// collected type still shows a remaining book balance that physically
// doesn't exist. Yakunlash confirms the type is physically finished and
// books the remaining book balance as storage loss — kept isolated from
// processing loss (yield_rows, loss %, Rahbar dashboard never read the
// closeout ledger).
//
// One line per (kind, owner, type) from old_stock_closeout_lines, which
// shows every line whether open or closed -- a closed line renders as a
// badge instead of vanishing, so the screen doubles as a record of what's
// already been closed.
export function OldStockCloseoutTab() {
  const { owners } = useOwners(true)
  const { productTypes } = useProductTypes(true)
  const [lines, setLines] = useState<CloseoutLine[]>([])
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await supabase
        .from('old_stock_closeout_lines')
        .select('kind, owner_id, type_id, opening_kg, collected_kg, remaining_kg, closed_at, closed_book_remaining_kg')
      setLines(
        (data ?? []).map((r) => ({
          ...r,
          // FILTER aggregates with no matching rows return NULL, not 0.
          collected_kg: r.collected_kg ?? 0,
          remaining_kg: r.remaining_kg ?? 0,
        })) as CloseoutLine[],
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  function ownerName(id: string) {
    return owners.find((o) => o.id === id)?.name ?? id
  }
  function typeName(id: string) {
    return productTypes.find((t) => t.id === id)?.name ?? id
  }
  function lineKey(l: CloseoutLine) {
    return `${l.kind}:${l.owner_id}:${l.type_id}`
  }

  async function handleCloseOut(l: CloseoutLine) {
    setError(null)
    setSubmitting(true)
    try {
      const { error: rpcErr } = await supabase.rpc('close_out_old_stock', {
        p_kind: l.kind,
        p_owner_id: l.owner_id,
        p_type_id: l.type_id,
      })
      if (rpcErr) throw rpcErr
      setConfirming(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Yakunlashda xatolik yuz berdi.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return null

  const sorted = [...lines].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind)
    const ownerCmp = ownerName(a.owner_id).localeCompare(ownerName(b.owner_id))
    if (ownerCmp !== 0) return ownerCmp
    return typeName(a.type_id).localeCompare(typeName(b.type_id))
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">Eski zaxira hisob-kitobi</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Har bir eski zaxira qatorini yakunlash — qolgan kitob qoldig'i saqlash yo'qotishi sifatida yoziladi. Bu ishlov
          yo'qotishidan alohida — hosildorlik va yuvish yo'qotish foizlariga ta'sir qilmaydi.
        </p>
      </div>

      {error && <StatusNote tone="problem">{error}</StatusNote>}

      {sorted.length === 0 ? (
        <p className="text-sm text-slate-400">Eski zaxira qatorlari yo'q.</p>
      ) : (
        sorted.map((l) => {
          const key = lineKey(l)
          const isConfirming = confirming === key
          const isClosed = l.closed_at !== null
          const canClose = !isClosed && l.remaining_kg > 0.01

          return (
            <Card key={key}>
              <div className="flex items-center gap-2">
                <StatusPill tone="neutral">{KIND_LABEL[l.kind]}</StatusPill>
                <span className="min-w-0 flex-1 truncate font-semibold text-slate-900 dark:text-slate-100">
                  {ownerName(l.owner_id)} · {typeName(l.type_id)}
                </span>
              </div>

              <div className="mt-2 space-y-1 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Boshlang'ich (kitob)</span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">{l.opening_kg.toLocaleString()} kg</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Yig'ib olingan</span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">{l.collected_kg.toLocaleString()} kg</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Qoldiq (kitob)</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">{l.remaining_kg.toLocaleString()} kg</span>
                </div>
              </div>

              {isClosed ? (
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  Yakunlangan · {formatDate(l.closed_at as string)} ·{' '}
                  {(l.closed_book_remaining_kg ?? 0).toLocaleString()} kg saqlash yo'qotishi sifatida yozildi
                </p>
              ) : canClose ? (
                <div className="mt-3">
                  <Button variant="secondary" size="md" onClick={() => setConfirming(key)}>
                    Yakunlash
                  </Button>
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-400">Qoldiq yo'q — yakunlash shart emas.</p>
              )}

              {isConfirming && (
                <div className="mt-3 space-y-3 border-t border-slate-200 pt-3 dark:border-slate-700">
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
                    <p className="text-sm font-medium text-amber-900 dark:text-amber-200">Yakunlashni tasdiqlang</p>
                    <div className="mt-2 space-y-1 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600 dark:text-slate-400">Qoldiq (saqlash yo'qotishi sifatida yoziladi)</span>
                        <span className="font-medium text-slate-900 dark:text-slate-100">{l.remaining_kg.toLocaleString()} kg</span>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">
                      Bu turdagi eski zaxira jismonan tugagan deb tasdiqlaysiz. Qolgan qoldiq saqlash yo'qotishi sifatida
                      yoziladi va bu turdagi barcha qolgan zaxira omborda, hisobotlarda va yig'ish ekranlarida ko'rinmay
                      qoladi. Bekor qilib bo'lmaydi.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Button variant="ghost" size="md" onClick={() => setConfirming(null)} disabled={submitting}>
                        Bekor
                      </Button>
                      <Button variant="primary" size="md" onClick={() => handleCloseOut(l)} disabled={submitting}>
                        {submitting ? '…' : 'Ha, yakunlash'}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </Card>
          )
        })
      )}
    </div>
  )
}
