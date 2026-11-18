import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { run } from './rpc'
import { queryKeys } from './queryClient'

// CHIQIM request detail (Hisobot "So'rov tafsilotlarini ko'rish"): partiya
// number and CHIQIM namligi beside each dispatched pallet's serial.
//   - partiyaNo: kirim_lines.partiya_no (per serial, SPEC "Partiya raqami").
//   - chiqimMoisturePct: the serial's LATEST scope='chiqim' lab_results row by
//     created_at -- the value Laborator entered once the product came out of
//     Moyka. A serial can carry several CHIQIM tests (re-tests, several wash
//     cycles); the passport shows the latest per cycle, this shows the latest
//     overall (decided with the user: "latest test").
export interface SerialPartiyaMoisture {
  partiyaNo: number | null
  chiqimMoisturePct: number | null
}

export function useSerialPartiyaMoisture(serials: string[]) {
  const unique = [...new Set(serials.filter(Boolean))]
  const { data } = useQuery({
    queryKey: queryKeys.serialPartiyaMoisture(unique),
    enabled: unique.length > 0,
    queryFn: async ({ signal }) => {
      const [lines, labs] = await Promise.all([
        run(supabase.from('kirim_lines').select('serial, partiya_no').in('serial', unique).abortSignal(signal)),
        run(
          supabase
            .from('lab_results')
            .select('parent_serial, moisture_pct, created_at')
            .eq('scope', 'chiqim')
            .in('parent_serial', unique)
            .order('created_at', { ascending: false })
            .abortSignal(signal),
        ),
      ])
      const out = new Map<string, SerialPartiyaMoisture>()
      for (const s of unique) out.set(s, { partiyaNo: null, chiqimMoisturePct: null })
      for (const l of (lines as { serial: string; partiya_no: number | null }[] | null) ?? []) {
        out.get(l.serial)!.partiyaNo = l.partiya_no
      }
      // Rows arrive newest first: keep the first moisture seen per serial.
      const seen = new Set<string>()
      for (const r of (labs as { parent_serial: string; moisture_pct: number | null }[] | null) ?? []) {
        if (seen.has(r.parent_serial)) continue
        seen.add(r.parent_serial)
        out.get(r.parent_serial)!.chiqimMoisturePct = r.moisture_pct === null ? null : Number(r.moisture_pct)
      }
      return out
    },
  })
  return data ?? new Map<string, SerialPartiyaMoisture>()
}
