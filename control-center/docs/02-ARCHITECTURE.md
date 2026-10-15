# Architecture & Implementation Plan

Public site: GitHub Pages (`docs/`), unchanged. Private app: separate Cloudflare-hosted application at `admin.recoveryforwardfoundation.org` — **not deployed**. Recommend a separate private repo for the app; `control-center/src` is the portable, dependency-free domain core to move or reuse.

Layers: Cloudflare Access (edge gate, insufficient alone) → API (authN via Google OIDC + MFA, authZ via `rbac.js` on every call) → data-access (authZ re-checked; Postgres roles, append-only audit table) → Neon Postgres, R2 private bucket (signed short-lived URLs), Google Workspace APIs (delegated OAuth, least-privilege scopes, tokens encrypted, server side only).

**Limits/costs/dependencies to validate before final selection:** Workers CPU/size limits and Node compatibility; Neon region, PITR window and plan; R2 egress/signing; Google Workspace API scopes and admin consent (domain-wide delegation must not be used to give admins others' mail); nonprofit pricing eligibility. Estimated costs: see `admin-prototype/docs/PHASE2-PLAN.md` (~$0–15 lean, ~$60–100 expected /month; unverified).

Secrets: only in Cloudflare/GitHub Environment secrets; never in repo, Pages, or browser bundles. Feature flags default OFF; deny-by-default.

Identity: President = verified `mattbrace92@gmail.com` supplied via deployment secret (not committed, not assumed connected); `recoveryforwardfoundation@gmail.com` separate. Note: a personal Gmail cannot be enrolled as Workspace-managed; Google sign-in with Gmail needs OIDC allow-list plus app-enforced MFA/passkey — confirm with Google's MFA signals or use app-level WebAuthn. Open design decision.

Data model (core tables): members, roles, permission_grants, invitations(hash,exp,used), sessions, audit_log(append-only, hash chain), meetings, agenda_items, attendance, motions, votes, conflicts, written_consents, records, record_versions, amendments, documents, document_versions, applicants, applications(rcgi), attestations, committee_members, grant_decisions, payment_records, payment_authorizations, reconciliations, budgets, ledger_entries, alerts. API: REST per module, all routes behind session + permission checks, idempotent writes, audit on every mutation and denial.
