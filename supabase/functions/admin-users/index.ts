// Rahbar-only user administration (docs/DECISIONS.md — "Auth method").
//
// Public signup is disabled and there is no real inbox behind the
// synthesized <phone>@batu.local addresses, so Supabase's built-in
// email-based signup / password-reset flows are unusable here. This
// function is the replacement: only a caller whose profile role is
// 'rahbar' may create a user or reset a password, and it does so with
// the service_role key (never exposed to the browser).
//
// Actions (POST body: { action: 'create_user' | 'reset_password', ... }):
//   create_user:    { phone, password, role, full_name }
//   reset_password: { phone, new_password }

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const ALLOWED_ROLES = ['rahbar', 'menejer', 'qorovul', 'ombor', 'laborator']

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function phoneToAuthEmail(phone: string) {
  return `${phone.replace(/\D/g, '')}@batu.local`
}

Deno.serve(async (req) => {
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

  if (body.action === 'create_user') {
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

  if (body.action === 'reset_password') {
    const { phone, new_password } = body as Record<string, string>
    if (!phone || !new_password) {
      return json({ error: 'phone and new_password are required' }, 400)
    }

    const { data: target, error: findErr } = await admin
      .from('profiles')
      .select('id')
      .eq('phone', phone)
      .single()
    if (findErr || !target) return json({ error: 'No user with that phone number' }, 404)

    const { error: updateErr } = await admin.auth.admin.updateUserById(target.id, {
      password: new_password,
    })
    if (updateErr) return json({ error: updateErr.message }, 400)

    return json({ ok: true })
  }

  return json({ error: 'Unknown action' }, 400)
})
