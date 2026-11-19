# 0246 — Lab no longer gates packing or CHIQIM dispatch

2026-11-19 — User request: Ombor must be able to collect Moyka output
(section 3, kg per kalibr per serial, Barcode #2) without waiting for
Laborator, because lab updates were slowing the floor down.

## Decided by the user

- **Scope: packing *and* dispatch.** The lab verdict gates nothing.
  Untested product can be packed and shipped.
- **Reject after packing: record only.** A `qayta_yuvish` verdict on an
  already-packed serial is recorded and shown; its pallets stay
  dispatchable. No new re-wash workflow.

## Where the gate lived (inspected live)

| Layer | Object | Change (migration `0162`) |
|---|---|---|
| Packing (DB) | `finished_pallets` INSERT policy `ombor_writes` (0035): latest chiqim verdict must be `o_tdi` | `alter policy` → `my_role() = 'ombor'` only |
| Packing (UI) | `ReceiveFromMoykaForm` only listed `labStatus === 'passed'` serials | lists every in-Moyka serial; untested and rejected show as an amber "tahlil yo'q" / "qayta yuvish" hint |
| Yakunlash | `close_wash_cycle_serial` raised unless `o_tdi`; UI `canYakunlash` required pass | lab check removed in both |
| Dispatch availability | `finished_pallet_availability` view (Menejer's feasibility hint) | lab filter removed |
| Dispatch FIFO | `attribute_chiqim_line_fifo` pallet loop | lab filter removed |
| Qoldiq | `stock_on_hand_rows` forced `awaiting_lab` / `qayta_yuvish` buckets | always NULL: every in-stock pallet is Available (or Band qilingan). Keeps Qoldiq equal to what CHIQIM can actually take. `security_invoker=true` restated. |

The long definitions are edited by asserted regex replacement of the lab
condition only, so everything else stays byte-identical to the live
definitions.

## Not changed (flagged)

- **`rezka_kn_candidate_pallets`**: Rezka Ichki can still only draw from
  `o_tdi` KN pallets. Outside "packing and dispatch" as asked. If
  untested KN should be cuttable too, it's a one-line follow-up.
- **`open_second_wash_cycle`**: still requires the closed cycle to have
  passed.
- **Serial passport** `stillInStorageBreakdown.awaitingLabKg` /
  `needsRewashKg` (get_serial_passport_core) still splits a serial's
  stock by verdict. It's informational there now: those kg are
  dispatchable.
- WIP "Tahlil kechikdi" and `rahbar_exceptions` still report lab delay.
  It's a tracking signal now, not a blocker.
- Laborator's screens are unchanged. The CHIQIM queue is built from
  `wash_cycles`, so a serial stays testable after Ombor has packed it.

## Verification (live, one transaction, rolled back)

- Before: TEST Ombor inserting a pallet for untested serial `111126-001` →
  rejected by RLS.
- After the migration body: the same insert succeeds; TEST Rahbar is still
  rejected. The pallet appears in `finished_pallet_availability` and in
  Qoldiq as `available`.
- `o_tdi` no longer appears in `attribute_chiqim_line_fifo` or
  `close_wash_cycle_serial`, and `stock_on_hand_rows` kept
  `security_invoker=true`.
- Current totals are unchanged: availability 66,900 kg before and after.
  There were 0 awaiting-lab / qayta-yuvish pallets, because the old gate
  never let any exist.
- Frontend: build passes, 89/89 unit tests pass, `lint:rpc-wrapper` passes.
  Not exercised in a browser.

**Applied live 2026-11-19** on the user's go-ahead ("just need web to work
well"; the Android APK is not being updated). Re-checked right after: the
policy is `my_role() = 'ombor'`, no `o_tdi` left in the FIFO or Yakunlash
functions, `security_invoker` kept, availability and Qoldiq available are
both 66,900 kg, and Qoldiq buckets are now only available / old_kn /
raw_not_washed. The un-updated APK keeps the old, stricter receive list;
the database no longer blocks it, so it is merely conservative, not wrong.

SPEC §1.1 (Lab row), §2.13, §3.2.9 (Tahlil kechikdi) and §3.2.6 (stock
states) amended inline. Changelog v1.72.
