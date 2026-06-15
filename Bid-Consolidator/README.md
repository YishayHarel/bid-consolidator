# Bid Consolidator — Shalom International

Internal sourcing tool for factory quote consolidation.

## Setup

### Prerequisites
- Node.js 18+
- PostgreSQL running locally

### Backend

```bash
cd backend
cp .env.example .env       # fill in DB credentials
npm install
npm run db:migrate
npm run db:seed
npm run dev                # starts on port 4000
```

### Frontend

```bash
cd frontend
npm install
npm run dev                # starts on port 5173
```

## Default Login

- **Email:** admin@shalom.com
- **Password:** set via `INTERNAL_PASSWORD` in `backend/.env` (default: `admin123`)

## Routes

| URL | Description |
|-----|-------------|
| `/login` | Internal team login |
| `/internal` | Protected dashboard (6 tabs) |
| `/vendor?token=<token>` | Factory upload portal |

## Tabs

1. **Submissions** — All factory uploads. Approve / Reject. Upload directly.
2. **Comparison** — Side-by-side price table. Color-coded. AI Summary.
3. **Landed Cost** — Full calculator matching Jack's Excel color scheme.
4. **Draft Emails** — Auto-generated confirmation / counter-offer emails.
5. **Projects** — Create and manage sourcing projects.
6. **Vendor Links** — Generate tokenized upload links for factories.
