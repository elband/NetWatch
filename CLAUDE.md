# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Overview

**NetWatch** is an infrastructure monitoring & incident management ERP for airport IT operations. It tracks network devices (ping/SNMP), manages incident tickets, records technician shifts/attendance, generates official letters with digital signatures (TTE), and delivers real-time alerts via WhatsApp (internal self-hosted WhatsApp Gateway API).

**Stack:** Node.js + Express + Socket.io (backend) · React 19 + TypeScript + Vite + TailwindCSS v4 (frontend) · MySQL 8 · Redis (BullMQ queues) · PM2 (process manager)

---

## Commands

### Backend (`cd backend`)
```bash
npm run dev          # hot-reload dev server (node --watch)
npm start            # production server
npm run migrate      # run schema.sql + idempotent ALTER TABLE additions
npm run seed         # seed demo users (admin/koordinator/teknisi/viewer)
```

### Frontend (`cd frontend`)
```bash
npm run dev          # Vite dev server on :5173 (proxies /api → :4000)
npm run build        # tsc -b && vite build → outputs to frontend/dist/
npm run lint         # ESLint check
npm run preview      # preview production build locally
```

### Type-check frontend (no npx, use node directly)
```bash
node node_modules/typescript/bin/tsc --noEmit
```

---

## Architecture

### Request Flow

```
Browser → Nginx (:80/:443)
  ├── /api/*      → Express :4000  (all backend routes)
  ├── /uploads/*  → Express :4000  (static file storage)
  ├── /socket.io  → Express :4000  (WebSocket upgrade)
  └── /*          → frontend/dist/ (SPA served by Express in production)
```

In development, Vite dev server (:5173) proxies `/api`, `/uploads`, and `/socket.io` to the backend at `:4000`. In production, Express itself serves the built frontend and all traffic comes through a single port.

### Backend Structure (`backend/src/`)

| Directory | Role |
|---|---|
| `config/env.js` | Single source of all env vars — import `env` everywhere, never `process.env` directly |
| `db/pool.js` | MySQL2 promise pool (limit 10 conn). `migrate.js` applies schema + idempotent ALTER TABLE. |
| `middleware/auth.js` | `requireAuth` (JWT verify), `requireRole(...roles)`, `requirePerm(perm)` |
| `middleware/upload.js` | Multer config for incident docs and inspection photos |
| `controllers/` | `authController`, `deviceController`, `incidentController`, `userController` — business logic here |
| `routes/` | 22 route files, all mounted under `/api/*` in `server.js` |
| `services/` | `notify.js` (Socket.io per-user rooms), `sshBridge.js` (SSH ↔ WebSocket), `pingService.js`, `coordWatcher.js`, `waGatewayService.js` |
| `jobs/` | BullMQ workers: `pingQueue.js` (device health, 15s interval), `waQueue.js`/`waWorker.js` (async WhatsApp sends) |

All route files are ES modules (`"type": "module"` in package.json). Use `import/export` throughout.

### Frontend Structure (`frontend/src/`)

| Directory | Role |
|---|---|
| `api/client.ts` | Axios instance with base `/api`, auto-injects `Bearer` token, redirects to `/login` on 401 |
| `api/socket.ts` | Singleton Socket.io connection; sends `notif:auth` with JWT on connect for room join |
| `context/AuthContext.tsx` | Global auth state: `user`, `token`, `login()`, `loginPin()`, `loginAs()`, `logout()`. Token in `localStorage` key `netwatch_token` |
| `pages/` | 28 pages routed in `App.tsx`. Public: `/login`, `/lapor`, `/verify-tte`, `/ttd` |
| `components/` | `AppLayout` (sidebar shell), `IncidentDetailModal` (shared popup), modals, `NotificationCenter` |
| `types/index.ts` | All TypeScript interfaces — single source of truth for data shapes |
| `utils/` | `downtime.ts` (ms/format), `steps.ts` (incident step labels), `roles.ts`, `laporanReport.ts` |

### Role-based routing
- `admin` → `/dashboard`
- `koordinator` → `/coord-dashboard`
- `teknisi` → `/my-dashboard`
- `viewer` → `/dashboard`

Users can have multiple roles (`roles: string[]` JSON column). `requireRole` checks the array.

### Incident Step Flow
Steps 0–4 defined in `utils/steps.ts`: Belum Mulai → Dicoba via SSH → Visit ke Perangkat → Analisa Kerusakan → Selesai. Step labels are static; `hasIp()` determines if SSH step is available.

### Real-time Notifications
Backend emits `notification:new` to `user:{id}` Socket.io rooms via `services/notify.js`. Frontend's `NotificationCenter` listens on the singleton socket. Incident focus via URL `?focus=INC-XXX`.

### File Uploads
Uploaded files land in `backend/uploads/` (served as `/uploads/*`). **This directory must exist on the server and be writable by the process.**

---

## Database

