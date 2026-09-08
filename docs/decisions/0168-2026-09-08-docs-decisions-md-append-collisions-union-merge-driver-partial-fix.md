## 2026-09-08 — docs/DECISIONS.md append collisions: union merge driver (partial fix)
**Context:** This log is append-only and every task appends its entry at the end
of the file, so any two branches developed in parallel collide there. Git stops
with a conflict it cannot resolve, even though the entries are unrelated and the
answer is always "keep both". Not hypothetical: it blocked PRs #131 and #132 at
the same time, and both resolutions were purely mechanical (keep both sides, in
date order). Nothing about either PR's actual content was in dispute.

**Decision:** Added `.gitattributes` with `docs/DECISIONS.md merge=union`. Union
is git's built-in driver for this shape — on a conflicting hunk it keeps the
lines from both sides (base branch's first, then the incoming branch's) instead
of raising a conflict. Verified against a reproduction of the real collision:
two branches each appending an entry conflict without the rule and merge cleanly
with it, both entries preserved in chronological order.

**Important limitation — measured, not assumed. This does NOT unblock GitHub's
merge button.** GitHub's server-side merge does not honor `.gitattributes` merge
drivers. Verified empirically rather than reasoned about: a throwaway PR was
opened between two branches that both carried the union rule and differed only
by an appended entry (the exact collision shape), and GitHub still reported
`mergeable_state: "dirty"`. So the rule helps only where a real git client does
the merging.

**What it therefore buys:** when a PR goes stale, the fix drops from "open the
file, find the markers, hand-splice two entries, verify nothing was lost" to
`git merge origin/main && git push` with no editing at all. That is the whole
benefit, and it is worth the one line — but the conflict will still *appear* on
GitHub and still needs someone to run that merge locally.

**Alternatives considered, not taken (both need a decision that is not this
task's to make):**
- *One file per entry* (`docs/decisions/YYYY-MM-DD-slug.md`). This is the only
  option that eliminates the collision server-side too, because two branches
  adding different files never conflict. It is the structurally correct fix, but
  it means restructuring a ~7,700-line file and changing where every future
  entry goes.
- *A GitHub Action that merges main into open PRs on every push to main.* With
  the union rule present in the workspace, the Action's own `git merge` would
  auto-resolve and push, keeping PRs continuously mergeable. Rejected for now as
  new write-permissioned automation that should be opted into deliberately.

**Risk accepted:** union resolves by concatenation, not by understanding. If two
branches ever edit the *same* existing entry, it will silently keep both variants
back-to-back instead of flagging a conflict. Safe only while entries stay
append-only and are never revised in place — which is the convention this file's
own header already states. If that ever changes, remove the rule.
