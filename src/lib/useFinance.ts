import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { run, callRpc } from './rpc'
import { queryClient, queryKeys } from './queryClient'
import { compressImage } from './imageCompress'
import { monthEnd } from './financeFormat'

// Buxgalteriya data layer (decisions 0249/0250). Reads are React Query hooks
// under the 'fin' key prefix; writes are plain async functions that throw on
// error (run()), write audit_log on edit/void (same pattern as Tahrirlash),
// and end with invalidateFinance() so every finance screen re-reads.
// RLS does the real gating: buxgalter writes, buxgalter/rahbar/menejer read.

export type ExpenseType = 'recurring_required' | 'recurring_optional' | 'one_off' | 'unexpected'
export type ServiceType = 'moyka' | 'rezka' | 'other'

export const EXPENSE_TYPE_LABEL: Record<ExpenseType, string> = {
  recurring_required: 'Doimiy — majburiy',
  recurring_optional: 'Doimiy — ixtiyoriy',
  one_off: 'Bir martalik',
  unexpected: 'Kutilmagan',
}

export const SERVICE_TYPE_LABEL: Record<ServiceType, string> = {
  moyka: 'Moyka',
  rezka: 'Rezka',
  other: 'Boshqa',
}

export interface Category {
  id: string
  name_uz: string
}

export interface Counterparty {
  id: string
  name: string
  kind: 'receiver' | 'customer'
  owner_id: string | null
}

export interface ExpenseRow {
  id: string
  amount: number
  payment_date: string
  period_month: string
  category_id: string | null
  counterparty_id: string | null
  source_account_id: string
  expense_type: ExpenseType
  note: string | null
  receipt_path: string | null
  recurring_expense_id: string | null
  status: 'pending' | 'confirmed'
  voided_at: string | null
  created_at: string
}

export interface CashInRow {
  id: string
  amount: number
  received_date: string
  period_month: string
  customer_id: string
  service_type: ServiceType
  destination_account_id: string
  note: string | null
  voided_at: string | null
  created_at: string
}

export interface TransferRow {
  id: string
  amount: number
  transfer_date: string
  source_account_id: string
  destination_account_id: string
  note: string | null
  voided_at: string | null
  created_at: string
}

export interface RecurringRow {
  id: string
  counterparty_id: string
  category_id: string | null
  source_account_id: string
  monthly_amount: number
  day_of_month: number
  expense_type: 'recurring_required' | 'recurring_optional'
  note: string | null
  is_active: boolean
}

export function invalidateFinance(): void {
  queryClient.invalidateQueries({ queryKey: ['fin'] })
}

// ------------------------------------------------------------------ reads

export function useCategories() {
  const { data, error } = useQuery({
    queryKey: queryKeys.finCategories(),
    queryFn: async ({ signal }) =>
      ((await run(
        supabase.from('expense_categories').select('id, name_uz').eq('is_active', true).order('name_uz').abortSignal(signal),
      )) as Category[] | null) ?? [],
  })
  return { categories: data ?? [], error: error ? error.message : null }
}

export function useCounterparties(kind: 'receiver' | 'customer') {
  const { data, error } = useQuery({
    queryKey: queryKeys.finCounterparties(kind),
    queryFn: async ({ signal }) =>
      ((await run(
        supabase.from('counterparties').select('id, name, kind, owner_id').eq('kind', kind).order('name').abortSignal(signal),
      )) as Counterparty[] | null) ?? [],
  })
  return { counterparties: data ?? [], error: error ? error.message : null }
}

/** period_month → 'closed' | 'reopened' (months with no events are open and absent). */
export function usePeriodStatuses() {
  const { data } = useQuery({
    queryKey: queryKeys.finPeriodStatus(),
    queryFn: async ({ signal }) => {
      const rows = ((await run(supabase.from('period_status').select('period_month, status').abortSignal(signal))) as
        | { period_month: string; status: 'closed' | 'reopened' }[]
        | null) ?? []
      return new Map(rows.map((r) => [r.period_month, r.status]))
    },
  })
  return data ?? new Map<string, 'closed' | 'reopened'>()
}

/** `${period_month}:${service}` → rate per kg (numeric(12,2) comes back as a string or number). */
export function useMonthlyRates() {
  const { data } = useQuery({
    queryKey: queryKeys.finRates(),
    queryFn: async ({ signal }) => {
      const rows = ((await run(
        supabase.from('monthly_rates').select('period_month, service_type, rate_per_kg').abortSignal(signal),
      )) as { period_month: string; service_type: string; rate_per_kg: number | string }[] | null) ?? []
      return new Map(rows.map((r) => [`${r.period_month}:${r.service_type}`, Number(r.rate_per_kg)]))
    },
  })
  return data ?? new Map<string, number>()
}

