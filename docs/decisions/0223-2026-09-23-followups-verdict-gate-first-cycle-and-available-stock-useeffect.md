# Follow-ups logged, not fixed: verdict gates read the first wash cycle; useAvailableFinishedStock is a raw useEffect

Found during Rezka Prompt 1; out of its scope; logged per the product owner's instruction.

**1. Dispatch/stock verdict gates read "the first wash cycle, `limit 1`, no order".**
`finished_pallet_availability`, `attribute_chiqim_line_fifo` and `stock_on_hand_rows` all resolve
a pallet's verdict via `select wc2.id from wash_cycles wc2 where wc2.serial = fp.serial limit 1`
with **no `order by`**. Since 0124 a serial can have several wash cycles, so on a twice-washed
serial the gate reads an arbitrary cycle's verdict — possibly the first cycle's
`qayta_yuvish` for pallets produced by a passed second cycle, or the reverse. Every other
multi-cycle read orders by `cycle_no`. Prompt 1 preserved the existing lateral byte-for-byte in
all three (only the Rezka OR-branch and the draw term were added), so behaviour is unchanged.
The new `send_kn_to_rezka` deliberately uses the latest cycle (`order by cycle_no desc`); in the
rare twice-washed case its candidate set can therefore differ from the dispatch gate's. Fix
direction: order the lateral by `cycle_no desc` (or bind the verdict to the cycle whose window
contains the pallet's `received_date`, as `useMoykaOutput` does) in all three, in one change.

**2. `useAvailableFinishedStock.ts` is a raw `useEffect` + `useState` fetch.** It reads
`finished_calibre_availability` with no React Query, no `abortSignal`, and no `.error` check
(`const { data } = await ...` — a failed fetch silently renders as zero stock). All three
violate CLAUDE.md "Data access". It is pre-existing and grandfathered in
`scripts/check-rpc-wrapper.mjs`'s allowlist; Prompt 1 did not need to touch it (its verdict gate
lives in the view). Migrate it onto `useQuery` (key in `queryKeys`) when Prompt 3 builds the
Menejer CHIQIM Rezka tab, which reads it.
