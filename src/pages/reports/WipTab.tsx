import { useState } from 'react'
import { useOwners } from '../../lib/useOwners'
import { useProductTypes } from '../../lib/useProductTypes'
import { useCalibres } from '../../lib/useCalibres'
import { useWipRows } from '../../lib/useWipRows'
import { WipTable } from './WipTable'
import { SerialPassportModal } from './SerialPassportModal'

// §3.2.9 Kutilayotgan ishlar (WIP/stuck) — an exceptions list, no filter bar
// (§2.14 thresholds are configured in Administration, not here). Mounted at
// /menejer/kutilmoqda and /rahbar/kutilmoqda, same read-only-for-Rahbar
// shape as every other §3.2 saved view.
export function WipTab() {
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [passportSerial, setPassportSerial] = useState<string | null>(null)

  // §3.3: includeInactive=true -- resolves ids on in-flight/historical rows.
  const { owners } = useOwners(true)
  const { productTypes } = useProductTypes(true)
  const { calibres } = useCalibres(true)
  const { rows, loading } = useWipRows()

  function ownerName(id: string) {
    return owners.find((o) => o.id === id)?.name ?? id
  }
  function typeName(id: string | null) {
    if (!id) return '—'
    return productTypes.find((t) => t.id === id)?.name ?? id
  }
  function typeNameStrict(id: string) {
    return typeName(id)
  }
  function calibreLabel(id: string) {
    return calibres.find((c) => c.id === id)?.label ?? id
  }

  return (
    <div className="space-y-4">
      {loading ? (
        <p className="text-sm text-slate-400">Yuklanmoqda…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400">Kutilayotgan ish yo'q.</p>
      ) : (
        <>
          <WipTable
            rows={rows}
            expandedKey={expandedKey}
            onToggle={(key) => setExpandedKey(expandedKey === key ? null : key)}
            ownerName={ownerName}
            typeName={typeName}
            onOpenPassport={setPassportSerial}
          />
          <p className="text-xs text-slate-400">{rows.length} ta band</p>
        </>
      )}

      {passportSerial && (
        <SerialPassportModal
          serial={passportSerial}
          onClose={() => setPassportSerial(null)}
          typeName={typeNameStrict}
          calibreLabel={calibreLabel}
        />
      )}
    </div>
  )
}