/** Non-voided expenses whose period is on/after `sinceMonth` (pending included; callers filter). */
export function useExpenses(sinceMonth: string) {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.finExpenses(sinceMonth),
    queryFn: async ({ signal }) =>
      ((await run(
        supabase
          .from('expenses')
          .select(
            'id, amount, payment_date, period_month, category_id, counterparty_id, source_account_id, expense_type, note, receipt_path, recurring_expense_id, status, voided_at, created_at',
          )
          .is('voided_at', null)
          .gte('period_month', sinceMonth)
          .order('payment_date', { ascending: false })
          .order('created_at', { ascending: false })
          .abortSignal(signal),
      )) as ExpenseRow[] | null) ?? [],
  })
  return { expenses: data ?? [], loading: isPending, error: error ? error.message : null }
}

export function useCashIns(sinceMonth: string) {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.finCashIns(sinceMonth),
    queryFn: async ({ signal }) =>
      ((await run(
        supabase
          .from('cash_ins')
          .select('id, amount, received_date, period_month, customer_id, service_type, destination_account_id, note, voided_at, created_at')
          .is('voided_at', null)
          .gte('period_month', sinceMonth)
          .order('received_date', { ascending: false })
          .order('created_at', { ascending: false })
          .abortSignal(signal),
      )) as CashInRow[] | null) ?? [],
  })
  return { cashIns: data ?? [], loading: isPending, error: error ? error.message : null }
}

/** Transfers have no period: filtered by transfer_date on/after the first of `sinceMonth`. */
export function useTransfers(sinceMonth: string) {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.finTransfers(sinceMonth),
    queryFn: async ({ signal }) =>
      ((await run(
        supabase
          .from('transfers')
          .select('id, amount, transfer_date, source_account_id, destination_account_id, note, voided_at, created_at')
          .is('voided_at', null)
          .gte('transfer_date', sinceMonth)
          .order('transfer_date', { ascending: false })
          .order('created_at', { ascending: false })
          .abortSignal(signal),
      )) as TransferRow[] | null) ?? [],
  })
  return { transfers: data ?? [], loading: isPending, error: error ? error.message : null }
}

export function useRecurring() {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.finRecurring(),
    queryFn: async ({ signal }) =>
      ((await run(
        supabase
          .from('recurring_expenses')
          .select('id, counterparty_id, category_id, source_account_id, monthly_amount, day_of_month, expense_type, note, is_active')
          .order('day_of_month')
          .abortSignal(signal),
      )) as RecurringRow[] | null) ?? [],
  })
  return { recurring: data ?? [], loading: isPending, error: error ? error.message : null }
}

/**
 * Moyka output kg for one owner in one month -- straight from the existing
 * Hisobot engine (report_totals, MOYKADAN direction), not a new calculation
 * (brief: "pull monthly_kg from existing Hisobot data, don't duplicate").
 */
export function useMoykaOutputKg(ownerId: string | null, month: string) {
  const { data, isPending } = useQuery({
    queryKey: queryKeys.finMoykaKg(ownerId ?? '', month),
    enabled: !!ownerId,
    queryFn: async ({ signal }) => {
      const rows = await callRpc<{ total_kg_from_moyka: number | string }[]>(
        'report_totals',
        {
          p_directions: ['moyka_output'],
          p_from: month,
          p_to: monthEnd(month),
          p_owner_id: ownerId,
          p_type_id: null,
          p_calibre_id: null,
          p_serial: null,
          p_barcode2: null,
          p_plate: null,
          p_driver: null,
          p_wash_cycle: null,
          p_lab_verdict: null,
          p_status: null,
          p_partiya_no: null,
        },
        signal,
      )
      return Number(rows?.[0]?.total_kg_from_moyka ?? 0)
    },
  })
  return { kg: data ?? null, loading: !!ownerId && isPending }
}

// ------------------------------------------------------------------ writes

async function audit(table: string, rowId: string, actor: string | undefined, action: string, before: unknown, after: unknown) {
  await run(supabase.from('audit_log').insert({ table_name: table, row_id: rowId, actor, action, before, after }))
}

// RLS turns a forbidden UPDATE into "0 rows", not an error.
function requireRow(rows: unknown): void {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("Yozuv topilmadi yoki ruxsat yo'q.")
}

export async function createCategory(name: string): Promise<Category> {
  const row = await run(supabase.from('expense_categories').insert({ name_uz: name.trim() }).select('id, name_uz').single())
  invalidateFinance()
  return row as Category
}

export async function createCounterparty(name: string, kind: 'receiver' | 'customer'): Promise<Counterparty> {
  const row = await run(
    supabase.from('counterparties').insert({ name: name.trim(), kind }).select('id, name, kind, owner_id').single(),
  )
  invalidateFinance()
  return row as Counterparty
}

