import { useMemo } from 'react'
import { useMoykaSerials, type MoykaSerial } from './useMoykaSerials'

// Rezka Tashqi send candidates (SPEC.md §5.R, Rezka Prompt 2). NOT a second
// fetch and NOT a second balance: the same useMoykaSerials query (same React
// Query key, so it is shared and deduped with every Moyka consumer on the
// screen), narrowed to process='rezka'. `available` is the figure that hook
// already derives -- effective raw − Σ moyka_sends − Σ raw dispatched −
// Σ rezka_sends -- so a Rezka serial's balance is the same arithmetic as
// Moyka raw, never re-implemented here. Ichki (minted) serials never appear:
// they have no storage_intake row and are sent in full at mint.
export type RezkaSerial = MoykaSerial

export function useRezkaSerials() {
  const { serials, loading, refresh } = useMoykaSerials()
  const rezka = useMemo(() => serials.filter((s) => s.process === 'rezka'), [serials])
  return { serials: rezka, loading, refresh }
}
