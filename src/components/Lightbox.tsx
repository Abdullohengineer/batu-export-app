// Full-size image overlay, stacked above a modal's own z-50. Click on the
// backdrop (or the × button) closes just the lightbox — stopPropagation
// keeps that click from also reaching the parent modal's own onClose
// handler, since this renders as a sibling inside that same click-to-close
// container. Extracted from SerialPassportModal.tsx (identical shape) so
// ClientSerialSummaryModal.tsx can reuse it rather than duplicate it.
export function Lightbox({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/85 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        aria-label="Yopish"
        className="absolute right-4 top-4 rounded-md px-2 py-1 text-2xl leading-none text-white/80 hover:text-white"
      >
        ×
      </button>
      <figure className="max-h-full max-w-full" onClick={(e) => e.stopPropagation()}>
        <img src={url} alt={label} className="max-h-[calc(100vh-6rem)] max-w-full rounded-md object-contain" />
        <figcaption className="mt-2 text-center text-sm text-white/70">{label}</figcaption>
      </figure>
    </div>
  )
}
