# Bid Consolidator

Sourcing tool for Shalom International: build a product sheet from CADs or a
sorted Excel, invite factories to quote through private portal links, compare
every factory's offer side by side, pick winners, and run landed-cost math.

- **Build** a project's item list on the **Compare** sheet — upload CADs (AI
  splits multi-product sheets into items) or import a structured Excel (style,
  specs, MOQ, target price and embedded photos are read automatically).
- **Invite** factories from a shared, division-organized directory. Each gets a
  private link; they see our items (never our target price or other factories'
  quotes) and enter price / MOQ / lead time, which autosaves.
- **Compare**: every factory's offer appears under each product, lowest price
  highlighted, drafts flagged until the factory submits. Owners can also upload
  a factory's emailed Excel quote; rows are matched to items automatically and
  anything uncertain is held for manual placement.
- **Decide**: pick a winner per item; landed cost, margin and IMU are computed
  server-side from org/project constants.
- **Follow up**: invitation, reminder and Best & Final emails are drafted
  automatically (Best & Final tells each factory how far above the best FOB it
  is). Send through the server or copy into your own mail client.

## Stack

| | |
|---|---|
| Backend | Node 22+, TypeScript (strict), Express 5, PostgreSQL, zod, pino — `backend/` |
| Frontend | React 18, TypeScript, React Router 7, TanStack Query, Vite — `frontend/` |
| Infra | Supabase (Postgres + Storage), Render (API), Vercel (web) |
| Quality | Vitest (unit + API integration on real Postgres), ESLint, GitHub Actions CI |

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for how it fits together and
**[DEPLOY.md](DEPLOY.md)** for production setup.

## Local development

Prerequisites: Node 22+, PostgreSQL 14+ running locally.

```bash
# Backend (http://localhost:4000)
cd backend
cp .env.example .env           # set JWT_SECRET; leave DATABASE_URL empty to use local Postgres
createdb bid_consolidator
npm install
npm run dev                    # applies migrations on start, then watches for changes

# Frontend (http://localhost:5173) — proxies /api and /ws to the backend
cd frontend
npm install
npm run dev
```

First account: set `ALLOWED_SIGNUP_DOMAINS=yourcompany.com` in `backend/.env`,
then sign up at http://localhost:5173/admin — or bootstrap an admin:

```bash
cd backend && SEED_ADMIN_EMAIL=you@yourcompany.com INTERNAL_PASSWORD='a-long-password' npm run seed
```

## Checks

```bash
cd backend  && npm run lint && npm run typecheck && npm test     # tests need local Postgres
cd frontend && npm run lint && npm run typecheck && npm test && npm run build
```

Backend integration tests create and migrate a throwaway database
(`bid_consolidator_vitest`); override its connection with `TEST_DB_HOST`,
`TEST_DB_USER`, `TEST_DB_PASSWORD`. CI runs everything on every push.

## Routes

| Path | Who | What |
|---|---|---|
| `/admin` | staff | Sign in / sign up / accept invite |
| `/app` | staff | Projects |
| `/app/projects/:id/compare` · `factories` · `emails` · `landed-cost` | staff | A project |
| `/app/links` · `/app/settings` | staff | All portal links · directory, account, org admin |
| `/vendor?token=…` | factories | The quoting portal (link emailed to them) |

## Repository layout

```
backend/
  migrations/        versioned SQL migrations (node-pg-migrate)
  src/
    config.ts        validated environment
    app.ts server.ts express app · process entry (migrate, http, ws, workers)
    lib/             storage, signed file URLs, jobs, realtime, auth, errors, validation
    domain/          pure business logic: Excel parsing, matching, CAD vision, landed cost, emails
    modules/         HTTP routes (+ repos) per area: auth, org, projects, items, quotes, factories, portal, emails, …
  test/              unit + integration tests
frontend/
  src/api/           typed client, DTO types, React Query hooks
  src/pages/         screens (project pages under pages/project/)
  src/components/    shared UI, feedback (toasts/confirm), job watcher
  src/lib/           auth session, realtime, formatting, clipboard
*/legacy-v1/         the previous JavaScript implementation, kept for reference
```
