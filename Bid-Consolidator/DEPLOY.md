# Deploying Bid Consolidator

Stack: **Supabase** (Postgres + Storage) · **Render** (backend API) · **Vercel** (frontend).
The app lives under `Bid-Consolidator/` in the repository, so use
`Bid-Consolidator/backend` and `Bid-Consolidator/frontend` as root directories.

## What happens on every deploy

- **Render** runs `npm install` then `npm start` (`tsx src/server.ts`). On boot the
  server validates its configuration, **applies pending database migrations**
  (under an advisory lock, one transaction per migration), then starts the API,
  WebSocket and background job workers. On `SIGTERM` it finishes in-flight work.
- **Vercel** runs `npm run build` and serves `dist/` with security headers and an
  SPA fallback (`frontend/vercel.json`).
- **CI** (`.github/workflows/ci.yml`) lints, type-checks, tests (against real
  Postgres), audits and builds both apps on every push.

## Settings

### Render (backend) — Web Service
- Root directory `Bid-Consolidator/backend` · Build `npm install` · Start `npm start`
- Health check path: `/api/health` (checks the database too)

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | Supabase **session** pooler URI (port **5432**, not 6543) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | ✅ | Storage; without them uploads would be lost on each deploy — the server refuses to start |
| `SUPABASE_BUCKET` | | default `uploads` (keep the bucket **private**) |
| `JWT_SECRET` | ✅ | 32+ random chars |
| `FRONTEND_URL` | ✅ | allowed origins, comma-separated: `https://bid-consolidator.vercel.app,https://bidconsolidator.vercel.app` |
| `PUBLIC_APP_URL` | | base for portal links in emails; defaults to the first `FRONTEND_URL` |
| `MS_TENANT_ID` `MS_CLIENT_ID` `MS_CLIENT_SECRET` | | send from each buyer's own Outlook — see **Outlook sending** below |
| `MAIL_TOKEN_KEY` | | optional; encrypts stored Outlook tokens (32+ random chars) |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `SMTP_SECURE` `SMTP_FROM` | | optional fallback for buyers who haven't connected Outlook; without either, use **Copy** |
| `GEMINI_API_KEY` | | AI CAD splitting — use a **paid** key for customer artwork |
| `DB_CA_CERT` | recommended | Supabase CA cert (Project Settings → Database → SSL). Enables full TLS verification |

### Vercel (frontend)
- Root directory `Bid-Consolidator/frontend` · Framework **Vite**
- `VITE_API_URL = https://bid-consolidator-api.onrender.com/api`
- `frontend/vercel.json` sets a Content-Security-Policy that allows the API at
  `bid-consolidator-api.onrender.com` and images from `*.supabase.co`. **If the
  backend URL ever changes, update that policy too** or the app can't reach it.

### Supabase
- Storage bucket `uploads`, **private**. Files are only reachable through
  short-lived signed URLs issued by the API.

## First deploy of v2 (one-time)

v2 replaces the data model (factory/item foreign keys, org tenancy, job queue).
The migration was tested against a copy of legacy-shaped data, but take a backup
first — the free Supabase tier has no automatic backups.

1. **Resume Supabase** if it's paused, then back it up:
   ```bash
   pg_dump "$DATABASE_URL" --no-owner --no-privileges -Fc -f bid-consolidator-pre-v2.dump
   ```
2. Rehearse locally against the copy (optional but recommended):
   ```bash
   createdb bc_rehearsal && pg_restore --no-owner -d bc_rehearsal bid-consolidator-pre-v2.dump
   cd backend && DATABASE_URL= DB_NAME=bc_rehearsal npm run migrate
   ```
3. Push to `main`. Render deploys and migrates automatically; watch the logs for
   `migrations up: 2 applied`. Deploy off-hours: the old version keeps serving for
   the minute or two until the new one is up.
4. Everyone signs in again (sessions from v1 are not valid in v2).
5. **Roles:** after the migration `admin@shalom.com` is the **only admin**;
   every other existing account is a member. The admin can promote people in
   Settings → Members & invites.
6. **Immediately change that admin's password** (Settings → Your account): v1
   docs and seed used `admin@shalom.com` / `admin123`, and it is now the account
   that controls the organization.

**Rollback:** redeploy the previous commit *and* restore the backup
(`pg_restore --clean -d "$DATABASE_URL" bid-consolidator-pre-v2.dump`). The v2
migration is intentionally not reversible in place.

## Outlook sending (one-time, needs a Microsoft 365 admin)

Buyers send factory emails — one at a time or in a batch — from their **own**
Outlook mailbox: the email shows in their Sent folder and replies go straight
to them. The app gets *delegated* `Mail.Send` only: it can send as a buyer who
connected, and cannot read anyone's mail.

1. **Microsoft Entra admin center → App registrations → New registration**
   - Name: `Bid Consolidator`
   - Supported account types: *Accounts in this organizational directory only*
   - Redirect URI: platform **Web**, `https://bid-consolidator-api.onrender.com/api/mail/microsoft/callback`
2. **API permissions → Add → Microsoft Graph → Delegated**: `Mail.Send`, `User.Read`,
   `offline_access`, `openid`, `email` → **Grant admin consent for Shalom**.
3. **Certificates & secrets → New client secret** (24 months). Copy the *Value*.
4. From the app's **Overview** copy the *Directory (tenant) ID* and *Application (client) ID*.
5. **Render → Environment**: set `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`
   (and optionally `MAIL_TOKEN_KEY`). Render redeploys.
6. Each buyer: **Settings → Send from Outlook → Connect Outlook**, sign in with their
   own work account. The mailbox must match their login email.

Notes
- Exchange allows ~30 emails a minute per mailbox; batches are paced to stay under it.
- Put a calendar reminder to renew the client secret before it expires.
- Mimecast: mail leaves through Exchange Online as usual, so existing outbound
  policies apply.
- Try it locally without Microsoft: start the `fake-microsoft` and
  `backend-outlook-dev` launch configs (sent emails are logged, not delivered).

## Production checklist

- [ ] **Supabase Pro** — the free tier pauses after a week idle (the site goes
      down) and has no backups. Pro adds daily backups; enable PITR for more.
- [ ] **Render Starter** — the free tier sleeps; the first request after idle
      takes ~30–50 s and background jobs pause while asleep.
- [ ] `DB_CA_CERT` set (full TLS verification to the database).
- [ ] Paid Gemini key (free tier may use uploaded designs for training).
- [ ] Outlook sending set up (below), or agree to send with **Copy**.
- [ ] Custom domain for both apps (e.g. `app.` / `api.` on your domain) — then
      sessions can move to httpOnly cookies (see ARCHITECTURE.md).
- [ ] Old `admin@shalom.com` account rotated or removed.

## Local fallback

With `DATABASE_URL` and the Supabase variables unset, the backend uses local
Postgres (`DB_*`) and stores files in `backend/uploads/` — convenient for
development, never for production (the server refuses that combination on Render).
