// Auth uses phone number as login, not email (see docs/DECISIONS.md).
// Supabase Auth still stores an email under the hood — we synthesize one
// from the phone number and never show it to the user.
export function phoneToAuthEmail(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return `${digits}@batu.local`
}
