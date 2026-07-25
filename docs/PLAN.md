# grantbase — Build Plan

A multi-tenant local grant discovery and application platform. This plan takes the project
from empty repo to a testable local prototype, then outlines sourcing real grant data.

---

## 0. TL;DR on the stack

**Yes — Next.js (App Router) + Supabase is the right call for a solo dev building a testable local prototype.** The deciding factor is that the multi-tenancy requirement maps almost perfectly onto Postgres Row-Level Security (RLS), which Supabase gives you locally with zero server code. You get Postgres + Auth + auto-generated APIs + RLS running in Docker via one command, and the same stack deploys to production unchanged.

**Tooling for this build:** **Bun** (package manager + runtime), **Biome** (lint + format, replacing ESLint/Prettier), **OrbStack** (Docker-compatible container runtime), and **shadcn/ui** (component system on top of Tailwind).

**Constraints to be aware of (none disqualifying):**
- Local Supabase needs a Docker-compatible runtime. **OrbStack** provides this on macOS (lighter and faster than Docker Desktop) — the Supabase CLI talks to its Docker socket transparently, no config needed. If you can't run a container runtime at all, fall back to a plain local Postgres — but you lose the free auth/RLS layer.
- RLS has a real learning curve. The mitigation is the clean "shared catalog vs. tenant-private" split below — once you internalize it, policies are 3 lines each.
- Supabase's generated REST/GraphQL is fine for reads; for anything transactional (submitting an application) use **Next.js Server Actions**.
- shadcn's `Select` is Radix-based and interactive, so any form using it must be a Client Component. The §4 scaffolding isolates that into small `"use client"` components (`GrantFilters`, `ApplyForm`) while keeping data-fetching pages as Server Components.

The one architectural insight that drives the whole design: **grants/foundations/past-awards are shared reference data every tenant sees identically; only applicant profiles, applications, and saved grants are tenant-private.** That's a hybrid multi-tenant model, not pure per-tenant isolation.

---

## 1. Local environment setup

```bash
# 1. Scaffold the Next.js app with Bun (skip ESLint — Biome handles lint/format)
bun create next-app@latest grantbase --typescript --app --tailwind --no-eslint --src-dir=false --use-bun
cd grantbase

# 2. Lint + format: Biome (replaces ESLint + Prettier)
bun add -d --exact @biomejs/biome
bunx biome init          # creates biome.json; run checks with `bunx biome check .`

# 3. Add Supabase tooling + client libs
bun add @supabase/supabase-js @supabase/ssr
bun add -d supabase

# 4. Add shadcn/ui and the components used in section 4
bunx shadcn@latest init
bunx shadcn@latest add button input select card badge

# 5. Initialize and start local Supabase
#    (OrbStack must be running — it provides the Docker socket the CLI uses)
bunx supabase init
bunx supabase start
```

**Fully ESLint-free.** Next.js never requires ESLint — with `--no-eslint` and no ESLint config present, `next build` skips linting entirely. Point the `lint` script at Biome:

```jsonc
// package.json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "lint": "biome check .",
  "lint:fix": "biome check --write .",
  "format": "biome format --write ."
}
```

Trade-off: Biome covers formatting, JS/TS lint, import sorting, React Hooks rules (`useExhaustiveDependencies`, `useHookAtTopLevel`), and a11y — but **not** the Next-specific rules from `@next/eslint-plugin-next` (e.g. "use `next/image` over `<img>`", "use `<Link>` for internal navigation", `no-sync-scripts`). Those are best-practice/perf nudges, not correctness checks; TypeScript, Next's dev-mode warnings, and code review cover the cases that matter. No official Biome port of those rules exists yet, so going fully Biome means forgoing them.

`supabase start` prints your local credentials. Put them in `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key from `supabase start` output>
SUPABASE_SECRET_KEY=<secret key from `supabase start` output>   # server-only, never expose
```

Local Studio (a full DB GUI) runs at `http://127.0.0.1:54323`. Schema goes in `supabase/schemas/` (declarative — see §2), seed data in `supabase/seed.sql`; you *generate* migrations with `db diff`, then `bunx supabase db reset` rebuilds the DB from those migrations and reseeds in one shot.

---

## 2. Schema design

