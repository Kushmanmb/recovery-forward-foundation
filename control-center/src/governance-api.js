import { can } from "./rbac.js";
import { auditStatement, changed, cleanText, readJson, reply, sameOrigin } from "./http.js";
import * as P from "./proposals.js";
import * as M from "./meetings.js";
import { APPROVAL_RULES, rulesVerified } from "./voting.js";

const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

async function deny(env, member, permission) {
  await env.DB.prepare("INSERT INTO audit_log (actor_email, action, detail_json, created_at) VALUES (?, 'authorization_denied', ?, ?)")
    .bind(member.email, JSON.stringify({ permission }), Date.now()).run();
  return reply({ error: "forbidden" }, 403);
}

const rulesView = (r) => r && ({
  id: r.id, directorCount: r.director_count, quorum: r.quorum, approvalRule: r.approval_rule, noticeDays: r.notice_days,
  writtenConsentPermitted: Boolean(r.written_consent_permitted), sourceDocument: r.source_document,
  statutoryBasis: r.statutory_basis, verifiedBy: r.verified_by, verifiedAt: r.verified_at,
});

async function listDirectors(env) {
  const { results = [] } = await env.DB.prepare(`SELECT d.email, d.seat_title, d.seated_at, d.ended_at, m.role, m.status
    FROM board_directors d JOIN members m ON m.email = d.email ORDER BY d.ended_at IS NOT NULL, d.email`).all();
  const rules = await P.currentRules(env.DB);
  return reply({ directors: results.map((d) => ({ email: d.email, seatTitle: d.seat_title, seatedAt: d.seated_at, endedAt: d.ended_at, role: d.role, memberStatus: d.status })),
    seatLimit: rulesVerified(rules) ? rules.director_count : null });
}

