# 06 — Phase 1: secure application inbox

Status: implemented and tested; **not deployed, not approved for production**.

## Flow
1. `docs/apply.html` calls the existing Registry `POST /applications` unchanged and receives the RCGI (`participantId`).
2. It then POSTs the answers to the separate public **intake Worker** (`src/intake.js`, `wrangler.intake.toml`, no route configured). Intake is write-only: strict allowlist validation, 8 KB cap, CORS limited to the public site origins, insert-only (`INSERT OR IGNORE`), identical `202` for new and duplicate RCGIs, no logging of content.
3. Rows land in D1 `applications` (migration `0002_applications.sql`). The only read path is the Access-protected Control Center Worker.
4. The public Registry and website never receive answers; no applicant contact data is collected.

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
- The Registry contract is unverified: intake cannot confirm that an RCGI was really issued, so a party who guesses an unused RCGI could submit first. Verify with the Registry (or have the Registry issue a signed receipt) before launch.
- Add Cloudflare WAF rate limiting/bot protection on the intake hostname; assign the hostname (the form assumes `intake.recoveryforwardfoundation.org`) before merging the form change, otherwise applicants see a delivery-failed notice.
- Both Workers share one D1 database; intake code only inserts, but D1 has no per-Worker permissions. Consider a separate intake database/queue.
- Free-text answers may contain sensitive information; no field-level encryption yet. Define retention and deletion policy.
- The admin UI (`admin-prototype/`) has no inbox screen yet; Phase 1 is API-level.
