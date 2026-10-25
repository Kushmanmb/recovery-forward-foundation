import { auditStatement, changed, cleanText, insertedId, reply } from "./http.js";
import { currentRules, isSeatedDirector, presentDirectors } from "./proposals.js";
import { noticeSatisfied, quorumStatus, rulesVerified } from "./voting.js";

const TYPES = ["regular", "special", "annual"];
const MIN_TIME = Date.UTC(2020, 0, 1);
const MAX_TIME = Date.UTC(2100, 0, 1);

const loadMeeting = (db, id) => db.prepare("SELECT * FROM meetings WHERE id = ?").bind(id).first();

function view(m) {
  return { id: m.id, title: m.title, type: m.meeting_type, scheduledAt: m.scheduled_at, location: m.location, status: m.status,
    noticeSentAt: m.notice_sent_at, startedAt: m.started_at, adjournedAt: m.adjourned_at };
}

export async function listMeetings(env) {
  const { results = [] } = await env.DB.prepare("SELECT * FROM meetings ORDER BY scheduled_at DESC LIMIT 200").all();
  return reply({ meetings: results.map(view) });
}

export async function meetingDetail(env, id) {
  const db = env.DB;
  const m = await loadMeeting(db, id);
  if (!m) return reply({ error: "not_found" }, 404);
  const rules = await currentRules(db);
  const verified = rulesVerified(rules);
  const { results: items = [] } = await db.prepare("SELECT id, position, title, detail FROM agenda_items WHERE meeting_id = ? ORDER BY position, id").bind(id).all();
  const { results: motions = [] } = await db.prepare("SELECT id, title, status, category FROM proposals WHERE meeting_id = ? AND status != 'archived' ORDER BY id").bind(id).all();
  const { results: attendance = [] } = await db.prepare("SELECT director_email, checked_in_at, recorded_by FROM meeting_attendance WHERE meeting_id = ? ORDER BY checked_in_at").bind(id).all();
  const { results: minutes = [] } = await db.prepare("SELECT version, content, drafted_by, drafted_at, approved_by, approved_at FROM meeting_minutes WHERE meeting_id = ? ORDER BY version DESC").bind(id).all();
  const present = await presentDirectors(db, id);
  return reply({
    meeting: view(m), agenda: items, motions,
    attendance: attendance.map((a) => ({ directorEmail: a.director_email, checkedInAt: a.checked_in_at, recordedBy: a.recorded_by })),
    quorum: quorumStatus(rules, present), rulesVerified: verified,
    noticeCompliant: verified ? noticeSatisfied(rules, m.notice_sent_at, m.scheduled_at) : null,
    noticeDays: verified ? rules.notice_days : null,
    minutes: minutes.map((x) => ({ version: x.version, content: x.content, draftedBy: x.drafted_by, draftedAt: x.drafted_at, approvedBy: x.approved_by, approvedAt: x.approved_at })),
  });
}

export async function createMeeting(env, member, input) {
  const title = cleanText(input.title, 1, 200);
  const location = input.location === undefined ? "" : cleanText(input.location, 0, 300);
  if (!title || location === null || !TYPES.includes(input.type) || !Number.isInteger(input.scheduledAt)
    || input.scheduledAt < MIN_TIME || input.scheduledAt > MAX_TIME) return reply({ error: "invalid_request" }, 400);
  const now = Date.now();
  const results = await env.DB.batch([
    env.DB.prepare("INSERT INTO meetings (title, meeting_type, scheduled_at, location, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(title, input.type, input.scheduledAt, location, member.email, now),
    env.DB.prepare("INSERT INTO audit_log (actor_email, action, detail_json, created_at) VALUES (?, 'meeting_created', json_object('meetingId', last_insert_rowid()), ?)").bind(member.email, now),
  ]);
  return reply({ id: insertedId(results[0]) }, 201);
}

export async function recordNotice(env, member, id, input) {
  const m = await loadMeeting(env.DB, id);
  if (!m) return reply({ error: "not_found" }, 404);
  if (input.attest !== true) return reply({ error: "attestation_required" }, 400);
  if (m.status !== "scheduled" || m.notice_sent_at) return reply({ error: "invalid_state" }, 409);
  const now = Date.now();
  const results = await env.DB.batch([
    env.DB.prepare("UPDATE meetings SET notice_sent_at = ?, notice_recorded_by = ? WHERE id = ? AND status = 'scheduled' AND notice_sent_at IS NULL").bind(now, member.email, id),
    auditStatement(env.DB, member.email, "meeting_notice_recorded", { meetingId: id }, now, true),
  ]);
  return changed(results[0]) ? reply({ ok: true, noticeSentAt: now }) : reply({ error: "invalid_state" }, 409);
}

export async function addAgendaItem(env, member, id, input) {
  const m = await loadMeeting(env.DB, id);
  if (!m) return reply({ error: "not_found" }, 404);
  const title = cleanText(input.title, 1, 200);
  const detail = input.detail === undefined ? "" : cleanText(input.detail, 0, 2000);
  if (!title || detail === null) return reply({ error: "invalid_request" }, 400);
  if (m.status !== "scheduled") return reply({ error: "invalid_state" }, 409);
  const now = Date.now();
  const results = await env.DB.batch([
    env.DB.prepare("INSERT INTO agenda_items (meeting_id, position, title, detail, created_by, created_at) SELECT ?, COALESCE(MAX(position), 0) + 1, ?, ?, ?, ? FROM agenda_items WHERE meeting_id = ? AND EXISTS (SELECT 1 FROM meetings WHERE id = ? AND status = 'scheduled')")
      .bind(id, title, detail, member.email, now, id, id),
    auditStatement(env.DB, member.email, "agenda_item_added", { meetingId: id }, now, true),
  ]);
  return changed(results[0]) ? reply({ ok: true }, 201) : reply({ error: "invalid_state" }, 409);
}

export async function recordAttendance(env, member, id, input) {
  const m = await loadMeeting(env.DB, id);
  if (!m) return reply({ error: "not_found" }, 404);
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!email) return reply({ error: "invalid_request" }, 400);
  if (m.status === "adjourned") return reply({ error: "invalid_state" }, 409);
  if (!await isSeatedDirector(env.DB, email)) return reply({ error: "not_a_director" }, 409);
  const now = Date.now();
  const results = await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO meeting_attendance (meeting_id, director_email, checked_in_at, recorded_by) VALUES (?, ?, ?, ?)").bind(id, email, now, member.email),
    auditStatement(env.DB, member.email, "attendance_recorded", { meetingId: id, director: email }, now, true),
  ]);
  return changed(results[0]) ? reply({ ok: true }, 201) : reply({ ok: true, alreadyRecorded: true });
}