**Managed declaratively.** The schema is the *desired end state*, declared in `.sql` files under `supabase/schemas/` — you never hand-write files in `supabase/migrations/`. Migrations are **generated** by diffing the declared schema against the database (workflow at the end of this section). Files run in **lexicographic order**, so numeric prefixes handle foreign-key dependencies (foundations before grants, etc.), and new columns get appended to the end of a table to keep diffs clean.

Split the DDL below across these files (the single block that follows is just the concatenation, already in dependency order):

| File | Contents |
|---|---|
| `01_extensions.sql` | `pgcrypto` |
| `02_enums.sql` | the four enum types |
| `03_functions.sql` | `set_updated_at()` |
| `04_foundations.sql` | `foundations` + indexes |
| `05_grants.sql` | `grants` + indexes (FK → foundations) |
| `06_past_awards.sql` | `past_awards` + index (FK → grants) |
| `07_applicants.sql` | `applicants` + index |
| `08_applications.sql` | `applications` + indexes (FK → applicants, grants) |
| `09_saved_grants.sql` | `saved_grants` + index |
| `10_triggers.sql` | the `updated_at` triggers |
| `11_rls.sql` | `enable row level security` + `create policy` statements |

**Caveat that matters here:** the diff tool captures `create policy` fine, but **not** `alter policy`, column privileges, or comments. If you later need to *alter* a policy, do it as a hand-written versioned migration rather than editing the schema file. (Seed data is DML — also not captured — see §3.)

**Multi-tenancy model:**
- **Shared catalog** (`foundations`, `grants`, `past_awards`): RLS on, `select` open to everyone, writes only via the secret key (which bypasses RLS — that's your ingestion pipeline's key).
- **Tenant-private** (`applicants`, `applications`, `saved_grants`): every row carries `owner_id = auth.uid()`, and RLS makes rows invisible across tenants. A user never sees another user's clients or applications.
- **"Apply on behalf of self or a client"**: a `User` (auth account) owns many `applicants`. One is flagged `is_self`; the rest are clients. Applications link an *applicant* to a *grant*, so the same account can apply as itself or for any client it manages.

```sql
create extension if not exists pgcrypto;

-- ---------- Enums ----------
create type eligibility_type   as enum ('individual','organization','both');
create type grant_status       as enum ('open','closed','rolling');
create type applicant_type     as enum ('individual','organization');
create type application_status as enum ('draft','submitted','under_review','awarded','rejected','withdrawn');

-- ---------- updated_at helper ----------
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

-- ================= SHARED CATALOG =================
create table foundations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  description   text,
  website       text,
  contact_email text,
  contact_phone text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table grants (
  id                  uuid primary key default gen_random_uuid(),
  foundation_id       uuid not null references foundations(id) on delete cascade,
  title               text not null unique,
  description         text,
  award_min           numeric(12,2),
  award_max           numeric(12,2),
  eligibility         eligibility_type not null default 'both',
  application_deadline date,
  status              grant_status not null default 'open',
  -- ingestion/freshness metadata (used in section 5)
  source              text,          -- e.g. 'grants.gov', 'propublica', 'manual'
  source_external_id  text,          -- id in the source system, for upserts
  last_seen_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint amount_range_valid
    check (award_max is null or award_min is null or award_max >= award_min),
  unique (source, source_external_id)
);
create index grants_foundation_idx  on grants (foundation_id);
create index grants_status_idx      on grants (status);
create index grants_eligibility_idx on grants (eligibility);
create index grants_deadline_idx    on grants (application_deadline);

create table past_awards (
  id           uuid primary key default gen_random_uuid(),
  grant_id     uuid not null references grants(id) on delete cascade,
  winner_name  text not null,
  winner_type  applicant_type not null,
  award_date   date,
  award_amount numeric(12,2),
  notes        text,
  created_at   timestamptz not null default now()
);
create index past_awards_grant_idx on past_awards (grant_id);

-- ================= TENANT-PRIVATE =================
create table applicants (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  type         applicant_type not null,
  display_name text not null,
  is_self      boolean not null default false,   -- true = the account holder; false = a managed client
  email        text,
  phone        text,
  bio          text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index applicants_owner_idx on applicants (owner_id);

create table applications (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  applicant_id uuid not null references applicants(id) on delete cascade,
  grant_id     uuid not null references grants(id)     on delete cascade,
  status       application_status not null default 'draft',
  submitted_at timestamptz,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (applicant_id, grant_id)                       -- one application per applicant per grant
);
create index applications_owner_idx on applications (owner_id);
create index applications_grant_idx on applications (grant_id);

create table saved_grants (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  grant_id   uuid not null references grants(id)     on delete cascade,
  created_at timestamptz not null default now(),
  unique (owner_id, grant_id)
);
create index saved_grants_owner_idx on saved_grants (owner_id);

-- updated_at triggers
create trigger t_foundations_upd  before update on foundations  for each row execute function set_updated_at();
create trigger t_grants_upd       before update on grants       for each row execute function set_updated_at();
create trigger t_applicants_upd   before update on applicants   for each row execute function set_updated_at();
create trigger t_applications_upd before update on applications for each row execute function set_updated_at();

-- ================= ROW-LEVEL SECURITY =================
alter table foundations  enable row level security;
alter table grants       enable row level security;
alter table past_awards  enable row level security;
alter table applicants   enable row level security;
alter table applications enable row level security;
alter table saved_grants enable row level security;

-- Catalog: world-readable, writes only via the secret key (which bypasses RLS)
create policy catalog_read_foundations on foundations for select using (true);
create policy catalog_read_grants      on grants      for select using (true);
create policy catalog_read_awards      on past_awards for select using (true);

-- Tenant data: you only ever touch your own rows
create policy own_applicants on applicants
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy own_applications on applications
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy own_saved on saved_grants
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
```

