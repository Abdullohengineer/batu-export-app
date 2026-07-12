-- Phone-based login (docs/DECISIONS.md — "Auth method"). Auth itself still
-- runs on Supabase email/password with a synthesized <phone>@batu.local
-- address; this column is what the admin Edge Function uses to look a user
-- up by the number they actually log in with.
alter table profiles add column phone text unique;
