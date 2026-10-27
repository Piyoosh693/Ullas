# Staging Acceptance Checklist

## Visitor flow

- Landing page loads
- Public directory and profile view render without auth
- Invalid or empty form submissions fail cleanly

## Professional flow

- Sign up and verify email
- Login and view profile
- Create offer/need and manage status
- Express interest and accept/decline invitation

## Organization flow

- Create organization
- Submit verification request
- Manage availability and booking requests

## Admin flow

- Access admin dashboard
- Review verification requests
- Moderate and inspect activity data

## Rollback plan

- Keep the previous Supabase-based repo branch or backup until final parity is verified.
- Use feature-flagged migration logic where possible.
- Revert by redeploying the prior branch if the staging deployment fails a critical flow.
