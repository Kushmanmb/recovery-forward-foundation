# Role & Permission Matrix
Source of truth: `src/rbac.js`. Default deny. Individual grants/revokes allowed; `mailbox:others:read`, `votes:extra`, `audit:write` never grantable. App admin rights give no votes and no access to others' mailboxes. Shared contact inbox: President and Secretary only.

| Permission | Pres | VP | Sec | Treas | Member |
|---|---|---|---|---|---|
| invite/activate/suspend/permissions | ✔ | | | | |
| security & audit read | ✔ | | | | |
| board docs read, meetings request, agenda propose | ✔ | ✔ | ✔ | ✔ | ✔ |
| minutes draft, records write | | | ✔ | | |
| finance read | ✔ | ✔ | ✔ | ✔ | ✔ |
| finance write, payment prepare | | | | ✔ | |
| payment authorize | ✔ (president) | | | ✔ (treasurer) | |
| contact inbox | ✔ | | ✔ | | |

# Requirements Traceability
| § | Requirement | Status | Evidence |
|---|---|---|---|
| 1,2 | Preserve site; separate app; no deploy | Met | `docs/` untouched; CI guard |
| 2 | Edge auth insufficient | Designed + library authZ | rbac tests |
| 3 | Invite, MFA, ack, manual activation | Library tested | "invitation" test |
| 3 | Suspension/revocation | Library tested | "suspension" test |
| 3 | Admin ≠ extra votes | Tested | RBAC test; voting uses director list |
| 4 | Audit tamper-evidence | Library tested | audit test |
| 4 | Alerts, monitoring, multi-party recovery | **Not built** — design in 04 | blocked: designate recovery admins, email provider |
| 5 | Quorum, votes, recusal, consent, unverified blocks | Library tested | governance tests |
| 5 | Meeting requests, agenda, notice, e-signature | Partial (notice check); rest **not built** | blocked: bylaws/legal |
| 6 | Calendar/Meet, no recording | **Not built** | needs Workspace |
| 7 | Immutable records/amendments | Library tested | records test |
| 8 | Document library | Permission check only | needs R2/DB |
| 9 | Mailboxes | Permission check only | needs Workspace provisioning |
| 10 | Applicant portal | Isolation check only | needs auth, registry |
| 11 | Registry integration | Mock only | registry inaccessible |
| 12 | Attestation separation | Tested | attestation test |
| 13 | Committee | Tested (library) | grant test; authority blocked on bylaws |
| 14 | Dual payment auth; no transfers | Tested; record-only | payment test |
| 15 | Financial center | **Not built** (demo data only when built) | |
| 16 | Donations deferred | Met | nothing built |
| 17 | Tests listed | Partial: all library-level areas except recovery workflows, document/mailbox integration | 17 passing tests |
