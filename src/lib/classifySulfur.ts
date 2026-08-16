import { supabase } from './supabase'

// Natural/sulphured classification moved from Menejer to Laborator
// (2026-08-15) -- the lab physically observes the product, and because it's
// set on a form the lab can reopen, a misclassification is fixable in-app
// instead of requiring SQL. See DECISIONS.md "Natural/sulphured
// classification moved from Menejer to Laborator; audit trail".
//
// `is_sulfured` lives on kirim_lines -- one column, one row per serial, no
// per-scope/per-form copy. Every save path that can set or correct it
// (KIRIM/CHIQIM Tahlil, both Edit forms, both Sera-kiritish cards) goes
// through this one function, which itself goes through the
// classify_kirim_line_sulfur() RPC (security definer,
// supabase/migrations/0071_classify_kirim_line_sulfur_rpc.sql) rather than
// a client-side update+insert. Deliberately not a kirim_lines UPDATE
// policy: that would grant Laborator write access to every column on the
// table (declared_qty, type_id, ...), not just this one. Deliberately not
// a second client-side audit_log insert either: it could fail silently
// after the flag already changed, and a client-supplied actor isn't
// trustworthy on a field that gates dispatch (audit_log's own INSERT
// policy is permissive-by-role). The RPC does the update, the audit row,
// and derives actor from auth.uid() -- all in one transaction, server-side.
//
// A plain UPDATE inside the RPC, no version check -- whichever save
// reaches the database last wins, same as every other single-value field
// on this table.
//
// `before` is a client-side optimization only (skips the round-trip when
// nothing changed) -- the RPC itself independently re-checks the current
// value and no-ops if it matches, so a stale or wrong `before` can never
// cause an incorrect write or a missing audit row, only, at worst, one
// avoidable network call.
export async function applySulfurClassification(serial: string, before: boolean | null, after: boolean): Promise<void> {
  if (before === after) return
  const { error } = await supabase.rpc('classify_kirim_line_sulfur', { p_serial: serial, p_is_sulfured: after })
  if (error) throw error
}

// '' | 'true' | 'false' is the shared select-value shape every classification
// <select> in the app uses -- '' means "not yet chosen," forcing a deliberate
// pick before a form can submit; only an explicit choice ever leaves this
// state, matching the NULL-means-sulfured fail-safe's own "no silent
// default" principle at the UI layer.
export type SulfurChoice = '' | 'true' | 'false'

export function sulfurChoiceFromFlag(value: boolean | null): SulfurChoice {
  return value === true ? 'true' : value === false ? 'false' : ''
}