export async function createUtilityAccount(name: string, supplier: string): Promise<{ id: string }> {
  const row = await run(
    supabase.from('accounts').insert({ name_uz: name.trim(), kind: 'utility', supplier_name: supplier.trim() || null }).select('id').single(),
  )
  invalidateFinance()
  return row as { id: string }
}

/** Receipt or contract file → object key in buxgalteriya-files. Images are compressed like every photo in the app. */
export async function uploadFinanceFile(file: File, folder: 'expenses'): Promise<string> {
  let body: Blob = file
  let ext = (file.name.split('.').pop() || 'bin').toLowerCase()
  if (file.type.startsWith('image/')) {
    try {
      body = (await compressImage(file)).blob
      ext = 'jpg'
    } catch {
      // Same fallback as KirimForm: keep the original if compression fails.
    }
  }
  const path = `${folder}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('buxgalteriya-files').upload(path, body, {
    contentType: ext === 'jpg' ? 'image/jpeg' : file.type || undefined,
  })
  if (error) throw new Error(error.message)
  return path
}

export interface ExpenseInput {
  amount: number
  payment_date: string
  period_month: string
  category_id: string | null
  counterparty_id: string | null
  source_account_id: string
  expense_type: ExpenseType
  note: string | null
  receipt_path: string | null
}

export async function createExpense(input: ExpenseInput): Promise<void> {
  await run(supabase.from('expenses').insert({ ...input, status: 'confirmed' }))
  invalidateFinance()
}

/** Edit (also used to confirm a pending auto-post: pass status 'confirmed'). */
export async function updateExpense(
  before: ExpenseRow,
  patch: Partial<ExpenseInput> & { status?: 'confirmed' },
  actor: string | undefined,
): Promise<void> {
  requireRow(await run(supabase.from('expenses').update(patch).eq('id', before.id).select('id')))
  const changedBefore = Object.fromEntries(Object.keys(patch).map((k) => [k, before[k as keyof ExpenseRow]]))
  await audit('expenses', before.id, actor, patch.status === 'confirmed' && before.status === 'pending' ? 'confirm' : 'edit', changedBefore, patch)
  invalidateFinance()
}

export async function voidFinanceRow(
  table: 'expenses' | 'cash_ins' | 'transfers',
  row: { id: string; amount: number },
  reason: string,
  actor: string | undefined,
): Promise<void> {
  if (!reason.trim()) throw new Error('Sababini yozing.')
  requireRow(
    await run(
      supabase.from(table).update({ voided_at: new Date().toISOString(), voided_by: actor, void_reason: reason.trim() }).eq('id', row.id).select('id'),
    ),
  )
  await audit(table, row.id, actor, 'void', { amount: row.amount }, { void_reason: reason.trim() })
  invalidateFinance()
}

export interface CashInInput {
  amount: number
  received_date: string
  period_month: string
  customer_id: string
  service_type: ServiceType
  destination_account_id: string
  note: string | null
}

export async function createCashIn(input: CashInInput): Promise<void> {
  await run(supabase.from('cash_ins').insert(input))
  invalidateFinance()
}

export interface TransferInput {
  amount: number
  transfer_date: string
  source_account_id: string
  destination_account_id: string
  note: string | null
}

export async function createTransfer(input: TransferInput): Promise<void> {
  await run(supabase.from('transfers').insert(input))
  invalidateFinance()
}

export interface RecurringInput {
  counterparty_id: string
  category_id: string | null
  source_account_id: string
  monthly_amount: number
  day_of_month: number
  expense_type: 'recurring_required' | 'recurring_optional'
  note: string | null
}

export async function saveRecurring(input: RecurringInput, existing: RecurringRow | null, actor: string | undefined): Promise<void> {
  if (existing) {
    requireRow(await run(supabase.from('recurring_expenses').update({ ...input, updated_at: new Date().toISOString() }).eq('id', existing.id).select('id')))
    await audit('recurring_expenses', existing.id, actor, 'edit', existing, input)
  } else {
    await run(supabase.from('recurring_expenses').insert(input))
  }
  invalidateFinance()
}

export async function setRecurringActive(row: RecurringRow, active: boolean, actor: string | undefined): Promise<void> {
  requireRow(await run(supabase.from('recurring_expenses').update({ is_active: active, updated_at: new Date().toISOString() }).eq('id', row.id).select('id')))
  await audit('recurring_expenses', row.id, actor, active ? 'activate' : 'deactivate', { is_active: row.is_active }, { is_active: active })
  invalidateFinance()
}

export async function signedFinanceFileUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('buxgalteriya-files').createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}
