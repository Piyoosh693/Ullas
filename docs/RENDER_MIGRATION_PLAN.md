# Render Migration Plan — Current Working Copy

## Target stack

- Frontend: React + Vite on Render Static Site.
- Backend: Node.js + Express on Render Web Service.
- Database: managed PostgreSQL. Numbered SQL files under `server/src/db/migrations/` are canonical.
- Email: Resend via server-side API and PostgreSQL outbox.

## Implemented in source (must still be tested live)

| Area | Source status | Evidence/next verification |
|---|---|---|
| Public landing, listings and directory | Implemented in frontend/API | Verify visual/browser behavior and public-field privacy. |
| Signup/login/logout/session | Implemented in source | Verify clean DB migration and live cookies. |
| Verification and reset | Implemented in source | Verify actual Resend delivery, expiry and single-use behavior. |
| Profiles and organizations | Implemented in source | Test ownership and approved public records in PostgreSQL. |
| Offers and needs | Implemented in source | Test role and status transitions in staging. |
| Interests and invitations | Implemented in source | Test duplicate prevention and email delivery. |
| Availability and booking | Implemented in source | Run PostgreSQL smoke test and concurrent request tests. |
| Feedback, notifications, activity emails | Implemented in source | Verify real mail/outbox retries. |
| Admin review/access | Implemented in source | Test one-time bootstrap and access controls in staging. |
| Render Blueprint | Prepared in source | Validate/apply in Render dashboard; choose billing plan deliberately. |
| Original feature parity | Not certified | Compare the complete original product requirements/source. |
| Private document uploads | Not implemented | Add a private storage/access-controlled flow only if required by V1. |

## Migration principles

- Do not use in-memory stores for real application runtime.
- Run numbered migrations as a controlled pre-deploy step; the web service verifies database readiness on startup and does not automatically migrate on every restart.
- Do not migrate real Supabase data without explicit approval, a backup, a written mapping, a cutover plan and rollback procedure.
- Never put server secrets in frontend build variables or Git.
