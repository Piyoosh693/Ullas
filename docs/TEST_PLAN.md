# Test Plan — Current Source Copy

## Automated tests run during remediation

- `npm test`: 16/16 server tests passed in the remediation environment.
- Configuration validation: secure origins, real production values, strong secrets, and allowed public frontend origin.
- Auth/account tests: signup role restrictions, verification, login, password reset and admin authorization.
- Database-mode test: non-test execution refuses to silently fall back to in-memory application data.
- V1 lifecycle test: public directory privacy, role restrictions, availability overlaps, booking conflicts and client-field injection, allowed state transitions, and feedback eligibility/duplicate prevention.
- Email tests: only active verified accounts receive activity emails; dynamic HTML is escaped; duplicate event keys do not queue duplicates.
- Frontend source parse: JSX/JS entry points parse successfully.

## Checks that remain unverified

- `npm run build`: currently fails in this environment because the shared/bundled `node_modules` lacks `@rollup/rollup-linux-x64-gnu`. A clean `npm ci` attempt timed out. Run the build after a clean install from `package-lock.json`.
- `npm run test:db`: not run because no disposable PostgreSQL connection was available.
- Render Blueprint creation and deploy: not run.
- Real Resend email delivery: not run.
- Browser-based end-to-end tests on desktop/mobile: not run.

## PostgreSQL smoke test

Create a disposable PostgreSQL database named with `test` or `ci` and set `TEST_DATABASE_URL`:

```bash
TEST_DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/ullas_test' npm run test:db
```

Use `TEST_PGSSL=require` only if needed by the database provider. Never point this script at a production database: it applies migrations and inserts/deletes fake rows.

## Staging acceptance

Use `docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md`. Test real user role journeys, emails, persistence after restart, booking concurrency, unauthorized access, mobile responsiveness, and backup/restore before any production launch.
