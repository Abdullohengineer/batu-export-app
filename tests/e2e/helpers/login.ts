import type { Page } from '@playwright/test'

// Shared login helper for the dedicated test-role accounts (CLAUDE.md
// "Testing workflow"). The login screen takes a PHONE NUMBER, not an email
// — phoneToAuthEmail (src/lib/phoneAuth.ts) converts it under the hood, so
// tests type the same "phone" value stored in .env.test, not the derived
// @batu.local address.
export type TestRole = 'RAHBAR' | 'MENEJER' | 'QOROVUL' | 'OMBOR' | 'LABORATOR'

export function testCredentials(role: TestRole): { phone: string; password: string } {
  const phone = process.env[`TEST_${role}_PHONE`]
  const password = process.env[`TEST_${role}_PASSWORD`]
  if (!phone || !password) {
    throw new Error(`Missing TEST_${role}_PHONE/PASSWORD — check .env.test exists (see CLAUDE.md "Testing workflow").`)
  }
  return { phone, password }
}

export async function loginAs(page: Page, role: TestRole): Promise<void> {
  const { phone, password } = testCredentials(role)
  await page.goto('/login')
  await page.getByLabel('Telefon raqami').fill(phone)
  await page.getByLabel('Parol').fill(password)
  await page.getByRole('button', { name: 'Kirish' }).click()
  await page.waitForURL(`**/${role.toLowerCase()}**`)
}
