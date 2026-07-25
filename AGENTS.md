<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# grantbase — agent orientation

A multi-tenant local grant discovery + application platform. Browse a shared
catalog of grants, save/apply as yourself or a managed client. Currently a
local-only prototype (no deploy yet).

## Stack & tooling (deliberate choices — don't swap them)

- **Bun** — package manager *and* script runtime. Use `bun add`, `bun run`, `bunx`.
  Not npm/yarn/pnpm. Bun auto-loads `.env.local`.
- **Biome** — lint + format (replaces ESLint/Prettier). 2-space indent, double quotes,
  organize-imports on. `bun run lint` / `bun run lint:fix`. Config in `biome.json`
  (scoped to `src/**` and `scripts/**`; shadcn `ui/` is excluded).
- **Supabase** local, in Docker via **OrbStack** (`docker context use orbstack` if the
  socket goes stale). Postgres + Auth + RLS.
- **shadcn/ui** built on **@base-ui/react (NOT Radix)** — API differs: `Select`'s
  `onValueChange` yields `string | null`; `Button` uses a `render` prop, not `asChild`.
- **Tailwind v4** (`@theme inline`, `@custom-variant`, `@apply` in `src/app/globals.css`).
- **Geist** font via the self-hosted `geist` npm package, not `next/font/google`.

## Local setup essentials

- Ports are **shifted +1000** to avoid colliding with other local Supabase projects:
  API `55321`, DB `55322`, Studio `55323`. See `supabase/config.toml`.
- `.env.local` holds `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  and `SUPABASE_SECRET_KEY`. **The secret key bypasses RLS — server-only, never import
  it into a Client Component or ship it to the browser.** Only `scripts/ingest/` uses it.
- Common commands:
  ```bash
  bunx supabase start|stop|status      # local stack (OrbStack must be running)
  bunx supabase db reset               # rebuild schema from migrations + run seed.sql
  bun dev                              # Next dev server on :3000
  bun run ingest --source=<name>       # run a data ingestion adapter (see docs/INGESTION.md)
  ```
- To run SQL against local Postgres: `docker exec supabase_db_grantbase psql -U postgres -c "…"`.

## Conventions & gotchas that bite

- **Next 16 renamed `middleware` → `proxy`.** The file is `src/proxy.ts`
  (`export function proxy(request)`), Node runtime only. Same `config.matcher`.
- **`src/` layout** is forced; `@/*` → `./src/*`. `params`, `searchParams`, and
  `cookies()` are **async — await them.**
- **Reads = Server Components; writes = Server Actions.** Interactive shadcn controls
  live in thin `"use client"` components (`grant-filters`, `apply-form`).
- **Auth:** `@supabase/ssr`. Server client in `src/lib/supabase/server.ts`, browser
  client in `client.ts`, session refresh in `src/lib/supabase/middleware.ts` (called
  from `proxy.ts`). Signup creates a self-`applicant`; `owner_id` is always stamped from
  the session, never trusted from the client.

## Database — declarative schema (important workflow)

- **Never hand-write migrations.** Desired-state DDL lives in `supabase/schemas/*.sql`
  (numeric-prefixed, run in lexicographic order for FK deps). Migrations are *generated*:
  ```bash
  bunx supabase stop
  bunx supabase db diff -f <descriptive_name>   # diffs schemas/ → migrations/
  bunx supabase start
  bunx supabase db reset                         # verify it applies clean
  ```
  Append new columns at the end of a table to keep diffs clean.
- **RLS gotcha:** an RLS *policy* is not enough — recent Supabase defaults don't grant
  base-table privileges, so every table also needs explicit `grant …` (see
  `schemas/12_grants.sql`). Symptom of a missing grant: `permission denied for table X`.
- The diff tool does **not** capture `alter policy`, column privileges, comments, or DML
  (seed data). Seed is `supabase/seed.sql` (currently empty — data comes from ingestion).
- **Multi-tenancy model:** shared catalog (`foundations`/`grants`/`past_awards`) is
  world-readable, written only via the secret key. Tenant-private
  (`applicants`/`applications`/`saved_grants`) carries `owner_id = auth.uid()`; RLS makes
  rows invisible across tenants.

## Data ingestion (§5)

Standalone Bun scripts under `scripts/ingest/` load real Canadian arts data into the
catalog. **Read `docs/INGESTION.md` before touching this** — it documents the adapter
contract, the source-data boundary (APIs give *historical awards*; open *opportunities*
have no API and need scraping), and a hard-won rule: **never paginate without a
total-order sort** (a unique tiebreaker), or you get silent under-counts / non-convergence.

## Where things live / docs map

- `src/app/` — routes (`grants/`, `login/`), `layout.tsx`, Server Actions in `actions.ts`.
- `src/components/` — `site-header`, `grant-filters`, `apply-form`; `ui/` is shadcn (unlinted).
- `src/lib/supabase/` — server/browser/middleware clients.
- `supabase/schemas/` — declarative DDL · `supabase/migrations/` — generated · `supabase/seed.sql`.
- `scripts/ingest/` — ingestion pipeline.
- `docs/PLAN.md` — original build plan (§1–§5). `docs/INGESTION.md` — ingestion reference.
- Agent memory (preferences, ports, data-source boundary) lives outside the repo in the
  Claude Code project memory; it's surfaced automatically when relevant.
