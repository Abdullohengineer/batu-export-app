# Rezka Prompt 2: Ombor sections 2 and 3, the shared Konditerka predicate, and what was verified

Rezka Prompt 2 of 4. Spec: `docs/SPEC.md` §5.R.1 (v1.68). Builds on `0219`–`0223`.

## Shared Konditerka candidate predicate (`0144`, product-owner change request)

The first plan had the new tile RPC `rezka_kn_available()` restate the candidate filter that
`send_kn_to_rezka` (0142) already applied. The product owner asked for one definition instead.

**What `0144` does**
- `rezka_kn_candidate_pallets(p_owner_id, p_type_id)` is now **the** definition. It is a stable
  SQL function with security invoker. It returns each candidate pallet's available kg.
- A pallet is a candidate when all of these hold:
  - its calibre is Konditerka (`is_numberless and not is_rezka_output`);
  - it is `in_stock`, not voided, and not old stock;
  - its parent serial has `process='moyka'`;
  - the latest `chiqim` verdict on the serial's latest wash cycle is `o_tdi`;
  - weight − Σ consumption − Σ draws > 0.
- `send_kn_to_rezka` now reads that function. It locks the candidate pallets first (`for update`,
  ordered by barcode2), then allocates FIFO from the function's figures.
- `rezka_kn_available()` sums the same function per owner and type.

**Filters**
- Origin: this is a balance/stock read, so there is no origin filter. Old stock is excluded by
  `is_old_stock`.
- TEST- plates: deliberately no filter, because the draw has none (approved).

## Moyka-only reads now exclude Rezka explicitly (`0144`)

These were the SQL items HANDOFF listed after Prompt 1. Each exclusion is explicit, per
CLAUDE.md's rule against exclusions that only work because the data happens not to overlap.

| Read | Category | Change |
|---|---|---|
| `yield_rows` | Processing aggregate (Moyka yield) | Adds `kl.process <> 'rezka'` to the live body. |
| `wip_rows` | Moyka/lab buckets | `raw_not_sent` excludes Rezka serials. So do `moyka_not_returned`, `awaiting_lab` and `so2_pending`. |
| `lab_turnaround_avg` | Processing aggregate | Adds `kl.process <> 'rezka'`. |
| `classify_kirim_line_sulfur` | Lab action | Raises "Rezka seriyasi laboratoriyadan o'tmaydi". |

## UI decisions (approved plan)

**Structure**
- **Pill, not route.** `ProcessPill` is copied from the role-shell tab styling. Each tab persists
  its own choice through `usePersistentState` (FilterState).
- **Separate components, not a flag.**
  - `OmborMoykaTab` / `OmborTayyorTab` are now thin wrappers.
  - The old bodies were moved with `git mv` to `MoykaSendSection` / `MoykaReceiveSection`, with
    their bodies unchanged.
  - The Rezka side is new: `RezkaSendSection`, `TashqiToRezkaForm`, `IchkiToRezkaForm`,
    `RezkaReceiveSection` and `RezkaReceiveForm`.

**Windows**
- **Window 2 narrowing.** Section 2 Window 2 and section 3 Window 1 both use
  `useRezkaOutput().inRezka` (`isInRezka`: cycle open and sent > 0). Section 3 Window 2 shows
  every serial with output or a closed cycle.
- **Combined nav badges.**
  - Moykaga = Moyka `hasRawRemainder` + Rezka `available > 0`. Each process is counted by its
    own tile's predicate.
  - Tayyor = in-Moyka + in-Rezka.
- **Section 1 Window 2** uses `rezkaSent` for Rezka serials, not `sent`, and shows `RezkaBadge`
  on them. Before this, a Tashqi Rezka truck would have looked like it was waiting for a Moyka
  send forever.

