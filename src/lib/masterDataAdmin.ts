import { supabase } from './supabase'

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

// §2.15 "Never DELETE — void": master data is deactivated, never removed.
// One shared shape (id + active) covers owners/product_categories/
// product_types/calibres alike.
export async function setActive(table: 'owners' | 'product_categories' | 'product_types' | 'calibres', id: string, active: boolean) {
  const { error } = await supabase.from(table).update({ active }).eq('id', id)
  return { error: friendlyDbError(error) }
}

export async function renameRow(table: 'owners' | 'product_categories' | 'product_types', id: string, name: string) {
  const { error } = await supabase.from(table).update({ name }).eq('id', id)
  return { error: friendlyDbError(error) }
}

export async function createOwner(name: string) {
  const { error } = await supabase.from('owners').insert({ name })
  return { error: friendlyDbError(error) }
}

export async function createProductCategory(name: string, calibreApplies: boolean) {
  const { error } = await supabase.from('product_categories').insert({ name, calibre_applies: calibreApplies })
  return { error: friendlyDbError(error) }
}

export async function createProductType(name: string, categoryId: string) {
  const { error } = await supabase.from('product_types').insert({ name, category_id: categoryId })
  return { error: friendlyDbError(error) }
}

export async function createCalibre(label: string, code: string, categoryId: string, isNumberless: boolean, sortOrder: number) {
  const { error } = await supabase
    .from('calibres')
    .insert({ label, code, category_id: categoryId, is_numberless: isNumberless, sort_order: sortOrder })
  return { error: friendlyDbError(error) }
}

export async function renameCalibre(id: string, label: string) {
  const { error } = await supabase.from('calibres').update({ label }).eq('id', id)
  return { error: friendlyDbError(error) }
}

export async function setThreshold(key: string, value: number | null) {
  const { error } = await supabase.from('settings_limits').update({ value }).eq('key', key)
  return { error: friendlyDbError(error) }
}