- **Engine:** MySQL 8, UTF8MB4 charset, database name `netwatch_erp`
- **Migration:** `npm run migrate` is idempotent — safe to re-run. It applies `schema.sql` and then adds missing columns with `addColumnIfMissing()`. Always add new columns here, not just in schema.sql.
- **Users:** `role` (single, for legacy) + `roles` JSON array (actual check). `pin_hash` for PIN login. `perms` JSON for fine-grained permissions.
- **Incidents:** Pool model — unassigned incidents go to pool (`tech_id IS NULL`). Technicians claim from pool during on-duty shifts. `incident_notes` is the audit trail / kronologi.
- **Jobs:** BullMQ uses Redis. Job connection config in `jobs/queueConnection.js`.

---

## Environment Variables

Create `backend/.env` from `backend/.env.example`:

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `4000` | Backend HTTP port |
| `JWT_SECRET` | `change_me` | **Must change in production** |
| `JWT_EXPIRES_IN` | `8h` | Token lifetime |
| `DB_HOST/PORT/USER/PASSWORD/NAME` | `127.0.0.1/3306/root/''/netwatch_erp` | MySQL connection |
| `REDIS_HOST/PORT` | `127.0.0.1/6379` | BullMQ queue store |
| `WAGATEWAY_API_KEY` | _(empty)_ | API key for the internal WhatsApp Gateway (header `X-API-Key`, format `wag_xxx.yyy`) |
| `WAGATEWAY_BASE_URL` | `https://wg.aptpairport.id` | WhatsApp Gateway base URL (endpoint `POST /api/v1/messages/send`) |
| `WAGATEWAY_DEVICE_ID` | _(empty)_ | Optional sender device id; empty uses the gateway's default device |
| `CORS_ORIGIN` | `http://localhost:5173` | Set to production domain in prod |
| `SELF_BASE_URL` | `http://127.0.0.1:${PORT}` | URL Puppeteer opens to render `/doc-print` → PDF (TTE verify download). Prod: leave default (Express serves the SPA on the same port). Dev: set to the Vite origin, e.g. `http://127.0.0.1:5173`. |
| `PING_INTERVAL_MS` | `15000` | Device ping frequency |
| `NODE_ENV` | _(unset)_ | Set to `production` to enable frontend static serving |

---

## Production Deployment

> **Panduan lengkap langkah-demi-langkah:** [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (env aman, DB/Redis hardening, Nginx+TLS, PM2, backup, verifikasi). HA/DR: [docs/DISASTER-RECOVERY.md](docs/DISASTER-RECOVERY.md). Ringkasan cepat di bawah.

### 1. Build
```bash
cd frontend && npm install && npm run build
cd ../backend && npm install
```

### 2. Configure
```bash
cp backend/.env.example backend/.env
# Edit backend/.env: set JWT_SECRET, DB credentials, CORS_ORIGIN, WAGATEWAY_API_KEY, NODE_ENV=production
```

### 3. Database
```bash
cd backend && npm run migrate
```

### 4. Run with PM2
```bash
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
```

### 5. Nginx reverse proxy
Point all traffic to port `4000`. The backend serves both the API and the built frontend SPA (when `NODE_ENV=production`). See `nginx.conf.example` for the recommended configuration.

### Uploads directory
```bash
mkdir -p backend/uploads/incidents backend/uploads/inspections
```
This directory is outside version control and must exist with write permissions.

---

## Key Patterns

- **No root `package.json`** — run commands inside `backend/` or `frontend/` subdirectories.
- **ES Modules throughout** — both backend and frontend use `import/export`. Do not use `require()`.
- **TailwindCSS v4** — uses `@tailwindcss/vite` plugin (not `tailwind.config.js`). All theme tokens are CSS variables (e.g. `var(--color-accent)`).
- **Shared IncidentDetailModal** — extracted to `frontend/src/components/IncidentDetailModal.tsx`; used by both `Incidents.tsx` (admin) and `MyIncidents.tsx` (technician).
- **Socket auth pattern** — frontend sends `notif:auth` event with raw JWT string after connection; backend verifies and joins `user:{id}` room.
- **`stepLabels` / `maxStep`** in `utils/steps.ts` accept an incident object but currently ignore it (labels are static). Pass `inc` for forward-compatibility.
- **Document HTML is generated client-side** — all official documents (Nota Dinas, Surat Pernyataan, combined incident/LKP, Laporan Bulanan) are built as print-ready HTML in `frontend/src/utils/docTemplates.ts` (`buildDocHtml` + helpers) and `utils/laporanReport.ts` (`buildReportHtml`). These functions are pure: pass `lkp` (org config) and `origin` explicitly. Used by `SuratKeluar.tsx` (print) and the public `DocPrint.tsx` (PDF render).
- **TTE document PDF download** — the public verify page (`VerifyTte.tsx`) auto-downloads `GET /api/verify-tte/:token/document.pdf`. Backend (`services/pdfRenderer.js`, **Puppeteer**) opens the public `/doc-print?token=…` page (which fetches `GET /api/verify-tte/:token/doc-data`) and prints it to a real PDF. Puppeteer downloads Chromium on `npm install` (needs `node` on PATH + system libs on Linux); it can push memory past the PM2 `max_memory_restart` (768M) — raise it if PDF rendering triggers restarts.