export async function startMeeting(env, member, id) {
  const m = await loadMeeting(env.DB, id);
  if (!m) return reply({ error: "not_found" }, 404);
  if (m.status !== "scheduled") return reply({ error: "invalid_state" }, 409);
  const rules = await currentRules(env.DB);
  if (!rulesVerified(rules)) return reply({ error: "governance_rules_unverified" }, 409);
  if (!noticeSatisfied(rules, m.notice_sent_at, m.scheduled_at)) return reply({ error: "notice_insufficient" }, 409);
  if (!quorumStatus(rules, await presentDirectors(env.DB, id)).met) return reply({ error: "no_quorum" }, 409);
  const now = Date.now();
  const results = await env.DB.batch([
    env.DB.prepare("UPDATE meetings SET status = 'in_session', started_at = ? WHERE id = ? AND status = 'scheduled'").bind(now, id),
    auditStatement(env.DB, member.email, "meeting_started", { meetingId: id, rulesId: rules.id }, now, true),
  ]);
  return changed(results[0]) ? reply({ ok: true }) : reply({ error: "invalid_state" }, 409);
}

export async function adjournMeeting(env, member, id) {
  const m = await loadMeeting(env.DB, id);
  if (!m) return reply({ error: "not_found" }, 404);
  if (m.status !== "in_session") return reply({ error: "invalid_state" }, 409);
  const now = Date.now();
  const results = await env.DB.batch([
    env.DB.prepare("UPDATE meetings SET status = 'adjourned', adjourned_at = ? WHERE id = ? AND status = 'in_session' AND NOT EXISTS (SELECT 1 FROM proposals WHERE meeting_id = ? AND status = 'voting')").bind(now, id, id),
    auditStatement(env.DB, member.email, "meeting_adjourned", { meetingId: id }, now, true),
  ]);
  return changed(results[0]) ? reply({ ok: true }) : reply({ error: "voting_still_open" }, 409);
}

export async function draftMinutes(env, member, id, input) {
  const m = await loadMeeting(env.DB, id);
  if (!m) return reply({ error: "not_found" }, 404);
  const content = cleanText(input.content, 1, 50000);
  if (!content) return reply({ error: "invalid_request" }, 400);
  if (m.status === "scheduled") return reply({ error: "invalid_state" }, 409);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO meeting_minutes (meeting_id, version, content, drafted_by, drafted_at) SELECT ?, COALESCE(MAX(version), 0) + 1, ?, ?, ? FROM meeting_minutes WHERE meeting_id = ?")
      .bind(id, content, member.email, now, id),
    auditStatement(env.DB, member.email, "minutes_drafted", { meetingId: id }, now, true),
  ]);
  return reply({ ok: true }, 201);
}

export async function approveMinutes(env, member, id, input) {
  const m = await loadMeeting(env.DB, id);
  if (!m) return reply({ error: "not_found" }, 404);
  if (!Number.isInteger(input.version)) return reply({ error: "invalid_request" }, 400);
  if (m.status !== "adjourned") return reply({ error: "invalid_state" }, 409);
  const now = Date.now();
  const results = await env.DB.batch([
    env.DB.prepare("UPDATE meeting_minutes SET approved_by = ?, approved_at = ? WHERE meeting_id = ? AND version = ? AND approved_at IS NULL AND drafted_by != ?")
      .bind(member.email, now, id, input.version, member.email),
    auditStatement(env.DB, member.email, "minutes_approved", { meetingId: id, version: input.version }, now, true),
  ]);
  return changed(results[0]) ? reply({ ok: true }) : reply({ error: "approval_not_permitted" }, 409);
}