**Why `past_awards` denormalizes the winner** rather than FK-ing to `applicants`: historical winners are public-record facts, not platform users. Coupling them to tenant accounts would be wrong and would leak across tenants. Keep them as flat catalog data.

**Generate the migration from the declared schema** (never write the migration by hand):

```bash
bunx supabase stop                        # migra diff requires the local stack stopped
bunx supabase db diff -f initial_schema   # diffs supabase/schemas/ → supabase/migrations/<ts>_initial_schema.sql
bunx supabase start
```

Review the generated migration before committing. On later schema changes, edit the files in `supabase/schemas/`, then re-run `stop` → `db diff -f <descriptive_name>` → `start`. To roll back, edit the schema files back to the desired state and generate a fresh diff — then read it carefully for unintended data loss.

---

## 3. Mock data population

Seed data is **DML** (`insert`s), which the schema-diff tool does **not** capture — so it lives in `supabase/seed.sql`, never in `supabase/schemas/`. `supabase db reset` applies the generated migrations and then runs `seed.sql`. It uses `current_date` offsets so "open" grants always have live deadlines and "closed" ones sit in the past — no date maintenance. References use name/title subqueries so it stays readable and order-independent within each block.

```sql
-- ---------- Foundations (5) ----------
insert into foundations (name, description, website, contact_email, contact_phone) values
('Cedar Valley Community Foundation', 'Regional foundation funding neighborhood, small-business, and emergency-relief projects across the Cedar Valley area.', 'https://cedarvalleycf.org',   'grants@cedarvalleycf.org',   '555-0142'),
('The Hartwell Arts Trust',           'Endowed trust supporting individual artists and arts organizations through fellowships, commissions, and operating grants.', 'https://hartwellarts.org',    'apply@hartwellarts.org',     '555-0198'),
('Meridian Health Foundation',        'Health-focused funder backing community clinics, health innovation, and healthcare workforce scholarships.', 'https://meridianhealthfdn.org','info@meridianhealthfdn.org', '555-0173'),
('GreenFuture Environmental Fund',    'Environmental grantmaker funding urban greening, watershed restoration, and sustainable agriculture.', 'https://greenfuturefund.org', 'grants@greenfuturefund.org', '555-0121'),
('TechForward Education Initiative',  'Education funder advancing STEM access, EdTech pilots, and scholarships for first-generation students.', 'https://techforward.org',     'hello@techforward.org',      '555-0160');

-- ---------- Grants (19: mixed status & eligibility) ----------
insert into grants (foundation_id, title, description, award_min, award_max, eligibility, application_deadline, status, source) values
((select id from foundations where name='Cedar Valley Community Foundation'), 'Neighborhood Small Grants Program',       'Micro-grants for grassroots neighborhood improvement projects.',                 500,     5000,   'both',         current_date + 45, 'open',    'manual'),
((select id from foundations where name='Cedar Valley Community Foundation'), 'Local Entrepreneur Microgrant',           'Startup capital for individual local entrepreneurs.',                            1000,    10000,  'individual',   current_date + 90, 'open',    'manual'),
((select id from foundations where name='Cedar Valley Community Foundation'), 'Community Facilities Improvement Fund',   'Capital improvements for community centers and shared facilities.',              10000,   75000,  'organization', current_date - 20, 'closed',  'manual'),
((select id from foundations where name='Cedar Valley Community Foundation'), 'Emergency Relief Fund',                   'Rapid-response relief for individuals and small orgs facing crises.',            250,     2500,   'both',         null,              'rolling', 'manual'),
((select id from foundations where name='The Hartwell Arts Trust'),           'Emerging Artist Fellowship',              'Unrestricted fellowship for early-career individual artists.',                   5000,    25000,  'individual',   current_date + 60, 'open',    'manual'),
((select id from foundations where name='The Hartwell Arts Trust'),           'Arts Organization Operating Grant',       'General operating support for established arts nonprofits.',                     20000,   150000, 'organization', current_date - 10, 'closed',  'manual'),
((select id from foundations where name='The Hartwell Arts Trust'),           'Public Mural Commission',                 'Commissions for public murals by individual artists or collectives.',            3000,    15000,  'both',         current_date + 30, 'open',    'manual'),
((select id from foundations where name='The Hartwell Arts Trust'),           'Performing Arts Touring Grant',           'Travel and production support for touring performing-arts organizations.',       8000,    40000,  'organization', null,              'rolling', 'manual'),
((select id from foundations where name='Meridian Health Foundation'),        'Community Health Innovation Award',       'Funds novel community-health delivery models.',                                  25000,   200000, 'organization', current_date + 75, 'open',    'manual'),
((select id from foundations where name='Meridian Health Foundation'),        'Nursing Scholarship Fund',                'Tuition support for individuals pursuing nursing credentials.',                  2000,    12000,  'individual',   current_date + 120,'open',    'manual'),
((select id from foundations where name='Meridian Health Foundation'),        'Rural Clinic Equipment Grant',            'Medical equipment funding for rural clinics.',                                   15000,   100000, 'organization', current_date - 30, 'closed',  'manual'),
((select id from foundations where name='Meridian Health Foundation'),        'Mental Health Access Grant',              'Expands mental-health services for underserved populations.',                    10000,   60000,  'both',         current_date + 50, 'open',    'manual'),
((select id from foundations where name='GreenFuture Environmental Fund'),    'Urban Greening Grant',                    'Tree-planting, pocket parks, and green infrastructure projects.',                5000,    50000,  'organization', current_date + 40, 'open',    'manual'),
((select id from foundations where name='GreenFuture Environmental Fund'),    'Youth Climate Action Grant',              'Seed funding for youth-led climate projects.',                                   1000,    8000,   'individual',   current_date + 25, 'open',    'manual'),
((select id from foundations where name='GreenFuture Environmental Fund'),    'Watershed Restoration Fund',              'Large-scale watershed and wetland restoration.',                                 30000,   250000, 'organization', current_date - 45, 'closed',  'manual'),
((select id from foundations where name='GreenFuture Environmental Fund'),    'Sustainable Farming Transition Grant',    'Supports farms transitioning to sustainable practices.',                         10000,   80000,  'both',         null,              'rolling', 'manual'),
((select id from foundations where name='TechForward Education Initiative'),  'STEM Classroom Grant',                    'Equipment and curriculum funding for K-12 STEM classrooms.',                     2000,    20000,  'organization', current_date + 35, 'open',    'manual'),
((select id from foundations where name='TechForward Education Initiative'),  'First-Gen Coding Scholarship',            'Bootcamp/degree scholarships for first-generation coding students.',             3000,    15000,  'individual',   current_date + 100,'open',    'manual'),
((select id from foundations where name='TechForward Education Initiative'),  'EdTech Pilot Grant',                      'Pilot funding for classroom EdTech tools.',                                      25000,   120000, 'organization', current_date - 15, 'closed',  'manual');

-- ---------- Past awards (26) ----------
insert into past_awards (grant_id, winner_name, winner_type, award_date, award_amount, notes) values
((select id from grants where title='Community Facilities Improvement Fund'), 'Riverside Community Center',        'organization', current_date - 400, 62000,  'Renovated an aging gymnasium into a multi-use youth space; strong volunteer match.'),
((select id from grants where title='Community Facilities Improvement Fund'), 'Eastside Neighborhood Alliance',    'organization', current_date - 760, 45000,  'Accessibility upgrades to a shared community kitchen.'),
((select id from grants where title='Arts Organization Operating Grant'),     'Cedar Valley Repertory Theatre',    'organization', current_date - 380, 120000, 'Sustained programming through a difficult season; clear audience-growth metrics.'),
((select id from grants where title='Arts Organization Operating Grant'),     'Hartwell Chamber Orchestra',        'organization', current_date - 740, 95000,  'Expanded free community concert series.'),
((select id from grants where title='Emerging Artist Fellowship'),            'Maya Okonkwo',                      'individual',   current_date - 200, 20000,  'Mixed-media series on regional migration; exceptional portfolio.'),
((select id from grants where title='Emerging Artist Fellowship'),            'Daniel Reyes',                      'individual',   current_date - 560, 18000,  'Documentary photography of vanishing farm towns.'),
((select id from grants where title='Emerging Artist Fellowship'),            'Priya Nair',                        'individual',   current_date - 920, 22000,  'Sculptural installation using reclaimed materials.'),
((select id from grants where title='Public Mural Commission'),               'The Collective Brush',              'organization', current_date - 150, 12000,  'Community-designed mural on the transit hub wall.'),
((select id from grants where title='Public Mural Commission'),               'Tomas Vela',                        'individual',   current_date - 500, 9000,   'Solo mural celebrating local Indigenous history.'),
((select id from grants where title='Performing Arts Touring Grant'),         'Northern Lights Dance Company',     'organization', current_date - 120, 32000,  'Six-city regional tour with education workshops.'),
((select id from grants where title='Rural Clinic Equipment Grant'),          'Prairie Health Cooperative',        'organization', current_date - 300, 88000,  'Purchased portable diagnostic equipment for mobile clinics.'),
((select id from grants where title='Rural Clinic Equipment Grant'),          'Valley Ridge Community Clinic',     'organization', current_date - 680, 72000,  'Upgraded lab and imaging capacity serving 4 rural counties.'),
((select id from grants where title='Community Health Innovation Award'),     'OpenCare Telehealth Initiative',    'organization', current_date - 250, 175000, 'Telehealth model reduced no-show rates by 40%.'),
((select id from grants where title='Nursing Scholarship Fund'),              'Aaliyah Bennett',                   'individual',   current_date - 180, 10000,  'Second-career RN candidate; strong community-service record.'),
((select id from grants where title='Nursing Scholarship Fund'),              'Marcus Trent',                      'individual',   current_date - 540, 11000,  'Rural nursing commitment after graduation.'),
((select id from grants where title='Mental Health Access Grant'),            'Bridges Counseling Network',        'organization', current_date - 220, 55000,  'Sliding-scale therapy expansion in underserved zip codes.'),
((select id from grants where title='Urban Greening Grant'),                  'City Roots Coalition',              'organization', current_date - 160, 44000,  '14 pocket parks and 300 street trees in heat-island zones.'),
((select id from grants where title='Watershed Restoration Fund'),            'Clearwater Restoration Trust',      'organization', current_date - 350, 220000, 'Restored 3 miles of degraded streambank; measurable water-quality gains.'),
((select id from grants where title='Watershed Restoration Fund'),            'Meadowbrook Conservancy',           'organization', current_date - 700, 190000, 'Wetland reconstruction restored native waterfowl habitat.'),
((select id from grants where title='Youth Climate Action Grant'),            'Sofia Alvarez',                     'individual',   current_date - 140, 7000,   'Student-led school solar-education program.'),
((select id from grants where title='Youth Climate Action Grant'),            'Jordan Kim',                        'individual',   current_date - 480, 6500,   'Neighborhood composting network founded by a high-schooler.'),
((select id from grants where title='Sustainable Farming Transition Grant'),  'Hollow Creek Farm',                 'organization', current_date - 130, 60000,  'Transitioned 80 acres to no-till regenerative practices.'),
((select id from grants where title='EdTech Pilot Grant'),                    'Lincoln Unified School District',   'organization', current_date - 210, 95000,  'Adaptive-math pilot across 12 classrooms; gains in proficiency scores.'),
((select id from grants where title='STEM Classroom Grant'),                  'Westbrook Middle School',           'organization', current_date - 190, 16000,  'Robotics lab serving 200 students.'),
((select id from grants where title='First-Gen Coding Scholarship'),          'Elena Vasquez',                     'individual',   current_date - 170, 12000,  'First-gen student; completed full-stack bootcamp, now employed.'),
((select id from grants where title='Local Entrepreneur Microgrant'),         'Corner Cup Coffee',                 'organization', current_date - 260, 8000,   'Micro-roastery expansion; created 3 local jobs.');
```

