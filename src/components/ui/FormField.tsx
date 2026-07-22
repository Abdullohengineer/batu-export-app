import type { InputHTMLAttributes, ReactNode } from 'react'
import { touch } from './tokens'

// Label + input, the pattern already repeated on every form in the app
// (`<label className="block text-sm font-medium ...">` then an input one
// line below) — formalized with one addition: a real min-height on the
// input (48px, `touch.secondary`) where the existing app left inputs at
// their unstyled ~32-36px default.
export function FormField({
  label,
  error,
  children,
}: {
  label: string
  error?: string | null
  children: ReactNode
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>
      <div className="mt-1">{children}</div>
      {error && (
        <p className="mt-1 text-sm font-medium text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

export function TextInput({ invalid, className, ...rest }: TextInputProps) {
  return (
    <input
      className={[
        'w-full rounded-md border px-3 text-base',
        touch.secondary,
        invalid
          ? 'border-red-400 dark:border-red-700'
          : 'border-slate-300 dark:border-slate-700',
        'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100',
        'placeholder:text-slate-400 dark:placeholder:text-slate-500',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  )
}
