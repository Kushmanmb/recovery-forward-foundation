# President Control Center

This is a separate Cloudflare Worker application for `admin.recoveryforwardfoundation.org`. Public GitHub Pages content is maintained in `docs/`. The mobile-friendly admin UI is sourced from `admin-prototype/`; it is not safe to serve that directory independently because the Worker verifies Cloudflare Access identity on every request.

**Undeployed and not approved for production.** Do not deploy until the President reviews the authentication, Access MFA policy, D1 configuration, Registry contract, operational controls, and the incomplete items below. CI runs tests only and never deploys.

## Implemented boundary

- The Worker verifies the signature of `Cf-Access-Jwt-Assertion` using Cloudflare's published RSA keys and validates issuer, audience, expiry, subject, and email. It does not trust browser-supplied identity headers or email values.
- A configured President email can bootstrap the first pending President account only when the member table is empty. The President must acknowledge the security/privacy requirements before the account becomes active. There is no public registration.
- All API requests require both a verified Access assertion and a non-expired, server-side D1 session bound to that identity. Session cookies are random, hashed before storage, `Secure`, `HttpOnly`, `SameSite=Strict`, and revoked on sign-out.
- Server authorization uses the role permission table in `src/rbac.js`; the audit endpoint is President-only. Suspended or pending accounts cannot access protected APIs.
- The Registry summary adapter is GET-only, holds its token server-side, and returns only validated aggregate counts. It is disabled without configuration. The Registry is the private repository `Kushmanmb/recovery-grant-registry`; its contract is documented in that repository's `docs/FOUNDATION_INTEGRATION.md` and implemented in `api/server.js`. The summary adapter calls `GET /integration/summary`, which the Registry authenticates with its monitoring token. The intake's `/exists` check uses the separate read-only `REGISTRY_EXISTENCE_TOKEN` credential (see Registry credentials below).
- Audit events are stored in D1 with update/delete-blocking triggers. This does not protect against a database administrator or provide external tamper evidence.

## Manual prerequisites and blockers

1. Confirm that the Cloudflare account, Workers plan, D1 location/retention, backups, and organization privacy requirements are appropriate.
2. Configure Cloudflare Access for the exact admin hostname. Initially allow only the President's approved identity and require MFA. Set the maximum Access session lifetime to 8 hours. Verify the policy actually blocks sign-in without MFA; the Worker cannot infer MFA from an unverified browser claim. Keep Access in front of both the UI and API.
3. Board invitation, acceptance, manual activation, suspension, and reinstatement now have persistent API/UI workflows; see `docs/07-BOARD-ACCESS.md`. Invitation delivery is manual. Identity and MFA verification are explicitly attested by the President; Access must enforce MFA independently. Automated delivery, recovery, and step-up authentication are still outstanding. Do not insert members directly into production D1.
4. The Registry is `Kushmanmb/recovery-grant-registry` (private); the contract is in its `docs/FOUNDATION_INTEGRATION.md`. The Control Center summary adapter calls `GET /integration/summary` and expects `{"summary":{"statusCounts":{"pending":0,"verified":0,"closed":0}}}`. The public intake verifies RCGIs with `GET /integration/participants/{RCGI-ID}/exists` (RCGI format `RCGI-` plus 12 lowercase hex characters) and expects exactly `{"exists":true|false}`; the Registry returns 401 for a missing or invalid bearer token, 400 for malformed lookups, and 503 when unavailable. Both contracts were verified against the Registry source and are compatible with this code, but **live authenticated testing and production secret configuration are still pending**: both integrations must stay unconfigured until Registry owners set and share the credentials through a secret manager and a staging check with a synthetic RCGI passes. Both integrations fail closed if unavailable; no applicant record payload is returned to the browser.
5. D1 sessions and audit rows are not encrypted by application code, externally anchored, or configured for backup/restore here. Confirm Cloudflare's at-rest controls and perform a restore drill before any production use.
6. Perform an independent security review and test the deployed Access/DNS policy in staging. No live finance transactions, applicant records, or Registry writes are supported.

## Configuration and deployment (manual only)

