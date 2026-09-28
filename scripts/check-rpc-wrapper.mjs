#!/usr/bin/env node
// Phase 2 step 7 (data-layer perf pass) -- fails if a file OUTSIDE this
// allowlist calls `supabase.rpc(...)` or `supabase.from(...)` directly
// instead of going through src/lib/rpc.ts's `run()`/`callRpc()` wrapper.
//
// The allowlist below is the COMPLETE set of files that called
// supabase.rpc()/supabase.from() directly as of 2026-09-21, before this
// wrapper existed -- every one of them is grandfathered in, not exempted
// by design. It exists to SHRINK, one file at a time, as each is migrated
// onto the wrapper; never add a genuinely NEW call site to it as a way
// around the check. A file leaving the allowlist locks that migration in:
// if it later regresses back to a raw call, this script starts failing on
// it again.
//
// Run via `npm run lint:rpc-wrapper`; also wired into `.husky/pre-push`
// alongside the build. See CLAUDE.md "Data access" for the rule this
// enforces and src/lib/rpc.ts for the wrapper itself.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'src')

const ALLOWLIST = new Set([
  'src/lib/chiqimDispatchDetail.ts',
  'src/lib/classifySulfur.ts',
  'src/lib/effectiveQty.ts',
  'src/lib/labVerdict.ts',
  'src/lib/masterDataAdmin.ts',
  'src/lib/serialPassport.ts',
  'src/lib/useAvailableFinishedStock.ts',
  'src/lib/useChiqimTrips.ts',
  'src/lib/useChiqimTruckTypes.ts',
  'src/lib/useFinishedChiqimRequests.ts',
  'src/lib/useIntakeLines.ts',
  'src/lib/useKirimTrips.ts',
  'src/lib/useLaboratorChiqim.ts',
  'src/lib/useLaboratorHistory.ts',
  'src/lib/useLaboratorKirim.ts',
  'src/lib/useMoykaOutput.ts',
  'src/lib/useMoykaSerials.ts',
  'src/lib/useNotes.ts',
  'src/lib/useOmborChiqimRequests.ts',
  'src/lib/useOwners.ts',
  'src/lib/useProductTypes.ts',
  'src/lib/useProfileNames.ts',
  'src/lib/useRahbarDashboard.ts',
  'src/lib/useReportQuery.ts',
  'src/lib/useSettingsLimits.ts',
  'src/lib/useStockOnHand.ts',
  'src/lib/useWipRows.ts',
  'src/lib/useYieldRows.ts',
  'src/pages/laborator/LaboratorChiqimTab.tsx',
  'src/pages/laborator/LaboratorKirimTab.tsx',
  'src/pages/menejer/ChiqimForm.tsx',
  'src/pages/menejer/FinishedChiqimList.tsx',
  'src/pages/menejer/KirimOrdersList.tsx',
  'src/pages/menejer/OldStockCloseoutTab.tsx',
  'src/pages/ombor/OldStockToMoykaForm.tsx',
  'src/pages/ombor/OmborChiqimTab.tsx',
  'src/pages/ombor/OmborIntakeTab.tsx',
  // Renamed 2026-09-24 (Rezka Prompt 2, git mv, body unchanged): these two
  // were OmborMoykaTab.tsx / OmborTayyorTab.tsx, which are now raw-call-free
  // pill wrappers. A move, not growth -- allowlist size unchanged.
  'src/pages/ombor/MoykaReceiveSection.tsx',
  'src/pages/ombor/MoykaSendSection.tsx',
  'src/pages/qorovul/QorovulChiqimTab.tsx',
  'src/pages/qorovul/QorovulKirimTab.tsx',
  'src/pages/reports/ChiqimDispatchRowDetail.tsx',
])

// Files that legitimately reference the pattern in a comment, or are the
// wrapper/client definitions themselves -- never call sites.
const EXEMPT = new Set(['src/lib/rpc.ts', 'src/lib/supabase.ts'])

const RAW_CALL = /supabase\.rpc\(|supabase\.from\(/
// A builder passed straight into run() -- `run(supabase.from(...)...)`, the
// exact shape rpc.ts documents for a chained query -- IS the wrapper, not a
// raw call site; strip those before testing (Rezka Prompt 2, 2026-09-24:
// before this, the check rejected the pattern its own wrapper prescribes,
// so no new file could use run() on a .from() chain at all).
const WRAPPED_CALL = /\brun(?:<[^>]*>)?\(\s*supabase\.(?:rpc|from)\(/g
function hasRawCall(content) {
  return RAW_CALL.test(content.replace(WRAPPED_CALL, 'run('))
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      walk(full, out)
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts')) {
      out.push(full)
    }
  }
  return out
}

const files = walk(SRC)
const violations = []
const staleAllowlistEntries = []

for (const file of files) {
  const rel = relative(ROOT, file).replaceAll('\\', '/')
  if (EXEMPT.has(rel)) continue
  const content = readFileSync(file, 'utf8')
  const hasRaw = hasRawCall(content)
  if (hasRaw && !ALLOWLIST.has(rel)) violations.push(rel)
}

// A file on the allowlist that no longer has any raw call (fully migrated)
// should be removed from the allowlist -- flagged as a warning, not a
// failure, so migrating a file doesn't itself break the check.
const filesByRel = new Map(files.map((f) => [relative(ROOT, f).replaceAll('\\', '/'), f]))
for (const rel of ALLOWLIST) {
  const full = filesByRel.get(rel)
  if (!full) continue // file moved/deleted -- not this script's job to catch
  const content = readFileSync(full, 'utf8')
  if (!hasRawCall(content)) staleAllowlistEntries.push(rel)
}

if (staleAllowlistEntries.length > 0) {
  console.warn('check-rpc-wrapper: these allowlisted files no longer have a raw call -- remove them from ALLOWLIST to lock the migration in:')
  for (const rel of staleAllowlistEntries) console.warn(`  - ${rel}`)
}

if (violations.length > 0) {
  console.error('check-rpc-wrapper: new direct supabase.rpc()/supabase.from() call site(s) found outside src/lib/rpc.ts\'s wrapper, in file(s) not on the allowlist:')
  for (const rel of violations) console.error(`  - ${rel}`)
  console.error(
    '\nRoute the call through run()/callRpc() (src/lib/rpc.ts) instead. If this file is pre-existing code you are only touching incidentally, add it to ALLOWLIST in scripts/check-rpc-wrapper.mjs -- but never do that for a call site that is genuinely new.',
  )
  process.exit(1)
}

console.log(`check-rpc-wrapper: OK (${ALLOWLIST.size} allowlisted file(s), 0 new violations)`)
