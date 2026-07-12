# BATU EXPORT — Ombor & Logistika App

Offline-first PWA for BATU EXPORT's toll-processing warehouse and logistics operations. See `docs/SPEC.md` for the full design spec and `docs/PHASE0.md` for the launch plan.

## Stack

- Vite + React + TypeScript
- Tailwind CSS (v4, `@tailwindcss/vite`)
- Supabase (Postgres + Auth + Storage), client configured from `VITE_` env vars
- `vite-plugin-pwa` for offline support
- Netlify (auto-deploy + SPA redirect)

## Setup

```bash
npm install
cp .env.example .env   # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — typecheck + production build
- `npm run preview` — preview the production build
- `npm run lint` — oxlint

## Deployment

Netlify builds `main` using `netlify.toml` (`npm run build`, publish `dist`). Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Netlify environment variables — never commit `.env`.
