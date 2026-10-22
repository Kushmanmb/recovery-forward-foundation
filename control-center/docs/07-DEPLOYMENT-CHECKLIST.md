# 07 — Deployment checklist (application inbox)

Status: **NOT approved for deployment.** Nothing here has been run. Intake stays disabled (`INTAKE_URL = null` in `docs/apply.html`; no route in `wrangler.intake.toml`) until every blocker is cleared and the President approves in writing.

## Deployment blockers
- [ ] Registry owners confirm `GET /integration/participants/{RCGI-ID}/exists` and the `{"exists": true|false}` response. This is an **unverified proposed contract**.
- [ ] Registry owners confirm `REGISTRY_INTEGRATION_TOKEN` is read-only and least-privilege.
- [ ] Cloudflare Bot Management, WAF managed challenge and network rate limits enabled on the intake hostname.
- [ ] Data retention and deletion policy defined for free-text answers (no field-level encryption yet).
- [ ] Decision on a separate intake database/queue (both Workers share one D1 database).
- [ ] Security review of the intake Worker and public form, and President approval.
- [ ] Intake hostname chosen and CORS tested from the public site (CORS is not access control).

## 1. Staging
- [ ] Create a separate staging D1 database and Worker names; never point staging at the production `database_id`.
- [ ] Use test RCGIs and a Registry staging endpoint; no real applicant data.
- [ ] Verify: valid submission returns 202; duplicate returns identical 202; unknown RCGI returns 202 without storage; missing config returns 503; sixth request in ten minutes returns 429; oversized body returns 413.
- [ ] Verify the Control Center read paths enforce Access, President/reviewer authorization, and audit entries.
- [ ] Run `npm test` in `control-center/` and confirm all pass.

## 2. D1 backups
- [ ] Before any migration, export the target database (`wrangler d1 export <database> --remote --output <file>`) and store it in access-controlled storage, not the repository.
- [ ] Verify the backup by restoring it into a scratch database.
- [ ] Record the backup identifier and time in the approval record.

## 3. Migrations
- [ ] Apply `0002_applications.sql`, `0003_board_access.sql`, and `0004_intake_abuse_controls.sql` to staging first, after verifying the target database's migration history.
- [ ] Apply to production only after President approval, a verified backup, and a passing staging test.
- [ ] Confirm the audit table append-only triggers exist afterward.
- [ ] Do not apply migrations from CI or as part of a PR merge.

## 4. Cloudflare secrets and configuration
- [ ] `INTAKE_RATE_LIMIT_SECRET`: random, at least 32 characters; set with `wrangler secret put` on the intake Worker only.
- [ ] `REGISTRY_INTEGRATION_TOKEN`: set with `wrangler secret put` on the intake Worker only.
- [ ] `REGISTRY_RCGI_VERIFY_URL`: `https://api.recoveryforwardfoundation.org/integration/participants` (fixed host enforced in code).
- [ ] Never place secrets in source, `wrangler*.toml`, browser code, logs, URLs, issues, or PRs. Rotate any secret that is exposed.

## 5. Security requirements
- [ ] Intake Worker is write-only; only the Access-protected Control Center reads answers.
- [ ] Audit records contain RCGI and action only, never answers.
- [ ] Fail closed on missing rate-limit secret, client IP, Registry config, or Registry errors.
- [ ] Public site never receives answers back; no applicant contact data collected.
- [ ] Enable the route and set `INTAKE_URL` only in a separate, approved change, after the steps above.

## Rollback
- Remove the intake route and set `INTAKE_URL` back to `null`; restore the D1 backup only with President approval.
