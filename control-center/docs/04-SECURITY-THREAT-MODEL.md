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
| Registry credential/data exposure | Separate server-only bearer tokens; fixed official API host, HTTPS GET only, response size/schema checks, allowlisted response fields | Summary adapter and RCGI existence verification use server-side credentials; token scope must be approved |
| Applicant personal information | Registry summary exposes aggregate counts only. Application answers are stored only after server-side Registry RCGI verification, readable only by the President and assigned authorized reviewer, with audited access; duplicate and nonexistent RCGIs receive indistinguishable intake responses | Implemented fail-closed; Registry token scope and production configuration require approval |
| Audit alteration | D1 triggers reject update/delete; API writes minimal actor/action details and reads are President-only | Implemented; not tamper-proof against D1 administrators and not externally anchored |
| Credential leakage | No credentials in source, HTML, browser storage, URLs, or error responses | Environment setup documented; secret scanning required before commit |
| Public intake abuse | D1-backed per-client-IP request limit using HMAC pseudonyms; Cloudflare Bot Management score suppression when available; fixed response bodies and no content logging | Worker controls implemented; requires a random rate-limit secret, Bot Management, and WAF managed challenge/network rate limits before production |
| Financial misuse | No payment execution or Registry write endpoint exists | Not implemented; no live transactions |

## Deployment approval checklist

- [ ] President approves the reviewed code, hosting account, D1 region/retention, and operational owner.
- [ ] Access protects the exact admin hostname, initially allows only the approved President identity, requires MFA, uses deny-by-default rules, and has a maximum session duration of 8 hours.
- [ ] Staging tests prove that missing, invalid-signature, wrong-issuer, wrong-audience, expired, and no-MFA identities cannot access the app.
- [ ] Bootstrap works only for the configured President when the member table is empty; policy acknowledgement is recorded; uninvited identities cannot register.
- [ ] Every API route has a role-authorization test; session expiry, logout revocation, suspended-account denial, and CSRF checks are verified.
- [ ] Registry owners approve the exact read-only endpoint/schema and least-privilege token; an integration test confirms no applicant data or token reaches the browser or logs.
- [ ] Registry owners approve least-privilege access for `REGISTRY_INTEGRATION_TOKEN`; staging proves invalid, nonexistent, valid, duplicate, unauthorized, and unavailable cases fail safely against `GET /integration/participants/{RCGI-ID}/exists`.
- [ ] Set `REGISTRY_RCGI_VERIFY_URL`, `REGISTRY_INTEGRATION_TOKEN`, and a random `INTAKE_RATE_LIMIT_SECRET` only in the intake Worker environment; verify secrets never appear in browser responses, logs, or URLs.
- [ ] Configure and test Cloudflare Bot Management, WAF managed challenge, and network-level rate limits for the public intake hostname; verify the Worker receives the expected bot score.
- [ ] Apply migrations `0002_applications.sql` and `0003_intake_abuse_controls.sql` only to the approved environment after backup and President authorization.
- [ ] D1 backups, retention, restore drill, audit export/retention, monitoring, and incident response are approved.
- [ ] External security review, penetration test, dependency/secret scanning, and legal/privacy review are complete.
- [ ] Confirm public GitHub Pages and the Registry API are unchanged; confirm no deployment automation is enabled.

Officer invitations and lifecycle administration, distributed-abuse mitigation, durable audit anchoring, alerting, external review, and production MFA verification remain incomplete. Registry token scope still requires owner approval, and the public form is not wired to the intake Worker. Keep the Worker undeployed until all applicable checks are approved.
