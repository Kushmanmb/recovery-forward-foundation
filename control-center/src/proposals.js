import { auditStatement, changed, cleanText, insertedId, reply, sha256Hex } from "./http.js";
import { countVotes, noticeSatisfied, quorumStatus, rulesVerified, tally } from "./voting.js";

export const CATEGORIES = ["policy", "budget", "grant", "personnel", "bylaws", "other"];
const ARCHIVABLE = ["draft", "submitted", "ready", "failed", "finalized"];

export async function currentRules(db) {
  return await db.prepare("SELECT * FROM governance_rules ORDER BY id DESC LIMIT 1").first();
}

export async function rulesById(db, id) {
  return await db.prepare("SELECT * FROM governance_rules WHERE id = ?").bind(id).first();
}

export async function presentDirectors(db, meetingId) {
  if (!meetingId) return 0;
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM meeting_attendance a JOIN board_directors d ON d.email = a.director_email
    JOIN members m ON m.email = d.email WHERE a.meeting_id = ? AND d.ended_at IS NULL AND m.status = 'active'`).bind(meetingId).first();
  return row?.n ?? 0;
}

export async function isSeatedDirector(db, email) {
  return Boolean(await db.prepare(`SELECT 1 AS ok FROM board_directors d JOIN members m ON m.email = d.email
    WHERE d.email = ? AND d.ended_at IS NULL AND m.status = 'active'`).bind(email).first());
}

function publicProposal(p) {
  return {
    id: p.id, title: p.title, body: p.body, category: p.category, status: p.status, priorStatus: p.prior_status,
    version: p.version, authorEmail: p.author_email, meetingId: p.meeting_id, createdAt: p.created_at, updatedAt: p.updated_at,
    submittedAt: p.submitted_at, reviewedBy: p.reviewed_by, reviewedAt: p.reviewed_at, reviewNote: p.review_note,
    votingOpenedAt: p.voting_opened_at, votingClosedAt: p.voting_closed_at, archivedAt: p.archived_at, archiveReason: p.archive_reason,
  };
}

async function load(db, id) {
  return await db.prepare("SELECT * FROM proposals WHERE id = ?").bind(id).first();
}

/** Drafts are private to their author. */
const visible = (p, member) => p && (p.status !== "draft" || p.author_email === member.email);

export async function listProposals(env, member, url) {
  const status = url.searchParams.get("status");
  const where = ["(status != 'draft' OR author_email = ?)"];
  const binds = [member.email];
  if (status === "archived") where.push("status = 'archived'");
  else if (status) { where.push("status = ?"); binds.push(status); }
  else where.push("status != 'archived'");
  const { results = [] } = await env.DB.prepare(`SELECT id, title, category, status, author_email, meeting_id, version, updated_at
    FROM proposals WHERE ${where.join(" AND ")} ORDER BY updated_at DESC LIMIT 200`).bind(...binds).all();
  return reply({ proposals: results.map((p) => ({ id: p.id, title: p.title, category: p.category, status: p.status,
    authorEmail: p.author_email, meetingId: p.meeting_id, version: p.version, updatedAt: p.updated_at })) });
}

export async function proposalDetail(env, member, id, can) {
  const p = await load(env.DB, id);
  if (!visible(p, member)) return reply({ error: "not_found" }, 404);
  const db = env.DB;
  const rules = p.rules_id ? await rulesById(db, p.rules_id) : await currentRules(db);
  const { results: revisions = [] } = await db.prepare("SELECT version, title, edited_by, edited_at FROM proposal_revisions WHERE proposal_id = ? ORDER BY version").bind(id).all();
  const { results: recusals = [] } = await db.prepare("SELECT director_email, reason, declared_by, declared_at FROM proposal_recusals WHERE proposal_id = ? ORDER BY declared_at").bind(id).all();
  const { results: votes = [] } = await db.prepare("SELECT director_email, choice, cast_at FROM votes WHERE proposal_id = ?").bind(id).all();
  const meeting = p.meeting_id ? await db.prepare("SELECT id, title, status, scheduled_at FROM meetings WHERE id = ?").bind(p.meeting_id).first() : null;
  const present = await presentDirectors(db, p.meeting_id);
  const seated = await isSeatedDirector(db, member.email);
  const mine = votes.find((v) => v.director_email === member.email);
  const recused = recusals.some((r) => r.director_email === member.email);
  const attending = p.meeting_id ? Boolean(await db.prepare("SELECT 1 AS ok FROM meeting_attendance WHERE meeting_id = ? AND director_email = ?").bind(p.meeting_id, member.email).first()) : false;
  const eligible = p.status === "voting" && seated && attending && !recused && !mine;
  const closed = ["passed", "failed", "finalized", "archived"].includes(p.status) && p.result_json;
  const resolution = await db.prepare("SELECT number, content_hash, finalized_by, finalized_at FROM resolutions WHERE proposal_id = ?").bind(id).first();
  const out = {
    proposal: publicProposal(p), revisions, recusals: recusals.map((r) => ({ directorEmail: r.director_email, reason: r.reason, declaredBy: r.declared_by, declaredAt: r.declared_at })),
    meeting, quorum: quorumStatus(rules, present), rulesVerified: rulesVerified(rules),
    voting: {
      eligibleToVote: eligible, myVote: mine?.choice ?? null, recused, votesCast: votes.length,
      presentNotRecused: Math.max(0, present - recusals.length),
      ...(closed ? { result: JSON.parse(p.result_json), rollCall: votes.map((v) => ({ directorEmail: v.director_email, choice: v.choice })) } : {}),
    },
    resolution: resolution ? { number: resolution.number, contentHash: resolution.content_hash, finalizedBy: resolution.finalized_by, finalizedAt: resolution.finalized_at } : null,
  };
  if (p.status === "passed" && can(member, "resolutions:finalize")) out.finalization = await evaluateFinalization(db, p);
  return reply(out);
}

function parseInput(input) {
  const title = cleanText(input.title, 1, 200);
  const body = cleanText(input.body, 1, 20000);
  if (!title || !body || !CATEGORIES.includes(input.category)) return null;
  return { title, body, category: input.category };
}

export async function createProposal(env, member, input) {
  const data = parseInput(input);
  if (!data) return reply({ error: "invalid_request" }, 400);
  const now = Date.now();
  const db = env.DB;
  const results = await db.batch([
    db.prepare("INSERT INTO proposals (title, body, category, author_email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(data.title, data.body, data.category, member.email, now, now),
    db.prepare("INSERT INTO audit_log (actor_email, action, detail_json, created_at) VALUES (?, 'proposal_created', json_object('proposalId', last_insert_rowid()), ?)").bind(member.email, now),
    db.prepare("INSERT INTO proposal_revisions (proposal_id, version, title, body, edited_by, edited_at) SELECT MAX(id), 1, ?, ?, ?, ? FROM proposals WHERE author_email = ?")
      .bind(data.title, data.body, member.email, now, member.email),
  ]);
  return reply({ id: insertedId(results[0]) }, 201);
}

export async function editProposal(env, member, id, input) {
  const p = await load(env.DB, id);
  if (!visible(p, member)) return reply({ error: "not_found" }, 404);
  if (p.author_email !== member.email) return reply({ error: "forbidden" }, 403);
  if (p.status !== "draft") return reply({ error: "not_editable" }, 409);
  const data = parseInput(input);
  if (!data || !Number.isInteger(input.version)) return reply({ error: "invalid_request" }, 400);
  if (input.version !== p.version) return reply({ error: "version_conflict" }, 409);
  const now = Date.now();
  const db = env.DB;
  const results = await db.batch([
    db.prepare("UPDATE proposals SET title = ?, body = ?, category = ?, version = version + 1, updated_at = ? WHERE id = ? AND author_email = ? AND status = 'draft' AND version = ?")
      .bind(data.title, data.body, data.category, now, id, member.email, p.version),
    db.prepare("INSERT INTO proposal_revisions (proposal_id, version, title, body, edited_by, edited_at) SELECT id, version, title, body, ?, ? FROM proposals WHERE id = ? AND changes() > 0")
      .bind(member.email, now, id),
    auditStatement(db, member.email, "proposal_edited", { proposalId: id, version: p.version + 1 }, now, true),
  ]);
  return changed(results[0]) ? reply({ ok: true, version: p.version + 1 }) : reply({ error: "version_conflict" }, 409);
}

async function transition(env, { id, from, to, set = "", binds = [], action, detail = {}, actor, extraWhere = "", extraBinds = [] }) {
  const now = Date.now();
  const db = env.DB;
  const results = await db.batch([
    db.prepare(`UPDATE proposals SET status = ?, version = version + 1, updated_at = ?${set} WHERE id = ? AND status = ?${extraWhere}`)
      .bind(to, now, ...binds, id, from, ...extraBinds),
    auditStatement(db, actor, action, { proposalId: id, ...detail }, now, true),
  ]);
  return changed(results[0]);
}

export async function submitProposal(env, member, id) {
  const p = await load(env.DB, id);
  if (!visible(p, member)) return reply({ error: "not_found" }, 404);
  if (p.author_email !== member.email) return reply({ error: "forbidden" }, 403);
  if (p.status !== "draft") return reply({ error: "invalid_state" }, 409);
  const now = Date.now();
  const ok = await transition(env, { id, from: "draft", to: "submitted", set: ", submitted_at = ?, review_note = NULL", binds: [now],
    action: "proposal_submitted", actor: member.email, extraWhere: " AND author_email = ?", extraBinds: [member.email] });
  return ok ? reply({ ok: true }) : reply({ error: "invalid_state" }, 409);
}

export async function reviewProposal(env, member, id, input) {
  const p = await load(env.DB, id);
  if (!visible(p, member)) return reply({ error: "not_found" }, 404);
  if (p.author_email === member.email) return reply({ error: "self_review_forbidden" }, 403);
  if (p.status !== "submitted") return reply({ error: "invalid_state" }, 409);
  const note = input.note === undefined ? "" : cleanText(input.note, 0, 1000);
  if (!["approve", "return"].includes(input.decision) || note === null || (input.decision === "return" && !note)) return reply({ error: "invalid_request" }, 400);
  const now = Date.now();
  const ok = await transition(env, { id, from: "submitted", to: input.decision === "approve" ? "ready" : "draft",
    set: ", reviewed_by = ?, reviewed_at = ?, review_note = ?", binds: [member.email, now, note || null],
    action: "proposal_reviewed", detail: { decision: input.decision }, actor: member.email, extraWhere: " AND author_email != ?", extraBinds: [member.email] });
  return ok ? reply({ ok: true }) : reply({ error: "invalid_state" }, 409);
}

export async function archiveProposal(env, member, id, input, can) {
  const p = await load(env.DB, id);
  if (!visible(p, member)) return reply({ error: "not_found" }, 404);
  const own = p.status === "draft" && p.author_email === member.email;
  if (!own && !can(member, "proposals:archive")) return reply({ error: "forbidden" }, 403);
  if (!ARCHIVABLE.includes(p.status)) return reply({ error: "invalid_state" }, 409);
  const reason = cleanText(input.reason, 1, 500);
  if (!reason) return reply({ error: "reason_required" }, 400);
  const now = Date.now();
  const ok = await transition(env, { id, from: p.status, to: "archived", set: ", prior_status = ?, archived_by = ?, archived_at = ?, archive_reason = ?",
    binds: [p.status, member.email, now, reason], action: "proposal_archived", detail: { from: p.status }, actor: member.email });
  return ok ? reply({ ok: true }) : reply({ error: "invalid_state" }, 409);
}

export async function assignMeeting(env, member, id, input) {
  const p = await load(env.DB, id);
  if (!visible(p, member)) return reply({ error: "not_found" }, 404);
  if (p.status !== "ready") return reply({ error: "invalid_state" }, 409);
  if (!Number.isInteger(input.meetingId)) return reply({ error: "invalid_request" }, 400);
  const now = Date.now();
  const db = env.DB;
  const results = await db.batch([
    db.prepare("UPDATE proposals SET meeting_id = ?, version = version + 1, updated_at = ? WHERE id = ? AND status = 'ready' AND EXISTS (SELECT 1 FROM meetings WHERE id = ? AND status = 'scheduled')")
      .bind(input.meetingId, now, id, input.meetingId),
    auditStatement(db, member.email, "proposal_assigned_to_meeting", { proposalId: id, meetingId: input.meetingId }, now, true),
  ]);
  return changed(results[0]) ? reply({ ok: true }) : reply({ error: "meeting_unavailable" }, 409);
}

export async function recuse(env, member, id, input, can) {
  const p = await load(env.DB, id);
  if (!visible(p, member)) return reply({ error: "not_found" }, 404);
  const target = typeof input.email === "string" && input.email ? input.email.trim().toLowerCase() : member.email;
  if (target !== member.email && !can(member, "meetings:manage")) return reply({ error: "forbidden" }, 403);
  if (!await isSeatedDirector(env.DB, target)) return reply({ error: "not_a_director" }, 409);
  const reason = cleanText(input.reason, 1, 500);
  if (!reason) return reply({ error: "reason_required" }, 400);
  if (!["ready", "voting"].includes(p.status)) return reply({ error: "invalid_state" }, 409);
  const already = await env.DB.prepare("SELECT 1 AS ok FROM votes WHERE proposal_id = ? AND director_email = ?").bind(id, target).first();
  if (already) return reply({ error: "already_voted" }, 409);
  const now = Date.now();
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO proposal_recusals (proposal_id, director_email, reason, declared_by, declared_at) VALUES (?, ?, ?, ?, ?)")
        .bind(id, target, reason, member.email, now),
      auditStatement(env.DB, member.email, "recusal_recorded", { proposalId: id, director: target }, now),
    ]);
  } catch {
    return reply({ error: "recusal_rejected" }, 409);
  }
  return reply({ ok: true }, 201);
}

export async function openVoting(env, member, id) {
  const p = await load(env.DB, id);
  if (!visible(p, member)) return reply({ error: "not_found" }, 404);
  if (p.status !== "ready" || !p.meeting_id) return reply({ error: "invalid_state" }, 409);
  const rules = await currentRules(env.DB);
  if (!rulesVerified(rules)) return reply({ error: "governance_rules_unverified" }, 409);
  const meeting = await env.DB.prepare("SELECT * FROM meetings WHERE id = ?").bind(p.meeting_id).first();
  if (meeting?.status !== "in_session") return reply({ error: "meeting_not_in_session" }, 409);
  if (!quorumStatus(rules, await presentDirectors(env.DB, p.meeting_id)).met) return reply({ error: "no_quorum" }, 409);
  const now = Date.now();
  const ok = await transition(env, { id, from: "ready", to: "voting", set: ", voting_opened_by = ?, voting_opened_at = ?, rules_id = ?",
    binds: [member.email, now, rules.id], action: "voting_opened", detail: { rulesId: rules.id }, actor: member.email });
  return ok ? reply({ ok: true }) : reply({ error: "invalid_state" }, 409);
}

export async function castVote(env, member, id, input) {
  const p = await load(env.DB, id);
  if (!visible(p, member)) return reply({ error: "not_found" }, 404);
  if (!["yes", "no", "abstain"].includes(input.choice)) return reply({ error: "invalid_request" }, 400);
  if (!await isSeatedDirector(env.DB, member.email)) {
    await env.DB.prepare("INSERT INTO audit_log (actor_email, action, detail_json, created_at) VALUES (?, 'vote_denied', ?, ?)")
      .bind(member.email, JSON.stringify({ proposalId: id, reason: "not_a_director" }), Date.now()).run();
    return reply({ error: "not_a_director" }, 403);
  }
  if (p.status !== "voting") return reply({ error: "voting_not_open" }, 409);
  if (await env.DB.prepare("SELECT 1 AS ok FROM proposal_recusals WHERE proposal_id = ? AND director_email = ?").bind(id, member.email).first()) return reply({ error: "recused" }, 409);
  if (!await env.DB.prepare("SELECT 1 AS ok FROM meeting_attendance WHERE meeting_id = ? AND director_email = ?").bind(p.meeting_id, member.email).first()) return reply({ error: "not_present" }, 409);
  if (await env.DB.prepare("SELECT 1 AS ok FROM votes WHERE proposal_id = ? AND director_email = ?").bind(id, member.email).first()) return reply({ error: "already_voted" }, 409);
  const now = Date.now();
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO votes (proposal_id, director_email, choice, cast_at) VALUES (?, ?, ?, ?)").bind(id, member.email, input.choice, now),
      auditStatement(env.DB, member.email, "vote_cast", { proposalId: id }, now),
    ]);
  } catch {
    return reply({ error: "vote_rejected" }, 409);
  }
  return reply({ ok: true }, 201);
}

export async function closeVoting(env, member, id) {
  const p = await load(env.DB, id);
  if (!visible(p, member)) return reply({ error: "not_found" }, 404);
  if (p.status !== "voting") return reply({ error: "invalid_state" }, 409);
  const rules = await rulesById(env.DB, p.rules_id);
  if (!rulesVerified(rules)) return reply({ error: "governance_rules_unverified" }, 409);
  const { results: votes = [] } = await env.DB.prepare("SELECT choice FROM votes WHERE proposal_id = ?").bind(id).all();
  const present = await presentDirectors(env.DB, p.meeting_id);
  const quorum = quorumStatus(rules, present);
  const result = { ...tally(rules, { ...countVotes(votes), present }), quorum, closedAt: Date.now() };
  const outcome = quorum.met && result.passed ? "passed" : "failed";
  if (!quorum.met) { result.passed = false; result.reason = "quorum_lost"; }
  const ok = await transition(env, { id, from: "voting", to: outcome, set: ", voting_closed_by = ?, voting_closed_at = ?, result_json = ?",
    binds: [member.email, result.closedAt, JSON.stringify(result)], action: "voting_closed", detail: { outcome }, actor: member.email });
  return ok ? reply({ ok: true, outcome, result }) : reply({ error: "invalid_state" }, 409);
}

/** Every check must pass before an official resolution is recorded. */
export async function evaluateFinalization(db, p) {
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail });
  // Only the rule set recorded when voting opened applies; later rule changes never affect this motion.
  const rules = p.rules_id ? await rulesById(db, p.rules_id) : null;
  add("rules_recorded", Boolean(p.rules_id && rules), "Rule set was recorded when voting opened");
  add("rules_verified", rulesVerified(rules), "Recorded bylaws and Indiana-law rules were transcribed and attested by the President");
  add("status_passed", p.status === "passed", "Motion carried by recorded vote");
  const meeting = p.meeting_id ? await db.prepare("SELECT * FROM meetings WHERE id = ?").bind(p.meeting_id).first() : null;
  add("meeting_held", Boolean(meeting && ["in_session", "adjourned"].includes(meeting.status)), "Motion was decided at a held meeting");
  if (rulesVerified(rules) && meeting) {
    add("notice_given", noticeSatisfied(rules, meeting.notice_sent_at, meeting.scheduled_at), `Notice recorded at least ${rules.notice_days} day(s) before the meeting`);
    let result = null;
    try { result = JSON.parse(p.result_json); } catch { /* treated as missing */ }
    add("quorum_at_close", Boolean(result?.quorum?.met && result.quorum.present >= rules.quorum), `Quorum of ${rules.quorum} director(s) present when voting closed`);
    if (result) {
      const { results: votes = [] } = await db.prepare("SELECT choice FROM votes WHERE proposal_id = ?").bind(p.id).all();
      const counts = countVotes(votes);
      add("tally_matches_votes", counts.yes === result.yes && counts.no === result.no && counts.abstain === result.abstain, "Stored result matches the recorded votes");
      const recomputed = tally(rules, { yes: counts.yes, no: counts.no, abstain: counts.abstain, present: result.present });
      add("threshold_met", recomputed.passed, `Approval rule ${rules.approval_rule} satisfied under the recorded rules`);
    } else add("threshold_met", false, "No recorded tally");
  }
  return { ok: checks.every((c) => c.ok), checks, rulesId: rules?.id ?? null };
}

export async function finalizeProposal(env, member, id, input) {
  const p = await load(env.DB, id);
  if (!visible(p, member)) return reply({ error: "not_found" }, 404);
  if (input.bylawsReviewed !== true) return reply({ error: "bylaws_review_required" }, 400);
  if (p.status !== "passed") return reply({ error: "invalid_state" }, 409);
  const evaluation = await evaluateFinalization(env.DB, p);
  if (!evaluation.ok) {
    await env.DB.prepare("INSERT INTO audit_log (actor_email, action, detail_json, created_at) VALUES (?, 'finalization_blocked', ?, ?)")
      .bind(member.email, JSON.stringify({ proposalId: id, failed: evaluation.checks.filter((c) => !c.ok).map((c) => c.id) }), Date.now()).run();
    return reply({ error: "governance_check_failed", checks: evaluation.checks }, 409);
  }
  const now = Date.now();
  const year = new Date(now).getUTCFullYear();
  const hash = await sha256Hex(JSON.stringify({ title: p.title, body: p.body, result: p.result_json, rulesId: evaluation.rulesId }));
  const db = env.DB;
  try {
    await db.batch([
      db.prepare(`INSERT INTO resolutions (number, proposal_id, meeting_id, title, body, tally_json, checks_json, rules_id, content_hash, finalized_by, finalized_at)
        SELECT printf('RFF-%d-%03d', ?, (SELECT COUNT(*) FROM resolutions WHERE number LIKE ?) + 1), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?`)
        .bind(year, `RFF-${year}-%`, id, p.meeting_id, p.title, p.body, p.result_json, JSON.stringify(evaluation.checks), evaluation.rulesId, hash, member.email, now),
      db.prepare("UPDATE proposals SET status = 'finalized', version = version + 1, updated_at = ? WHERE id = ? AND status = 'passed' AND EXISTS (SELECT 1 FROM resolutions WHERE proposal_id = ?)")
        .bind(now, id, id),
      auditStatement(db, member.email, "resolution_finalized", { proposalId: id, rulesId: evaluation.rulesId, contentHash: hash }, now, true),
    ]);
  } catch {
    return reply({ error: "invalid_state" }, 409);
  }
  const row = await db.prepare("SELECT number FROM resolutions WHERE proposal_id = ?").bind(id).first();
  return reply({ ok: true, number: row?.number, contentHash: hash }, 201);
}

export async function listResolutions(env) {
  const { results = [] } = await env.DB.prepare("SELECT number, proposal_id, title, finalized_by, finalized_at, content_hash FROM resolutions ORDER BY id DESC LIMIT 200").all();
  return reply({ resolutions: results.map((r) => ({ number: r.number, proposalId: r.proposal_id, title: r.title, finalizedBy: r.finalized_by, finalizedAt: r.finalized_at, contentHash: r.content_hash })) });
}
