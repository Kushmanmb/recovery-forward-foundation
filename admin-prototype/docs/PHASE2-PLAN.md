# Phase 2 Plan — President Control Center (planning only)

Status: **proposal for approval**. Nothing here is implemented or deployed.

## Review of Phase 1
`admin-prototype/` is static HTML/CSS/JS with in-memory sample data. Lock switches, invites, and the email view are cosmetic. It is outside `docs/`, so Pages does not publish it. Reusable: layout, branding, section structure, RBAC matrix. Not reusable: all logic (must be rebuilt server-side). Open items: PR #1 stays unmerged until approved.

## Initial President identity (privacy note)
The sole initial President administrator is the address supplied by the President in the request. **It is deliberately not written into this repository** (public repo; Phase 1 rule: no personal data). It will be set as a deployment secret (`BOOTSTRAP_PRESIDENT_EMAIL`) and used once, to seed the first account. Bootstrap login still requires 2FA enrolment, and the bootstrap setting is removed after first use. Please confirm this approach or explicitly approve committing the address.

## Requirements mapping
| Requirement | Design |
|---|---|
| No public registration | Identity provider (IdP) sign-up disabled; no signup route exists; only pre-created users can authenticate. |
| President-only invitations | Invite endpoint requires role=President and recent 2FA. Single-use, hashed, 48h-expiring token; account created in *pending/locked* state. |
| Individual logins + RBAC | One account per member; roles President/VP/Secretary/Treasurer/Member; default-deny, enforced server-side on every API call (matrix in Phase 1 Security view). |
| Mandatory 2FA | Passkeys/WebAuthn preferred, TOTP fallback; no SMS. Login without enrolled factor is blocked. Step-up 2FA for finance, role, lock, invite actions. |
| Real ON/OFF switches | Switch sets `status=suspended` in DB and calls IdP "disable user + revoke all sessions/refresh tokens"; API checks status on each request (short-lived tokens, ≤15 min). Also suspends the member's mailbox. Audit-logged with actor and reason. President cannot suspend self; at least one active President always required. |
| Audit logs | Append-only table (no UPDATE/DELETE grants) for logins, invites, role/lock changes, document and finance access; export + retention policy; mirrored to external log storage. |
| Private hosting | `admin.recoveryforwardfoundation.org` behind Cloudflare Access (allow-list gate) **plus** app-level auth (defence in depth). Public site (`docs/`, GitHub Pages) untouched. |
| Email dashboards | Individual mailboxes + shared inboxes (e.g. board@, treasurer@) via hosted mail provider; dashboard uses SSO/provider API, stores no message bodies. |
| Secure recovery | No self-service email-only reset. Member loses factor → uses one-time recovery codes (stored hashed); otherwise President re-issues an invite after identity verification, old factors revoked. President recovery: two pre-enrolled hardware keys + offline recovery codes held by a named second custodian; documented break-glass procedure, logged. |

## Provider recommendations (monthly estimates, USD; verify current pricing before purchase)

### Authentication — **WorkOS-style managed IdP vs. Cloudflare Access + Google Workspace SSO**
Recommended: **Google Workspace as the IdP (OIDC) with Cloudflare Access in front**, since the foundation needs Workspace for email anyway. Workspace enforces 2-Step Verification/passkeys, admin-only user creation (no signups), and user suspend/session sign-out via Admin API. Cost: included with Workspace. Alternatives: Auth0/Clerk (~$25–100 for small orgs, extra vendor and user data); Microsoft Entra (included with M365).
Caveat: app-level roles live in the database; Workspace only proves identity.

### Email — **Google Workspace Business Starter** (~$7/user; Standard ~$14). Nonprofits may qualify for **Google for Nonprofits** (free Workspace tier — apply via Google/TechSoup). ~7 users ≈ $0–$50. Shared inboxes via Google Groups collaborative inbox (free) or shared mailbox delegation. Alternative: Microsoft 365 Nonprofit (discounted/free basic). Configure SPF, DKIM, DMARC in Cloudflare DNS.

### Hosting — **Cloudflare Workers/Pages (app + API) behind Cloudflare Access**
Free–$5/mo (Workers Paid). Zero Trust Access is free up to 50 users. Alternatives: Fly.io/Render (~$7–25) if a traditional server is preferred.

### Database — **Cloudflare D1** (SQLite, ~$0–5) for simplicity, or **Neon/Supabase Postgres** (~$0–25) if relational features (row-level security, append-only roles) are wanted. Recommendation: **Neon Postgres** (free–$19) for stronger audit-log permissioning; encrypted at rest, automated backups/PITR.

### Supporting
Cloudflare R2 for documents (~$0–2, private bucket, signed URLs); Cloudflare DNS/WAF/Turnstile (free); Resend/Postmark for invite emails (free–$15); Sentry/log storage (free–$26); domain already owned.

### Estimated total
| Tier | Monthly |
|---|---|
| Lean (nonprofit Workspace, free tiers) | **~$0–15** |
| Expected | **~$60–100** (7 Workspace seats ~$50 + Workers $5 + Neon $19 + email/logging) |
| Higher assurance | ~$150–250 (Workspace Standard, paid Auth, monitoring) |

## Cloudflare integration
- DNS zone for `recoveryforwardfoundation.org`: `admin.` CNAME to Workers/Pages custom domain; MX/SPF/DKIM/DMARC for mail; apex/www stay on GitHub Pages unchanged.
- Access policy: allow only invited, active members authenticated via Google SSO and 2FA; session ≤8h. Block everything else, including crawlers.
- WAF, rate limiting, Turnstile on invite acceptance; R2 for documents; Logpush for audit mirroring.
- Admin site is never served from the public Pages origin.

## GitHub integration
- Phase 2 code in a **separate private repository** (not the public one). Branch protection, required PR review by the President, CODEOWNERS.
- GitHub Actions: lint/test, dependency review, CodeQL, secret scanning; deploy via Cloudflare API token held in GitHub Environments with required-reviewer approval (no deploy without President approval). Staging and production environments.
- Secrets only in GitHub Environments / Cloudflare secrets, never in code.
- This public repo keeps only prototype and docs.

## Delivery plan (each step requires approval)
1. Approve providers, bootstrap-identity handling, budget. Create Workspace/Cloudflare/private repo.
2. Infrastructure: DNS, Access policy, DB schema, secrets, CI/CD (staging only).
3. Auth: bootstrap President, 2FA enforcement, invite flow, session revocation, suspend switch.
4. RBAC + audit log + admin UI (port Phase 1 views).
5. Email integration (mailboxes, shared inboxes, suspend link).
6. Recovery procedures, security review/pen test, backup restore drill.
7. Production launch with explicit approval; Phase 1 prototype retired.

## Risks
Single President = single point of failure (mitigate with second custodian recovery); vendor lock-in (OIDC/standard SQL keep it portable); costs vary — confirm nonprofit eligibility.

## Open questions
Confirm: Google vs Microsoft mail; nonprofit status for discounts; number of board members/shared inboxes; who is the recovery custodian; whether committing the President's address is acceptable.
