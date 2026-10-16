# Baseline Gap Report

Inspected: repo (`docs/` = public GitHub Pages site, untouched), PR #1 (draft, unmerged; Phase 1 prototype + Phase 2 plan), `admin-prototype/`.

**Recovery Grant Registry:** `Kushmanmb/recovery-grant-registry` could not be read from this environment (404: private or inaccessible). Its schemas, tests, lifecycle rules, RCGI rules, attestation and audit controls were **not inspected**. Integration is therefore a documented contract + mock (`MockRegistry`, flagged `live:false`). **Blocked until access is granted.**

| Area | Baseline (before) | Now |
|---|---|---|
| Auth/MFA/sessions | Prototype UI only | Domain logic + tests; **no IdP/server** |
| RBAC | Table in UI | Enforced default-deny library, tested |
| Invitations/activation | None | Library (hashed single-use expiring token, manual activation) |
| Suspension/session revocation | Cosmetic switch | Library semantics tested; no real sessions/IdP |
| Audit | None | Hash-chained log, tamper detection tested; no DB/anchoring |
| Governance (quorum, votes, consent, records) | None | Library; blocks finalization when rules unverified |
| Grant attestation/committee/payments | None | Library: separation of duties, dual auth, record-only |
| Applicant isolation | None | Library ownership check |
| Mailbox/document isolation | None | Permission functions only; no Google/R2 integration |
| Backend API, DB, UI port, Calendar/Meet, Workspace, R2, alert emails, e-signatures | None | **Not built** (needs vendor accounts, decisions; see 05) |
| Donations | None | Deliberately deferred |
| CI | None | `control-center-ci.yml` (tests; no deploy) |
