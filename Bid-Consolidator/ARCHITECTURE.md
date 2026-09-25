# Architecture

## Backend (`backend/src`)

Layers, top to bottom:

| Layer | Responsibility |
|---|---|
| `modules/*/routes.ts` | HTTP: authentication/ownership middleware, zod validation of params/query/body, response shaping (DTOs) |
| `modules/*/repo.ts` | SQL for that area (items, quotes) — one place per query shape |
| `domain/*` | Pure business logic with no I/O: Excel parsing, row→item matching, CAD vision prompts/cropping, landed cost, Best & Final, email templates, division formats |
| `lib/*` | Infrastructure: storage, signed file URLs, job queue, realtime, auth, errors, validation, rate limits, uploads, mail |
| `db/*` | Pool, transaction helper, migration runner |

`config.ts` validates every environment variable at startup. `app.ts` builds the
Express app (used by tests without a port); `server.ts` migrates, listens, and
starts the WebSocket and job workers, and shuts down gracefully on `SIGTERM`.

### Data model

- **organizations** → **users** (role `admin` | `member`), **factories** (the
  org's shared directory, unique per org by lower(name)), **projects**.
- **projects** are private to their creator (`org_id` + `created_by`).
- **project_items** — surrogate `id` is identity; `item_index` is display order,
  allocated under a row lock (no MAX+1 race). Soft-deleted via `deleted_at`.
- **project_factories** — an invitation (project × factory). Everything a
  factory does hangs off it:
  - **vendor_tokens** — portal links (`purpose` quote | revision), single-use to submit, 30-day expiry.
  - **quotes** — FK to the item and to the invitation. The database enforces
    **one quote per (item, factory)** and **one winner per item** (partial unique
    indexes). Rows the matcher couldn't place have `item_id NULL` until assigned.
- **stored_objects** — every file in storage, so deleting a project deletes its files.
- **jobs** — the background queue. **email_log** — what was sent to whom.

Factory *names* are never join keys any more (renaming a factory orphans
nothing), and quotes never rely on row positions.

### Security model

- **Sessions**: JWT (HS256, 8 h) carrying user, org and role. Sign-up is limited
  to an org's email domains or a single-use, email-bound admin invite.
  Login/register are rate-limited; login timing doesn't reveal whether an account exists.
- **Tenancy**: every project route loads the project scoped to the user's org
  *and* ownership, and returns 404 otherwise (ids can't be probed).
- **Factory portal**: the link token (random UUID) is the only credential and
  grants one factory access to one project. Factories never see other quotes or
  the target price.
- **Files**: no id-based file routes. API responses contain signed, expiring URLs
  (`/files/<payload>.<hmac>`); the file route verifies the signature and redirects
  to a short-lived Supabase URL. Uploads are keyed `orgs/<org>/projects/<id>/<kind>/<uuid>`
  and never overwrite.
- **Email**: recipients always come from the factory record on the server — the
  API can't be used to send arbitrary mail.
- **Hardening**: helmet headers, strict CORS, body/upload size limits, zip-bomb
  guard on spreadsheets, patched SheetJS, generic 500s (details only in logs),
  structured logs with secret redaction, CSP on the frontend.

### Background jobs

Excel imports, factory quote uploads, AI CAD detection and storage purges run as
jobs, never inside a request. The queue is a Postgres table claimed with
`FOR UPDATE SKIP LOCKED` (safe with many instances), with retries and backoff,
stale-lock recovery, and per-job progress. Handlers upload files first, then
commit all rows **and** the file records in one transaction; on failure the
uploaded files are deleted. Results are saved inside that transaction, so a
retry after a crash never imports twice.

### Realtime

Clients open `/ws` and authenticate with their first message (no tokens in URLs).
Events are published with Postgres `NOTIFY` and every instance `LISTEN`s, so live
updates work across multiple instances. Events go to one user, never broadcast.

## Frontend (`frontend/src`)

- The current project is in the URL (`/app/projects/:id/...`); tabs never lose it.
- All server state is in React Query (`api/hooks.ts`) with targeted invalidation;
  realtime events and job updates refresh exactly the affected queries.
- `components/feedback.tsx` provides toasts and a confirm dialog (no `alert`/`confirm`).
- Styling is one design-token stylesheet (`styles/app.css`) with component classes.
- Copy buttons use a Safari-safe clipboard helper with a manual-copy fallback.

## Decisions & trade-offs

- **Postgres-backed job queue instead of Redis/BullMQ** — no extra infrastructure
  or cost, transactional enqueueing, and user-visible job state in one table.
- **`tsx` at runtime on Render** — works with the existing `npm install` / `npm start`
  settings. To run compiled output instead, set Build to `npm ci && npm run build`
  and Start to `npm run start:compiled`.
- **Bearer tokens in localStorage** — the frontend and API are on different
  sites (vercel.app / onrender.com), where cross-site cookies are blocked by
  Safari. Mitigated by a strict CSP and no raw-HTML rendering. With a custom
  domain for both apps, move to httpOnly `SameSite=Lax` cookies.
- **Legacy columns kept** (`quotes.factory_name`, `item_index` on quotes, …) and
  no longer used — drop them in a follow-up migration once v2 is verified in production.

## Follow-ups

- Contract migration dropping the legacy columns (after v2 is verified live).
- Per-division compare-sheet formats beyond GM's pack counts (`domain/divisions.ts`).
- Direct-to-storage uploads (signed upload URLs) for very large CAD batches.
- Storage orphan sweep (objects uploaded by a crashed process before being recorded).
