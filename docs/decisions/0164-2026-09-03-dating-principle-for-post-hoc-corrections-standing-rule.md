## 2026-09-03 — Dating principle for post-hoc corrections (standing rule)

Prompted directly by the redate above. Recorded here as a rule for **every future post-hoc
correction**, not just this one:

🔒 **A post-hoc correction's date fields (`received_date`, `request_date`, and any equivalent
"when did this really happen" column elsewhere) must carry the real physical event date — when
the thing actually happened in the world — never the date the correction itself was typed into
SQL.** The SQL-registration timestamp already exists, verbatim, in `created_at` (or the
equivalent audit column) and in the `audit_log` row the correction itself should always write
(actor `null` when it's a direct SQL correction with no single attributable app-role actor, per
the convention both this entry and the 2026-09-02 one above used) — there is no need to also
encode "when was this typed in" into the business-meaning date column, and doing so is exactly
what produced this incident's apparent (and, as investigated, largely illusory in terms of actual
kg-total impact) temporal impossibility.

Practically: before writing a post-hoc `UPDATE`/`INSERT`, ask "what date would this row have
carried if it had been entered on time?" — and use that, not `now()`/`CURRENT_DATE`. When the
true physical date is genuinely unknown or unknowable from the data itself, say so explicitly in
the DECISIONS.md entry (as the 2026-09-02 entry did — "the post-hoc collection date") rather than
defaulting silently to the registration date and letting a reader assume it's the real one.
