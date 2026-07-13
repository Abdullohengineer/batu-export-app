// Rahbar-only user administration (docs/DECISIONS.md — "Auth method").
//
// Public signup is disabled and there is no real inbox behind the
// synthesized <phone>@batu.local addresses, so Supabase's built-in
// email-based signup / password-reset flows are unusable here. This
// function is the replacement: only a caller whose profile role is
// 'rahbar' may create a user or reset a password, and it does so with
// the service_role key (never exposed to the browser).
//
// Actions (POST body: { action: 'create-user' | 'reset-password', ... }):
//   create-user:    { phone, password, role, full_name }
//   reset-password: { phone, new_password } or { user_id, new_password }

import { createClient } from 'npm:@supabase/supabase-js@2'

// --- TEMPORARY DIAGNOSTIC — remove once the CORS fix is confirmed live ---
// Proves which bundle is actually deployed. Logged once at module load
// (cold start) so it shows up in `supabase functions logs admin-users`
// even for requests that never make it into the Deno.serve handler, and
// echoed back as a response header on every request so `curl -i` shows it
// directly without needing log access.
const DIAG_VERSION = 'admin-users-diag-2026-07-13a'
console.log(`[admin-users] module loaded — ${DIAG_VERSION}`)

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
// Named SERVICE_ROLE_KEY, not SUPABASE_SERVICE_ROLE_KEY — the Supabase CLI
// rejects secrets with the SUPABASE_ prefix (see docs/DECISIONS.md).
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!

const ALLOWED_ROLES = ['rahbar', 'menejer', 'qorovul', 'ombor', 'laborator']

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Called from the browser via supabase.functions.invoke, so every response —
// including errors and the OPTIONS preflight itself — needs these headers,
// or the browser never gets far enough to see the actual status/body.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  // TEMPORARY DIAGNOSTIC — remove alongside DIAG_VERSION above.
  'X-Admin-Users-Diag': DIAG_VERSION,
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

function phoneToAuthEmail(phone: string) {
  return `${phone.replace(/\D/g, '')}@batu.local`
}

Deno.serve(async (req) => {
  // TEMPORARY DIAGNOSTIC — first line of the handler, before any routing.
  // If this log line / the X-Admin-Users-Diag header never shows up for a
  // request, the request isn't reaching this function's code at all (wrong
  // project, stale deploy, something upstream intercepting it) — the bug
  // isn't in this file.
  console.log(`[admin-users] entry: ${req.method} ${req.url} — ${DIAG_VERSION}`)

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
  if (!jwt) return json({ error: 'Missing Authorization header' }, 401)

  const { data: callerData, error: callerErr } = await admin.auth.getUser(jwt)
  if (callerErr || !callerData.user) return json({ error: 'Invalid session' }, 401)

  const { data: callerProfile, error: callerProfileErr } = await admin
    .from('profiles')
    .select('role, active')
    .eq('id', callerData.user.id)
    .single()

  if (callerProfileErr || !callerProfile || callerProfile.role !== 'rahbar' || !callerProfile.active) {
    return json({ error: 'Forbidden — rahbar only' }, 403)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  if (body.action === 'create-user') {
    const { phone, password, role, full_name } = body as Record<string, string>
    if (!phone || !password || !role || !full_name) {
      return json({ error: 'phone, password, role, full_name are required' }, 400)
    }
    if (!ALLOWED_ROLES.includes(role)) {
      return json({ error: `role must be one of ${ALLOWED_ROLES.join(', ')}` }, 400)
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: phoneToAuthEmail(phone),
      password,
      email_confirm: true,
    })
    if (createErr || !created.user) {
      return json({ error: createErr?.message ?? 'Could not create user' }, 400)
    }

    const { error: insertErr } = await admin.from('profiles').insert({
      id: created.user.id,
      phone,
      role,
      full_name,
      active: true,
    })
    if (insertErr) {
      // Roll back the orphaned auth user so retrying with the same phone
      // number doesn't collide with a half-created account.
      await admin.auth.admin.deleteUser(created.user.id)
      return json({ error: insertErr.message }, 400)
    }

    return json({ id: created.user.id })
  }

  if (body.action === 'reset-password') {
    const { phone, user_id, new_password } = body as Record<string, string>
    if (!new_password || (!phone && !user_id)) {
      return json({ error: 'new_password and one of phone / user_id are required' }, 400)
    }

    let targetId = user_id
    if (!targetId) {
      const { data: target, error: findErr } = await admin
        .from('profiles')
        .select('id')
        .eq('phone', phone)
        .single()
      if (findErr || !target) return json({ error: 'No user with that phone number' }, 404)
      targetId = target.id
    }

    const { error: updateErr } = await admin.auth.admin.updateUserById(targetId, {
      password: new_password,
    })
    if (updateErr) return json({ error: updateErr.message }, 400)

    return json({ ok: true })
  }

  return json({ error: 'Unknown action' }, 400)
})