**Receive and close**
- **No printing.**
  - The Rezka receive shows the saved barcode2 as text.
  - It mounts no `Barcode2Display`.
  - `FinishedReceiptForm`'s submit label becomes "Saqlash" when `rezka` is set. Before, it said
    "Saqlash va shtrix-kod chiqarish", which would have been false.
- **Yakunlash** is offered whenever the cycle is open. The confirmation states the signed figure:
  loss, "Ortiqcha +X kg", or "0 kg farq".
- **FinishedReceiptForm** changed in two small ways, with its Moyka behaviour unchanged:
  - It takes the structural `ReceiptSerial` (a 5-field `Pick`), so the Rezka row type fits
    without conversion.
  - It gains an optional `headerBadge`.

## Tooling fix: `check-rpc-wrapper` rejected its own prescribed pattern

`scripts/check-rpc-wrapper.mjs` flagged any literal `supabase.from(`. That included
`run(supabase.from(...).abortSignal(signal))`, which is exactly the shape `src/lib/rpc.ts`
documents. So no new file could use `run()` on a `.from()` chain.

**Fix**
- The script now strips `run(supabase.from|rpc(` occurrences before testing.
- A probe file with a bare `supabase.from(...)` is still rejected (checked).

**Allowlist**
- `OmborMoykaTab.tsx` / `OmborTayyorTab.tsx` were replaced by the renamed
  `MoykaSendSection.tsx` / `MoykaReceiveSection.tsx`. That is a move, not growth: 42 before,
  42 after.
- Every new Rezka file goes through `run()` / `callRpc()`.

## Verification

**`0144` dry run.** One live `BEGIN … raise` run, so the transaction aborts and nothing
persists. It used TEST- fixtures only, impersonating TEST Ombor.
- **md5.** The migration text md5 matched the committed file (`6e003fda…`).
- **Regression.**
  - `yield_rows`, `wip_rows` and `lab_turnaround_avg` returned output identical to before
    `0144`.
  - There are no Rezka rows live yet, so the exclusions change nothing today.
- **Prompt 1 draw tests re-run on the rewritten RPC.**

  | Step | Result |
  |---|---|
  | Tile before the draw | 1,440 kg (two 720 kg TEST pallets) |
  | Draw 25 kg | Came from `TEST-PLT-RZ-KN-1` |
  | After the draw | `finished_pallet_availability` = 1,415; tile = 1,415 |
  | Draw 2,000 kg | Rejected: "Konditerka yetarli emas: 585.0 kg yetishmayapti" |
  | Minted serial | `process='rezka'`, `origin='internal_reprocess'` |
  | `classify_kirim_line_sulfur` on a Rezka serial | Rejected |

**Local checks**
- `tsc -b` clean.
- `oxlint`: only the 2 warnings that were already there.
- `node --test`: 81/81 pass.
- `lint:rpc-wrapper` OK.
- `vite build` OK.

**Browser run not possible here.** The browser e2e could not run in this container: there is no
`.env.test`, and the proxy blocks browser→Supabase. `tests/e2e/rezka-ombor.spec.ts` is written
for the product owner to run locally, next to `full-chain.spec.ts`.
- It uses a dedicated owner, **TEST Rezka E2E**, with TEST- plates. The irreversible Ichki draw
  can therefore only consume Konditerka the spec seeded itself.
- Cleanup voids and never deletes. Pallets are set to `bekor_qilindi`, and every cycle it opened
  is closed.
- The TEST owner is left in place as infrastructure, like the TEST role accounts.
- The voided TEST serials stay visible (closed) in section 3 Window 2. They are filterable by the
  TEST owner and TEST- plate.

## Flagged, not fixed

- `tests/e2e/helpers/fixtures.ts` `seedDispatchablePallets` still writes the pre-0124
  `wash_cycles` shape, and its `window.supabase` type lacks `auth`. This is stale test helper
  code that the new spec does not use.
- Voided TEST- Rezka serials remain listed in section 3 Window 2. The UI has no TEST- filter;
  that is consistent with the other Ombor windows.
