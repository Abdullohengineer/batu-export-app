import { useMemo, useState } from 'react'
import { useOwners } from '../../lib/useOwners'
import { useProductTypes } from '../../lib/useProductTypes'
import { useCalibres } from '../../lib/useCalibres'
import { useStockOnHand } from '../../lib/useStockOnHand'
import { stockBucketSortIndex } from '../../lib/stockOnHand'
import { StockOnHandHeader } from './StockOnHandHeader'
import { StockOnHandTable } from './StockOnHandTable'
import { SerialPassportModal } from './SerialPassportModal'

// §3.2.6 Ombor qoldig'i (stock on hand) — a snapshot of NOW, not a date-
// ranged history: no filter bar, no direction, no date range (see the
// section's own note on why). Mounted at /menejer/qoldiq and /rahbar/qoldiq,
// identical component, same read-only-for-Rahbar shape as §3.2's own screen.
export function StockOnHandTab() {
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [passportSerial, setPassportSerial] = useState<string | null>(null)

  const { owners } = useOwners()
  const { productTypes } = useProductTypes()
  const { calibres } = useCalibres()
  const { rows, summary, turnaroundAvgDays, loading } = useStockOnHand()

  function ownerName(id: string) {
    return owners.find((o) => o.id === id)?.name ?? id
  }
  function typeName(id: string) {
    return productTypes.find((t) => t.id === id)?.name ?? id
  }
  function calibreLabel(id: string) {
    return calibres.find((c) => c.id === id)?.label ?? id
  }

  // Sorted by resolved NAME, not raw id — grouping buyurtmachi -> tur ->
  // kalibr -> holat only reads as "grouped" to a human if the owner/type
  // groups themselves land in a readable order, not raw-uuid order (a real
  // bug caught during visual verification: uuid comparison put "Toshkent"
  // before "Boysun"/"Samarqand" for no readable reason).
  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const ownerDiff = ownerName(a.ownerId).localeCompare(ownerName(b.ownerId))
      if (ownerDiff !== 0) return ownerDiff
      const typeDiff = typeName(a.typeId).localeCompare(typeName(b.typeId))
      if (typeDiff !== 0) return typeDiff
      const calA = a.calibreId ? calibreLabel(a.calibreId) : ''
      const calB = b.calibreId ? calibreLabel(b.calibreId) : ''
      const calDiff = calA.localeCompare(calB)
      if (calDiff !== 0) return calDiff
      return stockBucketSortIndex(a.bucket) - stockBucketSortIndex(b.bucket)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, owners, productTypes, calibres])

  return (
    <div className="space-y-4">
      <StockOnHandHeader summary={summary} turnaroundAvgDays={turnaroundAvgDays} />

      {loading ? (
        <p className="text-sm text-slate-400">Yuklanmoqda…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400">Omborda hech narsa yo'q.</p>
      ) : (
        <>
          <StockOnHandTable
            rows={sortedRows}
            expandedKey={expandedKey}
            onToggle={(key) => setExpandedKey(expandedKey === key ? null : key)}
            ownerName={ownerName}
            typeName={typeName}
            calibreLabel={calibreLabel}
            onOpenPassport={setPassportSerial}
          />
          <p className="text-xs text-slate-400">{rows.length} ta partiya</p>
        </>
      )}

      {passportSerial && (
        <SerialPassportModal
          serial={passportSerial}
          onClose={() => setPassportSerial(null)}
          typeName={typeName}
          calibreLabel={calibreLabel}
        />
      )}
    </div>
  )
}
