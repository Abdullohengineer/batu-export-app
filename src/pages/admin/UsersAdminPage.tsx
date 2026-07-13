import { useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import type { UserRole } from '../../lib/useProfile'

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
      <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Yangi foydalanuvchi</h2>

      <Field label="Telefon raqami" value={phone} onChange={setPhone} type="tel" placeholder="998901234567" />
      <Field label="Ism familiya" value={fullName} onChange={setFullName} />
      <Field label="Boshlang'ich parol" value={password} onChange={setPassword} type="password" />

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Rol</label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as UserRole)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      {status && (
        <p className={status.kind === 'error' ? 'text-sm text-red-600 dark:text-red-400' : 'text-sm text-green-600 dark:text-green-400'}>
          {status.message}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
      >
        {loading ? 'Yaratilmoqda…' : 'Yaratish'}
      </button>
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
      <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Parolni tiklash</h2>

      <Field
        label="Telefon raqami yoki foydalanuvchi ID"
        value={identifier}
        onChange={setIdentifier}
        placeholder="998901234567"
      />
      <Field label="Yangi parol" value={newPassword} onChange={setNewPassword} type="password" />

      {status && (
        <p className={status.kind === 'error' ? 'text-sm text-red-600 dark:text-red-400' : 'text-sm text-green-600 dark:text-green-400'}>
          {status.message}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
      >
        {loading ? 'Yangilanmoqda…' : 'Tiklash'}
      </button>
    </form>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>
      <input
        type={type}
        required
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      />
    </div>
  )
}
