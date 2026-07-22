import type { ButtonHTMLAttributes } from 'react'
import { touch } from './tokens'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
export type ButtonSize = 'lg' | 'md'

const variantClass: Record<ButtonVariant, string> = {
  // Dark-filled commit action — matches the existing app's own convention
  // for its main commit buttons (Ha, tugallash / Sera kiritish / etc.).
  primary: 'bg-slate-900 text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300',
  secondary:
    'border border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
  ghost: 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
  danger: 'bg-red-600 text-white hover:bg-red-500',
  success: 'bg-emerald-600 text-white hover:bg-emerald-500',
}

const sizeClass: Record<ButtonSize, string> = {
  lg: `${touch.primary} px-5 text-base font-medium`,
  md: `${touch.secondary} px-4 text-sm font-medium`,
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
}

// Button hierarchy, formalized once: `primary` is the one visually
// dominant, dark-filled action per screen (the confirm/commit step);
// `secondary` is an outlined, still-substantial action; `ghost` is a
// tertiary/dismiss action (Bekor qilish); `danger`/`success` match the
// existing verdict-button convention (Qayta yuvish / O'tdi).
export function Button({ variant = 'secondary', size = 'md', fullWidth, className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-md transition-colors disabled:opacity-50 disabled:pointer-events-none',
        variantClass[variant],
        sizeClass[size],
        fullWidth ? 'w-full' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  )
}
