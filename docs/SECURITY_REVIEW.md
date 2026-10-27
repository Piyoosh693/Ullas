# Security Review — Current Source Copy

## Implemented in source (not a substitute for a live security test)

- Express security headers via Helmet and a JSON body-size limit.
- CORS limited to configured frontend origins.
- Request body validation using Zod in API routes.
- Authentication and API rate limiting.
- Public signup rejects role/privilege fields; admin creation is a separately guarded one-time flow.
- Password hashing with bcryptjs; database session tokens and verification/reset tokens are stored hashed.
- Verification/reset tokens expire and are consumed once; raw tokens are not returned from API responses.
- Production environment validation requires PostgreSQL and strong non-placeholder secrets.
- Production cookies are HttpOnly and Secure; SameSite is configurable.
- Request logging omits headers, query strings, bodies, and token values.
- Admin role changes are audited, and the last active admin cannot be demoted/suspended through the role-management route.
- PostgreSQL migration adds database-level overlapping-booking and overlapping-availability exclusion constraints.
- Email templates escape dynamic HTML and activity-email events use idempotency keys.

## Critical verification limits / remaining risks

- `npm run test:db` has not been run against a real disposable PostgreSQL instance. The SQL migrations and concurrency constraints need that live verification.
- The production Vite build is not verified in the current audit environment because the provided dependency installation lacks Rollup's Linux native package; clean dependency installation did not complete here.
- Resend delivery, production HTTPS cookies/CORS, Render deployment, and backup/restore have not been tested live.
- File uploads/private verification document storage are not implemented. Do not collect or promise support for uploading sensitive documents until a private storage/access-controlled workflow is added.
- Original Ullas V1 parity is not certified because the original Supabase implementation/spec was not included in the latest ZIP.
- Review policy/consent/privacy/legal requirements for the actual deployment jurisdiction and user base.

## Required release gates

1. Clean checkout: `npm ci`, `npm test`, and `npm run build` all pass.
2. `npm run test:db` passes against a disposable PostgreSQL database whose name includes `test` or `ci`.
3. All in-scope journeys and negative authorization tests pass in staging.
4. Test real verification/password-reset emails and activity emails.
5. Perform backup and restore verification, document rollback, and resolve all critical/high findings.

Do not describe the app as production-ready until those gates have evidence.
