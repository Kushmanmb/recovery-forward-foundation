# 06 — Phase 1: secure application inbox

Status: implemented and tested; **not deployed, not approved for production**.

## Intake security and flow
`docs/apply.html` is unchanged in this PR and does not currently POST application answers to this Worker. A separately reviewed public-form change is required before end-to-end submissions can work; do not modify or publish that change as part of this backend review.

The public write-only Worker (`src/intake.js`, `wrangler.intake.toml`, no route configured) applies strict allowlist validation and an 8 KB body cap. CORS only controls browser access to responses; it is not authentication, and originless or other non-browser POST requests are accepted subject to the same server-side checks.

Before storing, the Worker checks the RCGI with the dedicated server-side bearer secret `REGISTRY_RCGI_VERIFY_TOKEN` at `REGISTRY_RCGI_VERIFY_URL` on the fixed official Registry API host. It appends `?rcgi=<RCGI>` and requires a successful JSON response containing a boolean `exists`. Missing configuration, unauthorized responses, redirects, invalid JSON/schema, oversized responses, and timeouts all fail closed with a generic `503`. A well-formed but nonexistent RCGI gets the same generic `202` response as a new or duplicate application and is not stored. A duplicate cannot overwrite an existing application; new and duplicate requests receive identical `202` bodies.

**Registry contract blocker:** the Registry repository/API is not accessible from this repository, so the existence endpoint path and response schema above have not been independently verified. Registry owners must confirm that the configured endpoint is the existing authenticated read-only RCGI existence endpoint and that its response has this meaning before launch. Do not configure credentials or deploy based on an assumed endpoint.

Every POST is limited to five attempts per Cloudflare client IP per fixed ten-minute window. The key is HMAC-SHA-256 hashed with `INTAKE_RATE_LIMIT_SECRET`; raw IP addresses are not stored. If the IP, secret, or D1 limiter is unavailable, intake fails closed. When Cloudflare Bot Management supplies a score below 30, the request receives the same generic `202` without Registry lookup or storage. These are application controls, not a substitute for Cloudflare WAF/managed challenge and network-level rate limits; enable and validate those before launch to address distributed abuse.

The application row and its minimal `application_received` audit event are written in one D1 `batch()` transaction. The audit records only the RCGI and action, never answers. Rate-limit counters are stored in `intake_rate_limits` (migration `0003_intake_abuse_controls.sql`); stale windows are removed during requests.

Only the Access-protected Control Center Worker has application read paths. The Registry and public website never receive answers; no applicant contact data is collected.

## Control Center API (all require Access + D1 session; writes are same-origin JSON)
| Endpoint | Who |
|---|---|
| `GET /api/applications` (summaries: RCGI, status, assignee, timestamps) | President: all; authorized reviewer: assigned only |
| `GET /api/applications/:rcgi` (full detail) | President; assigned reviewer. Others get 403/404 |
| `POST /api/applications/:rcgi/assign` `{assignee}` / `null` | President (`applications:assign`) |
| `POST /api/applications/:rcgi/status` | President: `in_review`, `recommended`, `not_recommended`, `closed`; assigned reviewer: first three only |
| `GET/POST /api/applications/reviewers` `{email, authorized}` | President (`applications:reviewers:manage`) |

Statuses: `new` → `assigned` (via assignment) → `in_review` → `recommended` / `not_recommended` → `closed` (President). Reviewers only *recommend*; grant decisions, attestation and payment rules are unchanged and out of scope.

Reviewer authorization: only active, non-President members, stored in `application_reviewers`; surfaced as the individual grant `applications:review:assigned` (in no base role). Revoking a reviewer returns their open applications to `new`. Assignment requires an authorized reviewer.

## Audit
`application_received` (actor `system:intake`), `application_list_read`, `application_viewed`, `application_assigned`, `application_unassigned`, `application_status_changed`, `application_reviewer_authorized/revoked`, plus `authorization_denied`. Details contain RCGI and emails only, never answers. The table is append-only (triggers).

## Known limits / rollout prerequisites
- Confirm the exact existing RCGI existence endpoint, method, query/path format, response schema, timeout behavior, and least-privilege token with Registry owners. Configure `REGISTRY_RCGI_VERIFY_URL` and `REGISTRY_RCGI_VERIFY_TOKEN` only after written confirmation; the Worker intentionally fails closed when either is missing or the contract does not match.
- Generate and set `INTAKE_RATE_LIMIT_SECRET` as a Cloudflare Worker secret (at least 32 characters of random entropy). Never add it or the Registry token to source, browser code, logs, or URLs.
- Configure Cloudflare Bot Management for the intake hostname so the Worker receives bot scores, and add WAF managed challenge/network rate limits for distributed abuse. The application-level limit is per client IP and is not sufficient on its own.
- Before applicant use, make a separately approved public-form update that obtains and submits any required bot challenge and sends answers to the intake endpoint; `docs/apply.html` is deliberately unchanged here.
- Choose the intake hostname (the proposed form target is `intake.recoveryforwardfoundation.org`), configure the route only after security review, and test CORS from the public site. CORS is not an access control.
- Apply migrations `0002_applications.sql` and `0003_intake_abuse_controls.sql` to the intended D1 environment only after President approval, a verified backup, and a staging test. Do not apply migrations as part of this PR.
- Both Workers share one D1 database; intake code only inserts, but D1 has no per-Worker permissions. Consider a separate intake database/queue.
- Free-text answers may contain sensitive information; no field-level encryption yet. Define retention and deletion policy.
- The admin UI (`admin-prototype/`) has no inbox screen yet; Phase 1 is API-level.
