# 06 — Phase 1: secure application inbox

Status: implemented and tested; **not deployed, not approved for production**.

## Intake security and flow
`docs/apply.html` contains a **dormant** integration: `INTAKE_URL` is `null`, so no applicant answers are transmitted anywhere. Enabling it requires a separately approved change that sets the URL (and any bot challenge). Once enabled, the page sends answers only after the RCGI is created, maps 202/400/413/415/429/503/network errors to accurate messages, and offers a retry that re-sends only the intake request.

The public write-only Worker (`src/intake.js`, `wrangler.intake.toml`, no route configured) applies strict allowlist validation and an 8 KB body cap. CORS only controls browser access to responses; it is not authentication, and originless or other non-browser POST requests are accepted subject to the same server-side checks.

Before storing, the Worker checks the RCGI using the server-side bearer secret `REGISTRY_INTEGRATION_TOKEN` against `GET /integration/participants/{RCGI-ID}/exists` on the fixed official Registry API host. `REGISTRY_RCGI_VERIFY_URL` configures the `/integration/participants` base path; the validated RCGI is added as one URL-encoded path segment followed by `/exists`. Only a successful response with the exact JSON shape `{"exists": true}` verifies the RCGI; `{"exists": false}` is not stored and receives the same generic `202` response as a new or duplicate application. Missing configuration, unauthorized responses, redirects, malformed/oversized responses, and timeouts all fail closed with a generic `503`. A duplicate cannot overwrite an existing application; new and duplicate requests receive identical `202` bodies.

**Registry operational prerequisite:** the `/integration/participants/{RCGI-ID}/exists` endpoint and `{"exists": true|false}` response are an **unverified proposed contract**; they have not been confirmed to exist in the Registry API. The path and format above describe what this Worker expects. Before launch, confirm with Registry owners that `REGISTRY_INTEGRATION_TOKEN` is authorized for this read-only check and configure the base URL and secret in the intake Worker environment. The Worker fails closed if configuration is missing or the response does not match the specified format.

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
- Confirm the least-privilege scope and access of `REGISTRY_INTEGRATION_TOKEN` with Registry owners. Configure `REGISTRY_RCGI_VERIFY_URL` as the official `/integration/participants` base URL and `REGISTRY_INTEGRATION_TOKEN` only in the intake Worker environment; the Worker intentionally fails closed when either is missing or the response contract does not match.
- Generate and set `INTAKE_RATE_LIMIT_SECRET` as a Cloudflare Worker secret (at least 32 characters of random entropy). Never add it or the Registry token to source, browser code, logs, or URLs.
- Configure Cloudflare Bot Management for the intake hostname so the Worker receives bot scores, and add WAF managed challenge/network rate limits for distributed abuse. The application-level limit is per client IP and is not sufficient on its own.
- Before applicant use, make a separately approved change that sets `INTAKE_URL` in `docs/apply.html` (dormant, `null` today) and adds any required bot challenge.
- Choose the intake hostname (the proposed form target is `intake.recoveryforwardfoundation.org`), configure the route only after security review, and test CORS from the public site. CORS is not an access control.
- Apply migrations `0002_applications.sql` and `0003_intake_abuse_controls.sql` to the intended D1 environment only after President approval, a verified backup, and a staging test. Do not apply migrations as part of this PR.
- Both Workers share one D1 database; intake code only inserts, but D1 has no per-Worker permissions. Consider a separate intake database/queue.
- Free-text answers may contain sensitive information; no field-level encryption yet. Define retention and deletion policy.
- The admin UI (`admin-prototype/`) has no inbox screen yet; Phase 1 is API-level.
