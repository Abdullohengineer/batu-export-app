import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface Calibre {
  id: string
  category_id: string
  code: string // '04' | '06' | 'KN' … — used in Barcode #2 (PLT-<serial>-<code>)
  label: string // 'Kalibr 4' | 'Konditirskiy'
  is_numberless: boolean // true for Konditirskiy
  sort_order: number
}

// SPEC §2.3 / §5.3 calibre master data. NOTE: the `calibres` table is
// currently EMPTY on the real project (never seeded — Administration §6.4
// isn't built yet). The receipt form's Kalibr dropdown needs it seeded —
// flagged in the PR with ready-to-run SQL (same as Step 1's owners/types).
export function useCalibres() {
  const [calibres, setCalibres] = useState<Calibre[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const { data } = await supabase
          .from('calibres')
          .select('id, category_id, code, label, is_numberless, sort_order')
          .order('sort_order')
        setCalibres(data ?? [])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return { calibres, loading }
}
