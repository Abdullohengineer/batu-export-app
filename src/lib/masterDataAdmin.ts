import { supabase } from './supabase'
import { invalidateOwners, invalidateProductCategories, invalidateProductTypes, invalidateCalibres } from './queryClient'

// §3.3 — shared across every master-data admin form (owners/product_
// categories/product_types/calibres): uniform unique-collision handling,
// confirmed with the user to apply across all four tables, not just
// owners.name (the only one the task named explicitly). Postgres reports a
// unique-constraint violation as error code 23505 regardless of which
// constraint tripped — this turns that into a clear Uzbek message instead
// of a raw database error reaching the screen.
export function friendlyDbError(error: { code?: string; message: string } | null): string | null {
  if (!error) return null
  if (error.code === '23505') {
    return 'Bu nom allaqachon mavjud. Boshqa nom tanlang.'
  }
  return error.message
}

// 2026-09-21 (Phase 2 step 1) -- these four hooks now live on React Query
// (useOwners.ts/useProductTypes.ts/useCalibres.ts/useProductCategories.ts,
// staleTime 10min). Every write function below invalidates its table's
// cache on success so every screen holding either includeInactive variant
// re-fetches rather than showing up to 10 minutes of stale master data.
// The admin screens' own `await refetch()` after each of these calls still
// works (React Query's own refetch, unchanged return shape) -- this
// invalidation is what makes every OTHER open tab/screen catch up too, not
// just the one the edit was made on.
const INVALIDATORS: Record<'owners' | 'product_categories' | 'product_types' | 'calibres', () => void> = {
  owners: invalidateOwners,
  product_categories: invalidateProductCategories,
  product_types: invalidateProductTypes,
  calibres: invalidateCalibres,
}

// §2.15 "Never DELETE — void": master data is deactivated, never removed.
// One shared shape (id + active) covers owners/product_categories/
// product_types/calibres alike.
export async function setActive(table: 'owners' | 'product_categories' | 'product_types' | 'calibres', id: string, active: boolean) {
  const { error } = await supabase.from(table).update({ active }).eq('id', id)
  if (!error) INVALIDATORS[table]()
  return { error: friendlyDbError(error) }
}

export async function renameRow(table: 'owners' | 'product_categories' | 'product_types', id: string, name: string) {
  const { error } = await supabase.from(table).update({ name }).eq('id', id)
  if (!error) INVALIDATORS[table]()
  return { error: friendlyDbError(error) }
}

export async function createOwner(name: string) {
  const { error } = await supabase.from('owners').insert({ name })
  if (!error) invalidateOwners()
  return { error: friendlyDbError(error) }
}

export async function createProductCategory(name: string, calibreApplies: boolean) {
  const { error } = await supabase.from('product_categories').insert({ name, calibre_applies: calibreApplies })
  if (!error) invalidateProductCategories()
  return { error: friendlyDbError(error) }
}

export async function createProductType(name: string, categoryId: string) {
  const { error } = await supabase.from('product_types').insert({ name, category_id: categoryId })
  if (!error) invalidateProductTypes()
  return { error: friendlyDbError(error) }
}

export async function createCalibre(label: string, code: string, categoryId: string, isNumberless: boolean, sortOrder: number) {
  const { error } = await supabase
    .from('calibres')
    .insert({ label, code, category_id: categoryId, is_numberless: isNumberless, sort_order: sortOrder })
  if (!error) invalidateCalibres()
  return { error: friendlyDbError(error) }
}

export async function renameCalibre(id: string, label: string) {
  const { error } = await supabase.from('calibres').update({ label }).eq('id', id)
  if (!error) invalidateCalibres()
  return { error: friendlyDbError(error) }
}

export async function setThreshold(key: string, value: number | null) {
  const { error } = await supabase.from('settings_limits').update({ value }).eq('key', key)
  return { error: friendlyDbError(error) }
}
