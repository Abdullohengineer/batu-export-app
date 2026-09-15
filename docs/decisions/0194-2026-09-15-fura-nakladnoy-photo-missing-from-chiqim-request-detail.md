# Fura nakladnoy photo missing from ChiqimRequestDetail

## What was reported

A fura-type CHIQIM dispatch's nakladnoy (waybill) photo, uploaded via
Qorovul's own fura flow, never shows up on the chiqim request's own
detail/passport view — even though the exact same photo already renders
correctly elsewhere in the app (the kirim serial passport's "dispatches"
sub-section).

## Investigation

A fura is never gate-weighed by design (`docs/decisions/0151-...-chiqim-
truck-type-fura.md`): no `gate_weighings` row is ever written for it. Its
own gate-side record instead lives in `chiqim_fura_photos`
(`docs/decisions/0152-...-fura-chiqim-gate-photos.md`, migration `0105`),
read via `chiqim_fura_photo_paths(request_id)` or the `chiqim_request_totals`
view that wraps it.

Grepped every consumer that renders a chiqim request's document photos to
find every place this needed checking, not just the one reported:

| Consumer | Status |
|---|---|
| `SerialPassportModal.tsx` (kirim passport, dispatches sub-section) | already correct — reads `photos.kirdi`/`chiqdi` from `get_serial_passport` |
| `ClientReportTab.tsx` (client portal) | already correct — same pattern, from `get_client_report` |
| `QorovulChiqimTab.tsx` (the upload flow itself) | already correct — renders its own uploads directly |
| `ChiqimRequestDetail.tsx` (shared by Menejer's `FinishedChiqimList.tsx` and Hisobot's `ChiqimRequestPassportModal.tsx`) | **broken** — only ever renders `request.weighing`'s 4 gate photos, always null for a fura; no `truck_type` branch at all |
| `useFinishedChiqimRequests.ts` (feeds the component above, both the bulk and single-request hooks) | **broken** — never queries `chiqim_fura_photos`/`chiqim_request_totals` at all, so there was nothing to render even if the component wanted to |
| `ChiqimDispatchRowDetail.tsx` (Hisobot's row-expand panel) | not applicable — renders no document photos of any kind today; only reaches this data by opening the modal above, so it inherits the fix |
| `OmborChiqimTab.tsx` (`truck_type === 'fura'` appears here too) | not applicable — those branches are workflow status text, no photo rendering |
| `reportExport.ts` (Excel), Rahbar dashboards | not applicable — no per-request photo rendering anywhere in either |

So: one real gap, at exactly one choke point (`ChiqimRequestDetail.tsx` +
its feeding hook), inherited by every screen that reaches a CHIQIM
request's detail through it. When the fura-photo feature shipped (`0151`/
`0152`), it was wired into `get_serial_passport` and `get_client_report`
only — this consumer is never mentioned in either decision doc, consistent
with a missed wiring, not a deferred one.

## Fix

- `useFinishedChiqimRequests.ts`: added `furaPhotos: { kirdi: string |
  null; chiqdi: string | null }` to `FinishedChiqimRequest` (always an
  object, never null — the source view's `cross join lateral
  chiqim_fura_photo_paths(cr.id)` guarantees one row per request
  regardless of truck type; only the two leaf values are nullable).
  Both hooks now read `chiqim_request_totals` (a plain view select, not a
  new RPC call — the view already wraps `chiqim_fura_photo_paths()`) in
  the same `Promise.all` as their existing queries: the bulk hook fetches
  every request's row in one round trip (not one RPC call per request),
  the single-request hook scopes it with `.eq('request_id', requestId)`.
- `ChiqimRequestDetail.tsx`: for `request.truck_type === 'fura'`, the two
  "Qorovul — Bo'sh vazn / Yuk bilan vazn" gate-stage blocks (always empty
  for a fura) are replaced outright by one "Qorovul — Fura" block
  rendering `furaPhotos.kirdi`/`chiqdi` via the same `GatePhoto`/
  `chiqim-fura-photos` bucket pattern `SerialPassportModal.tsx` already
  uses — same "replace, don't append" treatment that file already gives
  this exact case, not a new convention.

No RLS/schema change needed: `chiqim_fura_photos`' existing `read_all`
policy (`auth.uid() is not null and my_role() <> 'client'`) already
covers every role that reaches `ChiqimRequestDetail.tsx` (Menejer,
Rahbar); `chiqim_request_totals` is `security_invoker = true`, so it
enforces that same policy through the view.

## Verification

- `npm run build` (`tsc -b && vite build`) — exit 0.
- 🚩 UI-level verification not performed this session — no `.env.test`/
  authenticated session available in this sandbox, same constraint as
  every prior session's own flag on this exact family of screens.
  Reasoned from the schema (RLS policies, the view's `cross join lateral`
  guarantee) and from the already-proven-working sibling implementation
  (`SerialPassportModal.tsx`) rather than a live click-test.

## Related

- `docs/decisions/0151-2026-08-30-chiqim-truck-type-fura.md`
- `docs/decisions/0152-2026-08-30-fura-chiqim-gate-photos.md`
