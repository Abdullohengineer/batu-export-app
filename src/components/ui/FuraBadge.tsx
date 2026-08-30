// Transport turi badge — SPEC.md §5.4/§4 (see DECISIONS.md "CHIQIM truck
// type: Fura"). Renders next to a CHIQIM trip's truck info wherever that
// trip is shown, and ONLY for a fura: a regular truck is the default and
// needs no marking, exactly as PartiyaBadge renders nothing for a serial
// with no partiya number.
//
// What it means, and why it has to be visible: a fura is too big for the
// factory's gate scale, so it is never weighed there. Its record carries no
// gate net, no Гружёный/Пустой pair and no gate photos — permanently, by
// design, not because someone hasn't got round to it. Any screen showing a
// dash where a weight belongs needs this badge beside it, or that dash
// reads as missing data.
//
// Blue/`info` tone, not amber: amber is already load-bearing for
// PartiyaBadge and for pending/variance states across Ombor and Laborator
// (see tokens.ts's "colors are NAMED, not invented"), and the two badges
// appear on the same rows in Hisobot. `info` is the tone this app already
// uses for "a fact about this row," not "something needs attention" —
// nothing about a fura needs attention.
export function FuraBadge({ truckType }: { truckType: string | null | undefined }) {
  if (truckType !== 'fura') return null
  return (
    <span
      className="inline-flex shrink-0 items-center rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-800 dark:bg-blue-900/50 dark:text-blue-300"
      title="Fura — darvozada o'lchanmaydi"
    >
      Fura
    </span>
  )
}
