# Ullas V1 — Production Deployment Checklist

Use this checklist only after the code is tested. Do not deploy this build directly to real users while any critical item remains unchecked.

## A. Local verification (developer)

- [ ] Start from a clean Git checkout.
- [ ] Confirm `.env`, credentials, `node_modules/`, `web/dist/`, logs and user data are not committed.
- [ ] Run `npm ci` with Node.js 20+.
- [ ] Run `npm test`; all tests must pass.
- [ ] Run `npm run build`; the production bundle must compile successfully.
- [ ] Provision a disposable PostgreSQL database named like `ullas_test` and set `TEST_DATABASE_URL` to it.
- [ ] Run `npm run test:db`; confirm migrations and exclusion constraints pass. Do not use production data for this test.
- [ ] Review migration 004's overlap checks against any existing records before applying it to a real database.
- [ ] Review the final Git diff and confirm secrets and generated dependencies are not included.

## B. GitHub (manual account action)

- [ ] Create or select a private GitHub repository.
- [ ] Push only source, lockfile, SQL migrations, tests, and documentation.
- [ ] Verify `.env`, credentials, `node_modules/`, and built output are absent from the repository.
- [ ] Protect the production branch and require code review if other contributors will push changes.

## C. Render resources

- [ ] Connect the repository to Render and inspect the Blueprint plan before approving it.
- [ ] Create the API Web Service, Static Site, and managed PostgreSQL database.
- [ ] Choose a paid PostgreSQL plan appropriate for production. Do not use Render Free Postgres for production; the current official documentation says Free Postgres expires after 30 days and has no backups: https://render.com/docs/free.
- [ ] Confirm the API and database are in the same region if possible.
- [ ] Configure migration execution as a controlled pre-deploy/release step.
- [ ] Confirm the backend health endpoint is `/api/health` and readiness is `/api/ready`.

## D. Environment values (manual, never commit secrets)

### Backend service

- [ ] `NODE_ENV=production`
- [ ] `DATABASE_URL` references the Render PostgreSQL connection string.
- [ ] `FRONTEND_URL` is the exact deployed frontend origin, e.g. `https://your-frontend.onrender.com` (no trailing slash or path).
- [ ] `PUBLIC_APP_URL` is the exact HTTPS origin used for verification/reset links.
- [ ] `SESSION_SECRET` is unique and at least 32 characters.
- [ ] `ADMIN_BOOTSTRAP_SECRET` is unique and at least 32 characters; remove/rotate it after first admin bootstrap.
- [ ] `SMTP_USER` is set to a Gmail address with 2-Step Verification enabled.
- [ ] `SMTP_PASS` is set to the Gmail App Password (not the regular Gmail password).
- [ ] `SMTP_FROM_EMAIL` is set (optional; defaults to `SMTP_USER`).
- [ ] `PGSSL=require` if needed by the provider.
- [ ] `COOKIE_SAME_SITE=lax` unless a documented cross-site requirement justifies another setting.

### Frontend Static Site

- [ ] `VITE_API_URL` is the deployed API origin ending in `/api`, e.g. `https://your-api.onrender.com/api`.
- [ ] No server secret appears in any `VITE_*` variable.

## E. First administrator

- [ ] Apply database migrations successfully.
- [ ] Bootstrap the first administrator using the guarded API endpoint from a trusted private API client, never frontend JavaScript.
- [ ] Verify admin can sign in and can review users/organizations.
- [ ] Rotate/remove `ADMIN_BOOTSTRAP_SECRET` after successful provisioning.
- [ ] Confirm public signup cannot create or promote admins.

## F. Staging acceptance (manual live test)

- [ ] Signup and verify account using actual email.
- [ ] Login, reload, logout, and confirm sessions behave correctly.
- [ ] Password reset email arrives; token expires and cannot be reused.
- [ ] Public directory only shows intended public and verified data.
- [ ] Profile and organization edits enforce ownership.
- [ ] Offer/need creation, publication, interests and invitations work for correct roles.
- [ ] Provider availability can be created and cannot overlap improperly.
- [ ] Concurrent booking requests cannot produce overlapping confirmed/requested bookings for the same offer.
- [ ] Accept, decline, cancel, reschedule and complete booking transitions work.
- [ ] Feedback only works for eligible booking participants and cannot be duplicated.
- [ ] Notification and activity emails are delivered; a failed email can be retried safely.
- [ ] Admin verification and role management work; no normal user can access admin APIs.
- [ ] UI works on desktop and mobile. Check browser console and API logs for errors or secrets.
- [ ] Restart/redeploy the API and confirm database records still exist.

## G. Recovery and launch decision

- [ ] Configure database backups appropriate for the chosen plan.
- [ ] Perform a restore drill to a separate database and record the steps.
- [ ] Document rollback steps and who can execute them.
- [ ] Confirm privacy policy, terms, contact details, data retention and incident contact.
- [ ] Review costs/limits and approve the plan.
- [ ] Confirm every original V1 requirement has a status and evidence; do not assume parity from successful deployment alone.
- [ ] Only invite real users after critical/high-risk items pass.