1. Review the Worker code, migration, threat model, and checklist with the President. Create the Cloudflare Worker and D1 database in the approved account; update `database_id` in `wrangler.toml` with the non-secret D1 ID.
2. Configure a proxied Cloudflare DNS record for `admin.recoveryforwardfoundation.org` and the Worker route in `wrangler.toml`. Configure an Access application for the exact hostname, allow only the approved President identity for initial bootstrap, require MFA, and deny by default. Do not change the public website DNS or Pages configuration.
3. Set the required runtime variables/secrets using the Cloudflare dashboard or Wrangler secret/variable commands (never commit values):
   - `ACCESS_TEAM_DOMAIN`: the Access team hostname, e.g. `<team>.cloudflareaccess.com` (no scheme).
   - `ACCESS_AUD`: the Access application audience tag for the admin application.
   - `PRESIDENT_EMAIL`: the one approved bootstrap identity.
   - **Registry credentials are two different secrets and are not interchangeable:**
     - `REGISTRY_API_URL` and `REGISTRY_API_TOKEN` (Control Center Worker): used only for the aggregate summary at `/integration/summary`. `REGISTRY_API_TOKEN` must hold the Registry's *monitoring* token (`REGISTRY_MONITORING_TOKEN` on the Registry side). Optional; **leave unset** until live testing is approved. The URL must use HTTPS and the exact official Registry API hostname.
     - `REGISTRY_RCGI_VERIFY_URL` and `REGISTRY_EXISTENCE_TOKEN` (separate intake Worker only): used only for the RCGI existence check. `REGISTRY_RCGI_VERIFY_URL` must be exactly `https://api.recoveryforwardfoundation.org/integration/participants` (the Worker appends `/{RCGI-ID}/exists`), and `REGISTRY_EXISTENCE_TOKEN` must be the same read-only secret configured as `REGISTRY_EXISTENCE_TOKEN` on the Registry side. **Keep both unset** until live authenticated testing is approved. This token must not be reused for the summary integration.
   - For the separate intake Worker only, set `INTAKE_RATE_LIMIT_SECRET` as a random secret of at least 32 characters. The rate limiter fails closed when this secret or its D1 storage is unavailable.
4. Apply `migrations/` to the intended D1 environment only after backup and President approval. The application inbox and intake rate-limit migrations are not applied automatically. Test authentication, MFA enforcement, bootstrap, account suspension, session revocation, role-denied audit access, Registry verification/failure behavior, rate limits, and atomic intake writes with synthetic data.
5. Only after written approval, deploy manually with the reviewed Wrangler version and environment. No CI workflow deploys this Worker.

### Required secrets and safe handling

Do not add real values to source, `.env` files, build artifacts, browser storage, or logs. Use Cloudflare Worker secrets for the President email, each Registry token, and `INTAKE_RATE_LIMIT_SECRET`; keep Access domain/audience and endpoint URLs as environment configuration. Never put a Registry token in a URL or client response.

### Rollback

Disable the Worker route or roll back to the last reviewed Worker version while retaining the Access deny-by-default policy. Do not remove Access as a rollback shortcut. For database changes, stop traffic first and restore a verified D1 backup/export; do not apply destructive schema changes or delete audit records. Confirm the public Pages site and Registry API remain unchanged.

## Development and tests

Requires Node.js 22 or newer. Tests are dependency-free:

```sh
npm test --prefix control-center
```

The test suite uses synthetic identity keys/data and never contacts production services. Local development against a real Cloudflare account is intentionally not configured by default.


## Implementation status

- Worker/UI workflows: verified Access identity, D1 sessions, President bootstrap, board access administration, audit activity, and optional read-only Registry summary.
- Application inbox: backend/API and write-only intake are included; Registry `/exists` verification matches the Registry's documented contract but live authenticated testing and secret configuration are pending, so it is disabled without configuration. The public form's intake integration remains dormant until separately approved.
- Domain logic only: governance, grant approvals, payment authorization, document classification, and mailbox permissions. These are not persistent operational modules yet.
- Remaining integration work: meetings/agendas/votes/minutes and official records, document storage and version history, grants/reviewer UI, finance/reconciliation, provider-backed communications, notifications and recovery operations. Each needs its own persisted API, UI, authorization checks, and end-to-end validation.
