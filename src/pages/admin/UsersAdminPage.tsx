import { useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import type { UserRole } from '../../lib/useProfile'
import { Button } from '../../components/ui/Button'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { StatusNote } from '../../components/ui/StatusNote'
import { FormField, TextInput } from '../../components/ui/FormField'

const ROLES: UserRole[] = ['rahbar', 'menejer', 'qorovul', 'ombor', 'laborator']

export function UsersAdminPage() {
  return (
    <div className="max-w-xl space-y-8">
      <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
        Foydalanuvchilar
      </h1>
      <CreateUserForm />
      <ResetPasswordForm />
    </div>
  )
}

function CreateUserForm() {
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<UserRole>('menejer')
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setStatus(null)
    setLoading(true)

    const { data, error } = await supabase.functions.invoke('admin-users', {
      body: { action: 'create-user', phone, password, role, full_name: fullName },
    })

    setLoading(false)
    if (error || data?.error) {
      setStatus({ kind: 'error', message: data?.error ?? error!.message })
      return
    }
    setStatus({ kind: 'ok', message: 'Foydalanuvchi yaratildi.' })
    setPhone('')
    setPassword('')
    setFullName('')
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-slate-200 p-6 dark:border-slate-800">
      <SectionHeading>Yangi foydalanuvchi</SectionHeading>

      <FormField label="Telefon raqami">
        <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} required type="tel" placeholder="998901234567" />
      </FormField>
      <FormField label="Ism familiya">
        <TextInput value={fullName} onChange={(e) => setFullName(e.target.value)} required />
      </FormField>
      <FormField label="Boshlang'ich parol">
        <TextInput value={password} onChange={(e) => setPassword(e.target.value)} required type="password" />
      </FormField>

      <FormField label="Rol">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as UserRole)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </FormField>

      {status && <StatusNote tone={status.kind === 'error' ? 'problem' : 'ok'}>{status.message}</StatusNote>}

      <Button type="submit" variant="primary" size="lg" fullWidth disabled={loading}>
        {loading ? 'Yaratilmoqda…' : 'Yaratish'}
      </Button>
    </form>
  )
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function ResetPasswordForm() {
  const [identifier, setIdentifier] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setStatus(null)
    setLoading(true)

    const identifierField = UUID_PATTERN.test(identifier.trim()) ? 'user_id' : 'phone'

    const { data, error } = await supabase.functions.invoke('admin-users', {
      body: {
        action: 'reset-password',
        [identifierField]: identifier.trim(),
        new_password: newPassword,
      },
    })

    setLoading(false)
    if (error || data?.error) {
      setStatus({ kind: 'error', message: data?.error ?? error!.message })
      return
    }
    setStatus({ kind: 'ok', message: 'Parol yangilandi.' })
    setIdentifier('')
    setNewPassword('')
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-slate-200 p-6 dark:border-slate-800">
      <SectionHeading>Parolni tiklash</SectionHeading>

      <FormField label="Telefon raqami yoki foydalanuvchi ID">
        <TextInput value={identifier} onChange={(e) => setIdentifier(e.target.value)} required placeholder="998901234567" />
      </FormField>
      <FormField label="Yangi parol">
        <TextInput value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required type="password" />
      </FormField>

      {status && <StatusNote tone={status.kind === 'error' ? 'problem' : 'ok'}>{status.message}</StatusNote>}

      <Button type="submit" variant="primary" size="lg" fullWidth disabled={loading}>
        {loading ? 'Yangilanmoqda…' : 'Tiklash'}
      </Button>
    </form>
  )
}
