// Rezka provenance badge (SPEC.md §5.R, Rezka Prompt 2). Same family as the
// amber old-stock badge (10px, uppercase, rounded) but violet: amber is
// load-bearing for PartiyaBadge/old stock/pending states (tokens.ts "colors
// are NAMED"), blue for FuraBadge. Tashqi = a real truck (origin='delivery',
// process='rezka'); Ichki KN = minted from Konditerka by send_kn_to_rezka.
export function RezkaBadge({ provenance }: { provenance: 'tashqi' | 'ichki' }) {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-800 dark:bg-violet-900/50 dark:text-violet-300"
      title={provenance === 'tashqi' ? 'Rezka — tashqaridan kelgan' : 'Rezka — ichki Konditerkadan'}
    >
      Rezka · {provenance === 'tashqi' ? 'Tashqi' : 'Ichki KN'}
    </span>
  )
}
