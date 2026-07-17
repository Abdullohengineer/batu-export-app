import { ChiqimForm } from './ChiqimForm'

// §3.1 CHIQIM tab. No list here yet — Menejer's own finished-view (seeing a
// request move to Olib ketildi) is a later Step 7 prompt; "requests ready to
// load" (Window 1) belongs to Ombor's §5.4 screen, not this one.
export function MenejerChiqimTab() {
  return (
    <div className="max-w-2xl">
      <ChiqimForm onSaved={() => {}} />
    </div>
  )
}
