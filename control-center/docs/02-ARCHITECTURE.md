# Architecture & Implementation Plan

Public site: GitHub Pages (`docs/`), unchanged. Private app: Cloudflare Worker at `admin.recoveryforwardfoundation.org`, configured in `control-center/wrangler.toml` — **not deployed**. Its UI assets remain outside `docs/`; the Worker verifies Cloudflare Access JWTs before serving assets or handling API calls.

Layers: Cloudflare Access (edge gate, MFA policy manually required) → Worker (signature/issuer/audience/expiry validation of Access assertion; server-side D1 session and RBAC on API calls) → D1 members, sessions, and append-only-triggered audit table. Registry access is a server-only, read-only adapter returning aggregate counts only; its upstream contract remains unverified.

**Limits/costs/dependencies to validate before final selection:** Workers CPU/size limits and Node compatibility; Neon region, PITR window and plan; R2 egress/signing; Google Workspace API scopes and admin consent (domain-wide delegation must not be used to give admins others' mail); nonprofit pricing eligibility. Estimated costs: see `admin-prototype/docs/PHASE2-PLAN.md` (~$0–15 lean, ~$60–100 expected /month; unverified).

Secrets: only in Cloudflare Worker secrets; never in repo, Pages, URLs, logs, or browser bundles. Registry integration remains disabled until its contract is reviewed.

Identity: the first President's email is supplied through the deployment environment and must match a verified Cloudflare Access assertion. Cloudflare Access must enforce MFA; the Worker does not trust browser claims about MFA. Account bootstrap is pending until the President acknowledges the security/privacy requirements. Additional account lifecycle workflows remain incomplete.

Data model (core tables): members, roles, permission_grants, invitations(hash,exp,used), sessions, audit_log(append-only, hash chain), meetings, agenda_items, attendance, motions, votes, conflicts, written_consents, records, record_versions, amendments, documents, document_versions, applicants, applications(rcgi), attestations, committee_members, grant_decisions, payment_records, payment_authorizations, reconciliations, budgets, ledger_entries, alerts. API: REST per module, all routes behind session + permission checks, idempotent writes, audit on every mutation and denial.
