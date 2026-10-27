# Ullas V1

Ullas connects professionals, mentors, educational/community organizations, and learners around offers, needs, invitations, bookings, feedback, and impact activity.

This repository is the Render-oriented application source. It includes a React/Vite frontend, an Express API, PostgreSQL migrations, email outbox support through Resend, automated tests, and a Render Blueprint. **It must still pass clean-install, PostgreSQL integration, and live staging checks before production use.**

## Architecture

- **Frontend:** React + Vite, deployed as a Render Static Site.
- **API:** Node.js 20+ and Express, deployed as a Render Web Service.
- **Persistence:** PostgreSQL. Real application execution requires `DATABASE_URL`; in-memory stores are used only by the isolated test suite.
- **Email:** Resend API, called only by the backend. Emails are queued in the PostgreSQL `email_outbox` table and retried by the API worker.
- **Session/auth:** Server-managed sessions persisted in PostgreSQL; hashed passwords and hashed session/reset/verification token values.

## Prerequisites

- Node.js 20 or newer and npm.
- PostgreSQL 14+ for local development/testing (current Render PostgreSQL is also suitable).
- A Resend account and verified sender/domain for real transactional email.
- Render and GitHub accounts for deployment.

## Local setup

1. Create a local PostgreSQL database named `ullas_dev`.
2. Copy `.env.example` to `.env`. Change all placeholder values and set a strong unique `SESSION_SECRET` and `ADMIN_BOOTSTRAP_SECRET`. Never commit `.env`.
3. Install the committed dependencies:

   ```bash
   npm ci
   ```

4. Run database migrations:

   ```bash
   npm run db:migrate
   ```

5. Run the unit/in-memory integration test suite:

   ```bash
   npm test
   ```

6. Build the frontend:

   ```bash
   npm run build
   ```

7. Start the backend in one terminal:

   ```bash
   npm run dev:server
   ```

8. Start the frontend in another terminal:

   ```bash
   npm run dev:web
   ```

The frontend dev server defaults to `http://localhost:5173`; the API defaults to `http://localhost:4000`. The API client uses `VITE_API_URL` if set, otherwise its local default. Real backend startup refuses to silently fall back to memory when PostgreSQL is missing.

## Database migrations and integration smoke test

- `npm run db:migrate` applies numbered SQL migrations from `server/src/db/migrations/` and tracks applied files in `schema_migrations`.
- `server/src/db/schema.sql` is a historical schema snapshot; **the numbered migrations are the canonical schema source**.
- The database smoke test is deliberately gated and must only target a disposable database named with `test` or `ci` in the name:

  ```bash
  TEST_DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/ullas_test' npm run test:db
  ```

  Set `TEST_PGSSL=require` if the database requires TLS. The smoke test runs migrations and creates/deletes fake users, offers, bookings, and availability windows. Never point `TEST_DATABASE_URL` at production data. It has not been executed in this environment because no live PostgreSQL URL was provided.

## Environment variables

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development` locally; `production` on Render. |
| `PORT` | API listening port (Render provides a port automatically). |
| `DATABASE_URL` | PostgreSQL connection string; required for all non-test app runtime. |
| `FRONTEND_URL` | Exact allowed frontend origin(s), comma-separated only if required; no trailing slash or path in production. |
| `PUBLIC_APP_URL` | Exact public HTTPS frontend origin used in email links. |
| `SESSION_SECRET` | Unique secret, at least 32 characters in production. |
| `ADMIN_BOOTSTRAP_SECRET` | One-time guarded first-admin provisioning secret. Store it only in server environment settings. |
| `RESEND_API_KEY` | Backend-only Resend API key. Required in production. |
| `RESEND_FROM_EMAIL` | Sender address on a verified Resend domain. Required in production. |
| `VITE_API_URL` | Frontend API base URL, ending in `/api`, e.g. `https://your-api.onrender.com/api`. This is public configuration, not a secret. |
| `PGSSL` | Use `require` for TLS where required by the database provider; local PostgreSQL can use `disable`. |
| `COOKIE_SAME_SITE` | `lax` by default. Coordinate this with frontend/backend domain arrangement; do not select `none` casually. |

Never put `DATABASE_URL`, Resend keys, session/admin secrets, or any private credential in a `VITE_*` variable, frontend code, GitHub, or a client-side `.env` file.

## First administrator

Public signup can only create non-privileged user roles. After the database migrations are applied and the API is running in a trusted environment, create the initial admin through the guarded `POST /api/admin/bootstrap` endpoint using `ADMIN_BOOTSTRAP_SECRET`. Follow the endpoint schema in `server/src/routes/admin.js`. Only do this once, from a private machine or API client; do not put the secret in a browser frontend. After a successful bootstrap, remove/rotate the bootstrap secret in Render. Confirm the created account can sign in and then review its role via the admin UI.

## Render deployment

`render.yaml` defines the API, static frontend, and managed PostgreSQL database. It is an infrastructure template; review all resource plans and environment prompts before applying it.

1. Push this clean source (without `node_modules`, `.env`, or `web/dist`) to your GitHub repository.
2. In Render, create a new Blueprint and connect that repository. Inspect the proposed services and database before approving sync.
3. Choose a **paid, suitable PostgreSQL plan for production** and understand the cost before creating a production database. Render's Free Postgres is for testing and expires after 30 days; it does not provide production backup guarantees. Free compute can also spin down. See the official [Render Free instance limits](https://render.com/docs/free).
4. Set `FRONTEND_URL` and `PUBLIC_APP_URL` to the deployed frontend origin (exact HTTPS origin, no path/trailing slash) and set `VITE_API_URL` to the deployed API URL ending in `/api`.
5. Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` using a verified sender. Never paste actual secret values into GitHub or chat.
6. Run migrations using the configured pre-deploy command or once as a controlled release step. Do not assume a database is initialized merely because the API starts.
7. Confirm `/api/health` and `/api/ready` return successful responses, then test the entire critical path using test accounts and real email delivery.
8. Configure backups/restore, monitoring, and rollback before inviting real users.

Official references: [Render Blueprint YAML](https://render.com/docs/blueprint-spec), [environment variables](https://render.com/docs/configure-environment-variables), [web services](https://render.com/docs/web-services), [static sites](https://render.com/docs/static-sites).

## Tests and known verification limits

- `npm test` runs the server test suite (security/auth/config and in-memory lifecycle tests).
- `npm run test:db` must be run against a separate disposable PostgreSQL instance to verify migrations and database constraints.
- `npm run build` must succeed from a clean checkout. In the audit environment, the supplied `node_modules` had an incomplete Linux Rollup native package, and a clean install could not be completed; the Vite build result is therefore **not verified** here.
- Real Resend delivery, Render Blueprint creation, production cookies/CORS, database backup restoration, and original feature parity must be verified in staging.

## Documents

- `docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md` — manual deployment checklist.
- `docs/IMPLEMENTATION_REMEDIATION_REPORT.md` — code changes and verification results.
- `docs/RENDER_MIGRATION_AUDIT.md` — original migration audit, if applicable.
- `docs/RENDER_MIGRATION_PLAN.md` — architecture plan, if applicable.
