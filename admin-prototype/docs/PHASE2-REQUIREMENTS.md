# Phase 2 Requirements — President Control Center

Phase 1 (`admin-prototype/`) is a **static, sample-data prototype**. It has no authentication, stores nothing, and must never be treated as operational.

## Deployment rules
- Lives outside `docs/` so GitHub Pages (which serves `docs/`) does not publish it. Do not move it there.
- Operational dashboard must be hosted privately (e.g. separate private repo/app behind authentication, on a distinct subdomain such as `admin.` with its own hosting). Public site stays static and untouched.
- No deployment or merge to `main` without President approval.

## Backend
- API service + database (e.g. PostgreSQL) holding members, roles, documents metadata, meetings, finance records, audit log.
- Secrets in a secret manager/environment variables; never in the repository.
- Encrypted at rest and in transit (TLS only), automated backups, least-privilege DB access.

## Authentication
- Managed identity provider or audited library (OIDC); no custom password storage. Passwords, if used, hashed with Argon2id.
- Server-side sessions or short-lived tokens, secure/HttpOnly/SameSite cookies, rate limiting, lockout, CSRF protection.
- Lock/unlock switch becomes a server-side account status change that revokes all sessions immediately; each change is audit-logged with actor, time, and reason.

## Role-based access control
Roles: President, Vice President, Secretary, Treasurer, Member. Permissions per role are defined in the Security section of the prototype. Enforcement must be **server-side** on every request; the UI only reflects permissions. Default deny. Only the President may lock/unlock, invite, or remove members; role changes require a second confirmation.

## Secure invitation & 2FA plan
1. President creates invite (name, email, role) — account created in locked/pending state.
2. System emails a single-use, high-entropy link expiring in 24–72h; token stored only as a hash.
3. Invitee sets up credentials and **must enrol 2FA** (TOTP app or passkey/WebAuthn preferred; SMS discouraged) before access.
4. One-time recovery codes issued, stored hashed; recovery resets require President approval.
5. Account remains locked until enrolment completes; expired/unused invites are revoked and logged.
6. Re-authentication (2FA) required for sensitive actions (finance, role/lock changes).

## Email hosting
- Organization-owned domain with hosted mail (e.g. Google Workspace or Microsoft 365) providing one mailbox per board member.
- SPF, DKIM, DMARC configured; mandatory MFA on mailboxes; mailbox suspension linked to account lock via the provider's admin API.
- Dashboard shows mail via provider SSO/API, not by storing message content.

## Compliance & operations
- Audit log append-only and exportable; retention policy defined.
- Privacy: minimize personal data; grant applicants referenced by RCGI ID only.
- Security review, dependency scanning, and penetration test before launch.
