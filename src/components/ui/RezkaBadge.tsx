// Rezka provenance badge (SPEC.md §5.R, Rezka Prompt 2). Same family as the
// amber old-stock badge (10px, uppercase, rounded) but violet: amber is
// load-bearing for PartiyaBadge/old stock/pending states (tokens.ts "colors
// are NAMED"), blue for FuraBadge. Tashqi = a real truck (origin='delivery',
// process='rezka'); Ichki KN = minted from Konditerka by send_kn_to_rezka.
export function RezkaBadge({ provenance }: { provenance?: 'tashqi' | 'ichki' }) {
  // No provenance = a CHIQIM line (Rezka Prompt 3): a Standard line is filled
  // FIFO from output pallets of Tashqi and Ichki serials alike, so it has no
  // single source -- the badge just says "Rezka".
  const suffix = provenance === 'tashqi' ? ' · Tashqi' : provenance === 'ichki' ? ' · Ichki KN' : ''
  const title =
    provenance === 'tashqi' ? 'Rezka — tashqaridan kelgan' : provenance === 'ichki' ? 'Rezka — ichki Konditerkadan' : 'Rezka mahsuloti'
  return (
    <span
      className="inline-flex shrink-0 items-center rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-800 dark:bg-violet-900/50 dark:text-violet-300"
      title={title}
    >
      Rezka{suffix}
    </span>
  )
}
