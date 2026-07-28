# Deploying Bid Consolidator

Stack: **Supabase** (Postgres + Storage) · **Render** (backend API) · **Vercel** (frontend).

The repo tracks the app under a **`Bid-Consolidator/`** top-level folder, so the
subfolders on GitHub are `Bid-Consolidator/backend/` and `Bid-Consolidator/frontend/`.
Use those as the "root directory" in Render/Vercel.

---

## 1. Supabase (database + file storage)

1. Create a project at supabase.com (save the database password).
2. **Storage → New bucket** → name `uploads` (keep it private).
3. Collect (from the "Connect" button or Project Settings):
   - **Database → Connection string (URI)** → this is `DATABASE_URL`
   - **API → Project URL** → `SUPABASE_URL`
   - **API → service_role key** (secret) → `SUPABASE_SERVICE_KEY`

Run the schema once against Supabase (from your machine, with the vars set in `backend/.env`):
```bash
cd backend && npm run db:migrate
```
Then seed the first admin user + default org:
```bash
cd backend && npm run db:seed
```

## 2. Render (backend)

New **Web Service** → connect the GitHub repo.
- **Root Directory:** `Bid-Consolidator/backend`
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Environment variables:**
  ```
  DATABASE_URL           = <Supabase connection string>
  SUPABASE_URL           = <Supabase project URL>
  SUPABASE_SERVICE_KEY   = <Supabase service_role key>
  SUPABASE_BUCKET        = uploads
  JWT_SECRET             = <a long random string>
  FRONTEND_URL           = <your Vercel URL, e.g. https://bidconsolidator.vercel.app>
  # optional email sending:
  SMTP_HOST=smtp.gmail.com  SMTP_PORT=587  SMTP_SECURE=false
  SMTP_USER=...  SMTP_PASS=...  SMTP_FROM=...
  ```
- After deploy, note the backend URL, e.g. `https://bid-consolidator-api.onrender.com`.

## 3. Vercel (frontend)

New Project → same GitHub repo.
- **Root Directory:** `Bid-Consolidator/frontend`
- Framework preset: **Vite** (Build `npm run build`, Output `dist`).
- **Environment variables:**
  ```
  VITE_API_URL = https://<your-render-backend>.onrender.com/api
  VITE_WS_URL  = wss://<your-render-backend>.onrender.com/ws
  ```
- Deploy, then set Render's `FRONTEND_URL` to the resulting Vercel URL and redeploy the backend (for CORS).

## Notes
- Files (outbound templates, factory quotes, extracted images) go to Supabase Storage under `Project/Factory/images/…` keys — browsable in the Supabase Storage dashboard.
- Locally (no `DATABASE_URL` / Supabase vars set), the app falls back to local Postgres + the `backend/uploads/` folder, so dev is unchanged.
