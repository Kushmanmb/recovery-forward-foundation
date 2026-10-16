# Integrations, Runbooks, Legal Checklist, Rollout

## Integrations (all unconfigured)
Google Workspace/Calendar/Meet: need Workspace tenant, API enablement, OAuth consent, scoped delegation per mailbox; recording disabled. Cloudflare: DNS for `admin.`, Access policy, Workers, R2 (private), WAF. Database: Neon Postgres (TLS, roles, PITR). Registry: contract `register(rcgi)`, stage events append-only, two-party attestation preserved; mock only until repo access/API is available.

## Backup / recovery runbook (plan)
Daily DB backups + PITR; R2 versioning; audit head hash anchored; quarterly restore drill into staging with synthetic verification; RPO ≤ 24h, RTO ≤ 8h (targets, to be approved). Deployment: staging→prod via GitHub Environment with required President approval; rollback = redeploy previous tag. Account recovery: offline codes; multi-party emergency process (design only).

## Legal & governance dependencies (blockers)
Verified bylaws and Indiana nonprofit law review (quorum, notice, remote participation, written consent, committee authority, e-signature validity); board resolutions for officers/committee; HIPAA/42 CFR Part 2 assessment and applicant authorizations; privacy policy; IRS status before any tax-deductibility claim; designation of recovery administrators; Workspace/Cloudflare/Neon accounts; DNS access; registry access.

## Staged rollout & acceptance
- **A Foundation:** server, IdP, DB, authZ, audit, CI; accept: all security tests pass against real stack, pen test, restore drill.
- **B Board ops:** governance, meetings, records, documents; accept: verified governance config, legal sign-off.
- **C Communications:** Workspace integration; accept: mailbox isolation tests on real tenant.
- **D Grants:** applicant portal, registry, attestations, committee; accept: privacy review, cross-applicant tests.
- **E Finance:** budgets, reconciliation, payment records; no transfers; accept: Treasurer + President dual-control walkthrough.
Each stage needs explicit approval; feature flags default off.
