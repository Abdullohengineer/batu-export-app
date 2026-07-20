import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { fetchActiveCycles } from './activeCycles'

// §5.5.4 (SPEC.md v1.9): a serial needs Ombor's "Qayta yuvishga yuborish"
// action — and Menejer's read-only "Qayta yuvish kerak" flag — exactly
// when its CURRENT active cycle carries a `qayta_yuvish` verdict. This is
// self-clearing by construction: once Ombor voids that cycle's pallets,
// rewash.ts's activeCycleNo() derives a new, higher active cycle for the
// serial, so the SAME query on the SAME lab_results row no longer matches
// the (now historical) active cycle — no separate "already actioned" flag
// needed, matching "derive, don't store" (CLAUDE.md).
//
// Shared by Menejer's KirimOrdersList.tsx (flag only, no action — SPEC.md
// v1.9 §5.5.4: "Menejer sees it, Ombor acts on it") and Ombor's
// OmborTayyorTab.tsx (flag + the void action itself), so both read the
// exact same set, never two independently-computed flags that could
// disagree.
export function usePendingRewash(serials: string[]) {
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  const serialsKey = serials.join(',')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      if (serials.length === 0) {
        setPending(new Set())
        return
      }
      const activeCycles = await fetchActiveCycles(serials)
      const { data: cycles } = await supabase.from('wash_cycles').select('id, serial, cycle_no').in('serial', serials)
      const cycleIdByKey = new Map((cycles ?? []).map((c) => [`${c.serial}:${c.cycle_no}`, c.id]))

      const serialByActiveCycleId = new Map<string, string>()
      for (const serial of serials) {
        const cycle = activeCycles.get(serial)?.cycle ?? 1
        const id = cycleIdByKey.get(`${serial}:${cycle}`)
        if (id) serialByActiveCycleId.set(id, serial)
      }

      const activeCycleIds = [...serialByActiveCycleId.keys()]
      if (activeCycleIds.length === 0) {
        setPending(new Set())
        return
      }
      const { data: results } = await supabase
        .from('lab_results')
        .select('wash_cycle_id')
        .eq('scope', 'chiqim')
        .eq('verdict', 'qayta_yuvish')
        .in('wash_cycle_id', activeCycleIds)

      setPending(new Set((results ?? []).map((r) => serialByActiveCycleId.get(r.wash_cycle_id)).filter((s): s is string => !!s)))
    } finally {
      setLoading(false)
    }
    // Depends on serialsKey (joined string), not serials itself — callers
    // often pass a fresh array literal each render, which would otherwise
    // refetch every render regardless of whether the actual serial set changed.
  }, [serialsKey])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { pending, loading, refresh }
}
