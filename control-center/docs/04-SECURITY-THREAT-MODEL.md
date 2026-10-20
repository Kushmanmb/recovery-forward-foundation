# Threat Model & Security Checklist

| Threat | Control | Status |
|---|---|---|
| Public access / registration | Cloudflare Access assertion is signature-, issuer-, audience-, subject-, email-, and time-validated before serving UI or API; first account is bound to one deployment-configured President identity | Implemented; Access application/policy must be manually configured |
| MFA bypass | Access policy must require MFA; no browser-provided MFA or identity claim is trusted | Manual staging verification required |
| Session theft/replay | 256-bit random opaque token, SHA-256 hash stored in D1, 8-hour expiry, Secure/HttpOnly/SameSite=Strict cookie, per-request Access and session checks | Implemented |
| Session revocation | Sign-out revokes the server-side session; accounts with suspended status are rejected on each request | Sign-out implemented; member suspension workflow not implemented |
| Role escalation | Default-deny server-side permission checks; audit endpoint restricted to President; new members are not self-registerable | Implemented for available endpoints; officer provisioning workflow incomplete |
| CSRF | Same-origin checks on state-changing endpoints; SameSite=Strict cookie; no cross-origin API support | Implemented |
| Cross-site scripting / framing | Escaped UI content, restrictive CSP, frame denial, no inline executable scripts | Implemented; independently review before deployment |
| Registry credential/data exposure | Server-only bearer token; fixed official API host, HTTPS GET only, response size/schema checks, allowlisted aggregate response fields | Adapter boundary implemented; upstream contract and endpoint not verified; disabled until approved |
| Applicant personal information | Registry summary exposes aggregate counts only. Application answers (Phase 1) are stored in D1, readable only by the President and the assigned authorized reviewer, with audited access; see 06-APPLICATION-INBOX.md | Implemented at application boundary; verify upstream aggregate endpoint before enabling |
| Audit alteration | D1 triggers reject update/delete; API writes minimal actor/action details and reads are President-only | Implemented; not tamper-proof against D1 administrators and not externally anchored |
| Credential leakage | No credentials in source, HTML, browser storage, URLs, or error responses | Environment setup documented; secret scanning required before commit |
| Abuse / excessive requests | Cloudflare Access in front of all routes; D1-backed sessions | Configure Cloudflare rate limiting and alerting before production; app-level rate limiting is not implemented |
| Financial misuse | No payment execution or Registry write endpoint exists | Not implemented; no live transactions |

## Deployment approval checklist

- [ ] President approves the reviewed code, hosting account, D1 region/retention, and operational owner.
- [ ] Access protects the exact admin hostname, initially allows only the approved President identity, requires MFA, uses deny-by-default rules, and has a maximum session duration of 8 hours.
- [ ] Staging tests prove that missing, invalid-signature, wrong-issuer, wrong-audience, expired, and no-MFA identities cannot access the app.
- [ ] Bootstrap works only for the configured President when the member table is empty; policy acknowledgement is recorded; uninvited identities cannot register.
- [ ] Every API route has a role-authorization test; session expiry, logout revocation, suspended-account denial, and CSRF checks are verified.
- [ ] Registry owners approve the exact read-only endpoint/schema and least-privilege token; an integration test confirms no applicant data or token reaches the browser or logs.
- [ ] D1 backups, retention, restore drill, audit export/retention, monitoring, and incident response are approved.
- [ ] External security review, penetration test, dependency/secret scanning, and legal/privacy review are complete.
- [ ] Confirm public GitHub Pages and the Registry API are unchanged; confirm no deployment automation is enabled.

Officer invitations and lifecycle administration, app-level rate limiting, durable audit anchoring, alerting, external review, and production MFA verification remain incomplete. Keep the Worker undeployed until all applicable checks are approved.