Apply it (after the migration has been generated in §2):

```bash
bunx supabase db reset   # applies generated migrations + seed.sql from scratch
```

---

## 4. Basic application layer

Minimal but functional: browse grants filtered by eligibility / deadline / amount, view detail + past winners, save and apply. Server Components for reads, Server Actions for writes, and **shadcn/ui** for the components. Interactive shadcn controls (`Select`) live in thin Client Components; everything that touches the database stays a Server Component.

**`lib/supabase/server.ts`**
```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function supabaseServer() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => list.forEach(({ name, value, options }) => {
          try { cookieStore.set(name, value, options) } catch {}
        }),
      },
    }
  )
}
```

**`components/grant-filters.tsx`** — Client Component holding the shadcn `Select`/`Input` controls; pushes filter state into the URL (so filters stay shareable/bookmarkable). shadcn's `Select` can't use an empty-string value, so `"any"` is the sentinel:
```tsx
'use client'
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

export function GrantFilters() {
  const router = useRouter()
  const sp = useSearchParams()
  const [eligibility, setEligibility] = useState(sp.get('eligibility') ?? 'any')
  const [status, setStatus]           = useState(sp.get('status') ?? 'any')
  const [minAmount, setMinAmount]     = useState(sp.get('minAmount') ?? '')
  const [byDeadline, setByDeadline]   = useState(sp.get('byDeadline') ?? '')

  function apply() {
    const params = new URLSearchParams()
    if (eligibility !== 'any') params.set('eligibility', eligibility)
    if (status !== 'any')      params.set('status', status)
    if (minAmount)             params.set('minAmount', minAmount)
    if (byDeadline)            params.set('byDeadline', byDeadline)
    router.push(`/grants?${params.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-center gap-3 mb-6">
      <Select value={eligibility} onValueChange={setEligibility}>
        <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="any">Any eligibility</SelectItem>
          <SelectItem value="individual">Individuals</SelectItem>
          <SelectItem value="organization">Organizations</SelectItem>
        </SelectContent>
      </Select>
      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="any">Any status</SelectItem>
          <SelectItem value="open">Open</SelectItem>
          <SelectItem value="rolling">Rolling</SelectItem>
          <SelectItem value="closed">Closed</SelectItem>
        </SelectContent>
      </Select>
      <Input type="number" placeholder="Min award $" className="w-36"
             value={minAmount} onChange={(e) => setMinAmount(e.target.value)} />
      <Input type="date" className="w-44"
             value={byDeadline} onChange={(e) => setByDeadline(e.target.value)} />
      <Button onClick={apply}>Filter</Button>
    </div>
  )
}
```

**`app/grants/page.tsx`** — Server Component: reads filters from the URL, queries, renders with shadcn `Card`/`Badge`:
```tsx
import Link from 'next/link'
import { supabaseServer } from '@/lib/supabase/server'
import { GrantFilters } from '@/components/grant-filters'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const statusVariant = (s: string) =>
  s === 'open' ? 'default' : s === 'closed' ? 'secondary' : 'outline'

