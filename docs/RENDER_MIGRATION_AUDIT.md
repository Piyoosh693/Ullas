# Render Migration Audit — Current Working Copy

## Target architecture

- React + Vite static frontend.
- Node.js + Express API service.
- Managed PostgreSQL as the source of truth for real application runs.
- Resend transactional email via a PostgreSQL outbox.

## Current source state

The code now contains an API-connected multi-page frontend, database migrations and repositories, account/session/token persistence paths, activity notifications/email outbox, role guards, health/readiness routes, and a Render Blueprint. Server route tests pass in the isolated test mode. The test mode uses memory stores intentionally; non-test runtime requires PostgreSQL.

## Not yet proven

- Full production frontend build from a clean install.
- Migrations and exclusion constraints against a live disposable PostgreSQL instance.
- Real Resend sending and link callbacks.
- Live Render provisioning/deployment and cookie/CORS behavior.
- Complete parity against the original Supabase app, which is not included in this source ZIP.

## Key release risks

- Resolve any overlapping existing records before applying migration `004_booking_integrity.sql`; that migration deliberately fails rather than accepting inconsistent data.
- Sensitive verification document uploads/private storage have no finished implementation in this source.
- Production deployment needs a suitable paid database plan, backups, restore testing and an explicit rollback plan.
