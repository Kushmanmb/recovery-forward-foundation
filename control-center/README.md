# President Control Center

This is a separate Cloudflare Worker application for `admin.recoveryforwardfoundation.org`. The public GitHub Pages site in `docs/` is unchanged. The mobile-friendly UI is sourced from `admin-prototype/`; it is not safe to serve that directory independently because the Worker verifies Cloudflare Access identity on every request.

**Undeployed and not approved for production.** Do not deploy until the President reviews the authentication, Access MFA policy, D1 configuration, Registry contract, operational controls, and the incomplete items below. CI runs tests only and never deploys.

## Implemented boundary

- The Worker verifies the signature of `Cf-Access-Jwt-Assertion` using Cloudflare's published RSA keys and validates issuer, audience, expiry, subject, and email. It does not trust browser-supplied identity headers or email values.
- A configured President email can bootstrap the first pending President account only when the member table is empty. The President must acknowledge the security/privacy requirements before the account becomes active. There is no public registration.
- All API requests require both a verified Access assertion and a non-expired, server-side D1 session bound to that identity. Session cookies are random, hashed before storage, `Secure`, `HttpOnly`, `SameSite=Strict`, and revoked on sign-out.
- Server authorization uses the role permission table in `src/rbac.js`; the audit endpoint is President-only. Suspended or pending accounts cannot access protected APIs.
- The Registry adapter is GET-only, holds its token server-side, and returns only validated aggregate counts. It is disabled without configuration. The actual Registry API contract has not been inspected; see blockers.
- Audit events are stored in D1 with update/delete-blocking triggers. This does not protect against a database administrator or provide external tamper evidence.

## Manual prerequisites and blockers

1. Confirm that the Cloudflare account, Workers plan, D1 location/retention, backups, and organization privacy requirements are appropriate.
2. Configure Cloudflare Access for the exact admin hostname. Initially allow only the President's approved identity and require MFA. Set the maximum Access session lifetime to 8 hours. Verify the policy actually blocks sign-in without MFA; the Worker cannot infer MFA from an unverified browser claim. Keep Access in front of both the UI and API.
3. Additional officer account invitation, delivery, acceptance, activation, recovery, and suspension administration are not yet implemented as UI/API workflows. Do not insert members directly into production D1 without a reviewed, audited provisioning procedure.
4. The Control Center summary adapter expects a reviewed, read-only endpoint returning `{"summary":{"statusCounts":{"pending":0,"verified":0,"closed":0}}}`. The public intake verifies RCGIs with `GET /integration/participants/{RCGI-ID}/exists`, returning `{"exists":true|false}`. Registry owners must approve the authorization scopes and privacy review before setting credentials. Both integrations fail closed if unavailable; no applicant record payload is returned to the browser.
5. D1 sessions and audit rows are not encrypted by application code, externally anchored, or configured for backup/restore here. Confirm Cloudflare's at-rest controls and perform a restore drill before any production use.
6. Perform an independent security review and test the deployed Access/DNS policy in staging. No live finance transactions, applicant records, or Registry writes are supported.

## Configuration and deployment (manual only)

1. Review the Worker code, migration, threat model, and checklist with the President. Create the Cloudflare Worker and D1 database in the approved account; update `database_id` in `wrangler.toml` with the non-secret D1 ID.
2. Configure a proxied Cloudflare DNS record for `admin.recoveryforwardfoundation.org` and the Worker route in `wrangler.toml`. Configure an Access application for the exact hostname, allow only the approved President identity for initial bootstrap, require MFA, and deny by default. Do not change the public website DNS or Pages configuration.
3. Set the required runtime variables/secrets using the Cloudflare dashboard or Wrangler secret/variable commands (never commit values):
   - `ACCESS_TEAM_DOMAIN`: the Access team hostname, e.g. `<team>.cloudflareaccess.com` (no scheme).
   - `ACCESS_AUD`: the Access application audience tag for the admin application.
   - `PRESIDENT_EMAIL`: the one approved bootstrap identity.
   - `REGISTRY_API_URL` and `REGISTRY_API_TOKEN`: for the Control Center aggregate summary only; optional and **leave unset** until that upstream read-only contract is reviewed. The URL must use HTTPS and the exact official Registry API hostname.
   - For the separate intake Worker only, set `REGISTRY_RCGI_VERIFY_URL` to `https://api.recoveryforwardfoundation.org/integration/participants` and `REGISTRY_INTEGRATION_TOKEN` to the dedicated Registry integration secret, after Registry owners approve its least-privilege scope.
   - For the separate intake Worker only, set `INTAKE_RATE_LIMIT_SECRET` as a random secret of at least 32 characters. The rate limiter fails closed when this secret or its D1 storage is unavailable.
4. Apply `migrations/` to the intended D1 environment only after backup and President approval. The intake migration `0003_intake_abuse_controls.sql` is not applied automatically. Test authentication, MFA enforcement, bootstrap, account suspension, session revocation, role-denied audit access, Registry verification/failure behavior, rate limits, and atomic intake writes with synthetic data.
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