export default async function GrantsPage({
  searchParams,
}: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams
  const supabase = await supabaseServer()

  let q = supabase
    .from('grants')
    .select('id, title, eligibility, status, award_min, award_max, application_deadline, foundations(name)')
    .order('application_deadline', { ascending: true, nullsFirst: false })

  // eligibility=individual also surfaces "both"
  if (sp.eligibility === 'individual')   q = q.in('eligibility', ['individual', 'both'])
  if (sp.eligibility === 'organization') q = q.in('eligibility', ['organization', 'both'])
  if (sp.status)      q = q.eq('status', sp.status)
  if (sp.minAmount)   q = q.gte('award_max', Number(sp.minAmount))   // grant can pay at least X
  if (sp.byDeadline)  q = q.lte('application_deadline', sp.byDeadline)

  const { data: grants } = await q

  return (
    <main className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Grants</h1>
      <GrantFilters />

      <div className="space-y-3">
        {grants?.map((g: any) => (
          <Link key={g.id} href={`/grants/${g.id}`} className="block">
            <Card className="transition-colors hover:bg-accent">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  {g.title}
                  <Badge variant={statusVariant(g.status)}>{g.status}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {g.foundations?.name} · {g.eligibility} ·
                ${Number(g.award_min).toLocaleString()}–${Number(g.award_max).toLocaleString()}
                {g.application_deadline && <> · due {g.application_deadline}</>}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  )
}
```

**`components/apply-form.tsx`** — Client Component: shadcn `Select` for choosing which applicant (self or a client) applies, submitting to the Server Action via a synced hidden field:
```tsx
'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { applyToGrant } from '@/app/grants/actions'

type Applicant = { id: string; display_name: string; type: string }

export function ApplyForm({ grantId, applicants }: { grantId: string; applicants: Applicant[] }) {
  const [applicantId, setApplicantId] = useState(applicants[0]?.id ?? '')
  if (!applicants.length) return <p className="text-sm text-muted-foreground">Add an applicant profile to apply.</p>

  return (
    <form action={applyToGrant} className="flex gap-2">
      <input type="hidden" name="grantId" value={grantId} />
      <input type="hidden" name="applicantId" value={applicantId} />
      <Select value={applicantId} onValueChange={setApplicantId}>
        <SelectTrigger className="w-56"><SelectValue placeholder="Choose applicant" /></SelectTrigger>
        <SelectContent>
          {applicants.map((a) => (
            <SelectItem key={a.id} value={a.id}>{a.display_name} ({a.type})</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="submit">Apply</Button>
    </form>
  )
}
```

**`app/grants/[id]/page.tsx`** — Server Component: detail + past winners + actions, using shadcn `Card`/`Badge`/`Button`:
```tsx
import { supabaseServer } from '@/lib/supabase/server'
import { saveGrant } from '../actions'
import { ApplyForm } from '@/components/apply-form'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const statusVariant = (s: string) =>
  s === 'open' ? 'default' : s === 'closed' ? 'secondary' : 'outline'

export default async function GrantDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await supabaseServer()

  const { data: grant } = await supabase
    .from('grants')
    .select('*, foundations(name, website, contact_email)')
    .eq('id', id).single()

  const { data: winners } = await supabase
    .from('past_awards')
    .select('winner_name, winner_type, award_date, award_amount, notes')
    .eq('grant_id', id)
    .order('award_date', { ascending: false })

  const { data: { user } } = await supabase.auth.getUser()
  const { data: applicants } = user
    ? await supabase.from('applicants').select('id, display_name, type')
    : { data: [] }

  if (!grant) return <main className="p-6">Grant not found.</main>

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">{grant.title}</h1>
          <Badge variant={statusVariant(grant.status)}>{grant.status}</Badge>
        </div>
        <p className="text-muted-foreground">{grant.foundations?.name}</p>
      </header>
      <p>{grant.description}</p>
      <div className="text-sm text-muted-foreground">
        Award: ${Number(grant.award_min).toLocaleString()}–${Number(grant.award_max).toLocaleString()} ·
        Eligibility: {grant.eligibility}
        {grant.application_deadline && <> · Deadline: {grant.application_deadline}</>}
      </div>

      {user ? (
        <div className="flex flex-wrap items-center gap-4">
          <form action={saveGrant}>
            <input type="hidden" name="grantId" value={grant.id} />
            <Button variant="outline" type="submit">☆ Save</Button>
          </form>
          <ApplyForm grantId={grant.id} applicants={applicants ?? []} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Sign in to save or apply.</p>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-2">Past winners</h2>
        {winners?.length ? (
          <div className="space-y-2">
            {winners.map((w, i) => (
              <Card key={i}>
                <CardContent className="pt-4 text-sm">
                  <span className="font-medium">{w.winner_name}</span> ({w.winner_type})
                  {w.award_amount && <> · ${Number(w.award_amount).toLocaleString()}</>}
                  {w.award_date && <> · {w.award_date}</>}
                  {w.notes && <p className="mt-1 text-muted-foreground">{w.notes}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground">No recorded past awards.</p>}
      </section>
    </main>
  )
}
```

**`app/grants/actions.ts`** — Server Actions (UI-library-agnostic; unchanged by the shadcn switch). RLS enforces ownership; `owner_id` is stamped from the session, never trusted from the client:
```ts
'use server'
import { revalidatePath } from 'next/cache'
import { supabaseServer } from '@/lib/supabase/server'

export async function saveGrant(formData: FormData) {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  await supabase.from('saved_grants')
    .upsert({ owner_id: user.id, grant_id: String(formData.get('grantId')) },
            { onConflict: 'owner_id,grant_id' })
  revalidatePath(`/grants/${formData.get('grantId')}`)
}

export async function applyToGrant(formData: FormData) {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const grantId = String(formData.get('grantId'))
  const applicantId = String(formData.get('applicantId'))

  // Optional: enforce eligibility match here before insert.
  await supabase.from('applications')
    .upsert({ owner_id: user.id, applicant_id: applicantId, grant_id: grantId, status: 'draft' },
            { onConflict: 'applicant_id,grant_id' })
  revalidatePath(`/grants/${grantId}`)
}
```

For auth, the fastest path locally is Supabase's email/password with `signInWithPassword`, or magic links. Add a `/login` page later — the catalog browses fine while signed out; only save/apply require a session. Run `bun dev` and hit `http://localhost:3000/grants`.

**One enhancement worth adding early:** an eligibility guard in `applyToGrant` — reject when an `individual` applicant applies to an `organization`-only grant. Enforce it in the action, and optionally as a DB check via a trigger.

---

## 5. Internet data strategy

Once the local loop is proven, source real data in this priority order — free/API-first, scraping last.

**Best public sources (free, structured, legal to use):**

| Source | Coverage | Access |
|---|---|---|
| **Grants.gov Search2 API** | Federal grant opportunities | Free JSON API, no scraping needed |
| **USAspending.gov API** | Historical federal *awards* → your `past_awards` | Free JSON API |
| **ProPublica Nonprofit Explorer API** | Foundation profiles + Form 990 financials → `foundations` | Free JSON API |
| **Candid / Foundation Directory** | Deepest private-foundation grant data | Paid API (add once revenue justifies) |
| **State/city grant portals** | Local grants | Mostly HTML; scrape selectively |
| **Individual foundation sites** | The long tail | Scrape + human curation |

**Recommended blend:** API-first for the sources above (reliable, ToS-clean), **curation** for high-value local foundations (a human-reviewed queue beats brittle scrapers for the long tail), and **scraping only** for structured portals with no API — always checking `robots.txt` and ToS, rate-limiting, and identifying your bot. Never scrape sources with an available API.

**Ingestion pipeline architecture:**
```
Source adapters ──► raw_ingest (staging, JSONB)  ──► normalize ──► upsert into grants/foundations
   (per source)         one row per fetched item        map fields    on (source, source_external_id)
```

1. **Staging table** `raw_ingest(id, source, external_id, payload jsonb, fetched_at)` — land raw responses untouched so you can re-normalize without re-fetching.
2. **One adapter per source** — a function that pulls from the API/page and writes to `raw_ingest`. Isolates source-specific quirks.
3. **Normalizer** maps raw payloads to your schema and **upserts on `(source, source_external_id)`** — the unique constraint already on `grants`. Re-running never duplicates; it updates in place.
4. **Writes use the secret key**, which bypasses RLS — that's exactly why the catalog write policies are locked down.

**Keeping data fresh:**
- `last_seen_at` is stamped on every upsert. A grant not seen in the latest sync of its source is a candidate to auto-mark `closed` (a grant that vanishes from a portal usually closed).
- Flip `status` to `closed` when `application_deadline < current_date` via a nightly job.
- **Schedule** with a Supabase Edge Function on `pg_cron`, or a GitHub Action on a cron trigger hitting your ingestion endpoint. Start daily; most grant data changes slowly.
- Track a `sync_runs` log (source, started_at, items_upserted, errors) so you can see freshness and catch a silently-broken adapter.

Start with **Grants.gov + ProPublica** — together they populate both `grants` and `foundations` with zero scraping and no legal ambiguity, which proves the pipeline before you take on the messier long tail.

---

## Suggested execution order

1. `bun create next-app` + Biome + shadcn init + `bunx supabase start` (OrbStack running) (§1)
2. Declare schema in `supabase/schemas/`, generate the migration (`stop` → `db diff -f initial_schema` → `start`), add `seed.sql`, run `bunx supabase db reset` (§2–3)
3. Add the app files (`GrantFilters`, `ApplyForm`, pages, actions), `bun dev`, browse `/grants` (§4)
4. Add auth + the eligibility guard, exercise save/apply
5. Build the Grants.gov adapter → `raw_ingest` → upsert (§5)
