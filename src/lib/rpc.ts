import { supabase } from './supabase'

// Phase 2 step 7 (data-layer perf pass) — the wrapper every NEW
// supabase.rpc()/supabase.from() call site should go through. Two problems
// this project has hit repeatedly, both from the same root cause (a raw
// call site that forgot one of these two things):
//   - Silent error swallowing: `useProductTypes.ts` never checked `.error`
//     at all, which is the confirmed root cause of the "pererabotano
//     renders without product type" bug (see queryClient.ts's own comment
//     and docs/decisions/ 2026-09-21 "Phase 2 step 1"). `run`/`callRpc`
//     always throw on `.error` — there is no way to call through this file
//     and have a failure end up silently rendered as empty/zero.
//   - No cancellation: a superseded request finishing after a newer one
//     started clobbering state with stale data was the root cause of the
//     Hisobot debounce race bug (see useReportQuery.ts's own history). Both
//     helpers below take an AbortSignal so a caller wires the same
//     cancel-on-supersede pattern React Query's `queryFn` already provides.
//
// `run()` wraps an ALREADY-BUILT Supabase awaitable (a `.from(...)...`
// chain or a `.rpc(...)` call) — attach `.abortSignal(signal)` on the
// builder yourself before passing it in, same as every hook in this
// codebase already does; `run()` can't attach it after the fact once the
// builder is a bare thenable. `callRpc()` is the common-case shortcut for a
// plain RPC call with no further chaining.
//
// Enforced by `scripts/check-rpc-wrapper.mjs` (wired into `npm run
// lint:rpc-wrapper` and the pre-push hook): a NEW direct `supabase.rpc(`/
// `supabase.from(` call site outside this file fails the check unless the
// file is on that script's allowlist. The allowlist exists because this
// project's whole data-access layer predates this wrapper — every current
// call site is grandfathered in — and it is meant to SHRINK, one file at a
// time, as each is migrated onto `run`/`callRpc`; never add a genuinely NEW
// call site to the allowlist instead of using the wrapper. See CLAUDE.md
// "Data access" for the rule this file and script exist to enforce.
export async function run<T>(builder: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await builder
  if (error) throw new Error(error.message)
  return data
}

export async function callRpc<T>(fn: string, args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  let query = supabase.rpc(fn, args)
  if (signal) query = query.abortSignal(signal)
  return run<T>(query as unknown as PromiseLike<{ data: T; error: { message: string } | null }>)
}
