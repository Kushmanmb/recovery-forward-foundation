# Threat Model & Controls
| Threat | Control | Status |
|---|---|---|
| Public registration / takeover | No signup path; invite-only; manual activation | library |
| Role escalation | Server-side default-deny, non-grantable perms, denials audited | library |
| Stolen session after suspension | Per-request status check + revoke | library |
| Invite token theft/replay | 256-bit token, hash stored, 48h, single-use | library |
| Audit tampering | Hash chain; anchor head hash externally (R2 object lock/Logpush) | library; anchoring planned |
| Insider mailbox snooping | Own-mailbox rule; no admin override; delegated OAuth only | function; Workspace pending |
| Applicant IDOR | Ownership check; RCGI is not a credential | library |
| Self-approval / fraud | Separation of duties, dual auth, independent reconciliation | library |
| Secret leakage | Env secrets, secret scanning, no secrets in bundle/Pages | planned CI |
| Rogue emergency recovery | Multi-party approvals, independent verification, no MFA bypass, revoke sessions after, full log | **design only** (recovery admins TBD) |
| Alert content leakage | Alerts contain event type/time only, never grant/medical data | planned |
Alerts: critical → President's verified email immediately; daily digest; failed-login, lockout, privilege-change, recovery events. **Not built.**
Checklist before any production use: pen test, dependency + secret scanning in CI, CodeQL, MFA enforcement verification, backup restore drill, legal review.