async function seatDirector(env, member, input) {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const seat = cleanText(input.seatTitle, 1, 100);
  if (!emailPattern.test(email) || email.length > 254 || !seat) return reply({ error: "invalid_request" }, 400);
  const target = await env.DB.prepare("SELECT status FROM members WHERE email = ?").bind(email).first();
  if (target?.status !== "active") return reply({ error: "member_not_active" }, 409);
  const rules = await P.currentRules(env.DB);
  if (!rulesVerified(rules)) return reply({ error: "governance_rules_unverified" }, 409);
  const now = Date.now();
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO board_directors (email, seat_title, seated_at, seated_by)
      SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM board_directors WHERE ended_at IS NULL) < ?
      ON CONFLICT(email) DO UPDATE SET seat_title = excluded.seat_title, seated_at = excluded.seated_at, seated_by = excluded.seated_by, ended_at = NULL, ended_by = NULL
      WHERE board_directors.ended_at IS NOT NULL`).bind(email, seat, now, member.email, rules.director_count),
    auditStatement(env.DB, member.email, "director_seated", { email, seat }, now, true),
  ]);
  return changed(results[0]) ? reply({ ok: true }, 201) : reply({ error: "seat_unavailable" }, 409);
}

async function endDirector(env, member, input) {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!email) return reply({ error: "invalid_request" }, 400);
  const now = Date.now();
  const results = await env.DB.batch([
    env.DB.prepare("UPDATE board_directors SET ended_at = ?, ended_by = ? WHERE email = ? AND ended_at IS NULL").bind(now, member.email, email),
    auditStatement(env.DB, member.email, "director_seat_ended", { email }, now, true),
  ]);
  return changed(results[0]) ? reply({ ok: true }) : reply({ error: "not_a_director" }, 409);
}

async function readRules(env) {
  const rules = await P.currentRules(env.DB);
  const { results = [] } = await env.DB.prepare("SELECT * FROM governance_rules ORDER BY id DESC LIMIT 20").all();
  return reply({ rules: rulesView(rules) ?? null, verified: rulesVerified(rules), history: results.map(rulesView), approvalRules: APPROVAL_RULES });
}

async function verifyRules(env, member, input) {
  const intIn = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
  const source = cleanText(input.sourceDocument, 1, 300);
  const basis = cleanText(input.statutoryBasis, 1, 300);
  if (input.attestation !== true) return reply({ error: "attestation_required" }, 400);
  if (!source || !basis || !intIn(input.directorCount, 1, 99) || !intIn(input.quorum, 1, input.directorCount ?? 0)
    || !APPROVAL_RULES.includes(input.approvalRule) || !intIn(input.noticeDays, 0, 365) || typeof input.writtenConsentPermitted !== "boolean") {
    return reply({ error: "invalid_request" }, 400);
  }
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO governance_rules (director_count, quorum, approval_rule, notice_days, written_consent_permitted, source_document, statutory_basis, verified_by, verified_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(input.directorCount, input.quorum, input.approvalRule, input.noticeDays, input.writtenConsentPermitted ? 1 : 0, source, basis, member.email, now),
    auditStatement(env.DB, member.email, "governance_rules_verified", { quorum: input.quorum, directorCount: input.directorCount, approvalRule: input.approvalRule }, now, true),
  ]);
  return reply({ ok: true }, 201);
}

/** Integration status is reported by the server so the UI can never claim more than is deployed. */
function integrations(env) {
  const registry = Boolean(env.REGISTRY_API_URL && env.REGISTRY_API_TOKEN);
  return [
    { id: "registry", name: "Recovery Grant Registry (read-only summary)", operational: registry, note: registry ? "Configured; availability is checked per request." : "Not configured: REGISTRY_API_URL and REGISTRY_API_TOKEN are unset." },
    { id: "applications", name: "Applications inbox", operational: false, note: "Not operational in this build; no applicant data is stored or shown." },
    { id: "finance", name: "Finance and payments", operational: false, note: "Not operational: no accounting or bank integration exists." },
    { id: "communications", name: "Communications and notices", operational: false, note: "Not operational: this system sends no email or notices. Meeting notice is recorded by attestation only." },
    { id: "documents", name: "Document storage", operational: false, note: "Not operational: no file storage. Only resolutions and minutes stored in the database are available." },
  ];
}

async function dashboard(env, member) {
  const db = env.DB;
  const { results: counts = [] } = await db.prepare("SELECT status, COUNT(*) AS n FROM proposals WHERE status != 'draft' OR author_email = ? GROUP BY status").bind(member.email).all();
  const { results: toVote = [] } = await db.prepare(`SELECT p.id, p.title FROM proposals p
    JOIN meeting_attendance a ON a.meeting_id = p.meeting_id AND a.director_email = ?
    JOIN board_directors d ON d.email = a.director_email AND d.ended_at IS NULL
    WHERE p.status = 'voting' AND NOT EXISTS (SELECT 1 FROM votes v WHERE v.proposal_id = p.id AND v.director_email = a.director_email)
    AND NOT EXISTS (SELECT 1 FROM proposal_recusals r WHERE r.proposal_id = p.id AND r.director_email = a.director_email)`).bind(member.email).all();
  const { results: meetings = [] } = await db.prepare("SELECT id, title, meeting_type, scheduled_at, status FROM meetings WHERE status != 'adjourned' ORDER BY scheduled_at LIMIT 5").all();
  const rules = await P.currentRules(db);
  const seated = await db.prepare("SELECT COUNT(*) AS n FROM board_directors WHERE ended_at IS NULL").first();
  const awaiting = counts.find((c) => c.status === "submitted")?.n ?? 0;
  const out = {
    proposalCounts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
    awaitingReview: can(member, "proposals:review") ? awaiting : null,
    votesNeeded: toVote,
    upcomingMeetings: meetings.map((m) => ({ id: m.id, title: m.title, type: m.meeting_type, scheduledAt: m.scheduled_at, status: m.status })),
    governance: { rulesVerified: rulesVerified(rules), seatedDirectors: seated?.n ?? 0, directorCount: rules?.director_count ?? null },
    integrations: integrations(env),
  };
  if (member.role === "President") {
    out.security = {
      accessConfigured: Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD),
      environment: typeof env.APP_ENV === "string" && env.APP_ENV ? env.APP_ENV : "unset",
      presidentEmailConfigured: Boolean(env.PRESIDENT_EMAIL),
      mfa: "Enforced by the Cloudflare Access policy; the application cannot verify the policy itself. Confirm it in the Cloudflare dashboard.",
    };
  }
  return reply(out);
}

const ROUTES = [
  ["GET", /^dashboard$/, null, (env, m) => dashboard(env, m)],
  ["GET", /^rules$/, "governance:read", (env) => readRules(env)],
  ["POST", /^rules$/, "governance:verify", (env, m, i) => verifyRules(env, m, i)],
  ["GET", /^directors$/, "governance:read", (env) => listDirectors(env)],
  ["POST", /^directors\/seat$/, "directors:manage", (env, m, i) => seatDirector(env, m, i)],
  ["POST", /^directors\/end$/, "directors:manage", (env, m, i) => endDirector(env, m, i)],
  ["GET", /^resolutions$/, "proposals:read", (env) => P.listResolutions(env)],
  ["GET", /^proposals$/, "proposals:read", (env, m, i, url) => P.listProposals(env, m, url)],
  ["POST", /^proposals$/, "proposals:write", (env, m, i) => P.createProposal(env, m, i)],
  ["GET", /^proposals\/(\d+)$/, "proposals:read", (env, m, i, url, id) => P.proposalDetail(env, m, id, can)],
  ["POST", /^proposals\/(\d+)\/edit$/, "proposals:write", (env, m, i, url, id) => P.editProposal(env, m, id, i)],
  ["POST", /^proposals\/(\d+)\/submit$/, "proposals:write", (env, m, i, url, id) => P.submitProposal(env, m, id)],
  ["POST", /^proposals\/(\d+)\/review$/, "proposals:review", (env, m, i, url, id) => P.reviewProposal(env, m, id, i)],
  ["POST", /^proposals\/(\d+)\/archive$/, "proposals:read", (env, m, i, url, id) => P.archiveProposal(env, m, id, i, can)],
  ["POST", /^proposals\/(\d+)\/assign-meeting$/, "meetings:manage", (env, m, i, url, id) => P.assignMeeting(env, m, id, i)],
  ["POST", /^proposals\/(\d+)\/recuse$/, "votes:cast", (env, m, i, url, id) => P.recuse(env, m, id, i, can)],
  ["POST", /^proposals\/(\d+)\/open-voting$/, "meetings:manage", (env, m, i, url, id) => P.openVoting(env, m, id)],
  ["POST", /^proposals\/(\d+)\/vote$/, "votes:cast", (env, m, i, url, id) => P.castVote(env, m, id, i)],
  ["POST", /^proposals\/(\d+)\/close-voting$/, "meetings:manage", (env, m, i, url, id) => P.closeVoting(env, m, id)],
  ["POST", /^proposals\/(\d+)\/finalize$/, "resolutions:finalize", (env, m, i, url, id) => P.finalizeProposal(env, m, id, i)],
  ["GET", /^meetings$/, "proposals:read", (env) => M.listMeetings(env)],
  ["POST", /^meetings$/, "meetings:manage", (env, m, i) => M.createMeeting(env, m, i)],
  ["GET", /^meetings\/(\d+)$/, "proposals:read", (env, m, i, url, id) => M.meetingDetail(env, id)],
  ["POST", /^meetings\/(\d+)\/notice$/, "meetings:manage", (env, m, i, url, id) => M.recordNotice(env, m, id, i)],
  ["POST", /^meetings\/(\d+)\/agenda$/, "meetings:manage", (env, m, i, url, id) => M.addAgendaItem(env, m, id, i)],
  ["POST", /^meetings\/(\d+)\/attendance$/, "meetings:manage", (env, m, i, url, id) => M.recordAttendance(env, m, id, i)],
  ["POST", /^meetings\/(\d+)\/start$/, "meetings:manage", (env, m, i, url, id) => M.startMeeting(env, m, id)],
  ["POST", /^meetings\/(\d+)\/adjourn$/, "meetings:manage", (env, m, i, url, id) => M.adjournMeeting(env, m, id)],
  ["POST", /^meetings\/(\d+)\/minutes$/, "minutes:draft", (env, m, i, url, id) => M.draftMinutes(env, m, id, i)],
  ["POST", /^meetings\/(\d+)\/minutes\/approve$/, "minutes:approve", (env, m, i, url, id) => M.approveMinutes(env, m, id, i)],
];

/** Caller must already hold an authenticated, active session. Authorization is decided here, server-side. */
export const GOVERNANCE_ROUTES = ROUTES.map(([method, pattern, permission]) => ({ method, pattern, permission }));

export async function governanceApi(request, env, member) {
  const url = new URL(request.url);
  const path = url.pathname.slice("/api/governance/".length).replace(/\/$/, "");
  for (const [method, pattern, permission, handler] of ROUTES) {
    const match = pattern.exec(path);
    if (!match) continue;
    if (request.method !== method) continue;
    if (permission && !can(member, permission)) return deny(env, member, permission);
    let input = {};
    if (method === "POST") {
      if (!sameOrigin(request)) return reply({ error: "forbidden" }, 403);
      try { input = await readJson(request); } catch { return reply({ error: "invalid_request" }, 400); }
    }
    const id = match[1] ? Number(match[1]) : undefined;
    if (id !== undefined && !Number.isSafeInteger(id)) return reply({ error: "not_found" }, 404);
    return handler(env, member, input, url, id);
  }
  return reply({ error: "not_found" }, 404);
}
