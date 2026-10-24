import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { governanceApi } from "../src/governance-api.js";
import { ROLE_PERMISSIONS, can } from "../src/rbac.js";
import { tally, rulesVerified } from "../src/voting.js";

const ORIGIN = "https://admin.example.org";
const DAY = 86_400_000;

function createDb() {
  const database = new DatabaseSync(":memory:");
  for (const file of ["0001_initial.sql", "0003_board_access.sql", "0010_governance_core.sql"]) {
    database.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  return {
    database,
    async batch(statements) {
      database.exec("BEGIN");
      try { const result = statements.map((statement) => statement.run()); database.exec("COMMIT"); return result; }
      catch (error) { database.exec("ROLLBACK"); throw error; }
    },
    prepare(sql) {
      const statement = database.prepare(sql);
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        first() { return statement.get(...values) || null; },
        all() { return { results: statement.all(...values) }; },
        run() { return statement.run(...values); },
      };
    },
  };
}

const PEOPLE = {
  "president@example.org": "President", "vp@example.org": "VicePresident", "secretary@example.org": "Secretary",
  "treasurer@example.org": "Treasurer", "bm1@example.org": "BoardMember", "bm2@example.org": "BoardMember",
};
const DIRECTORS = ["president@example.org", "vp@example.org", "treasurer@example.org", "bm1@example.org", "bm2@example.org"];
const RULES = { directorCount: 5, quorum: 3, approvalRule: "majority_present", noticeDays: 3, writtenConsentPermitted: false,
  sourceDocument: "Test Bylaws (adopted fixture)", statutoryBasis: "Test statutory fixture", attestation: true };

function world({ verified = true, seat = true } = {}) {
  const env = { DB: createDb() };
  for (const [email, role] of Object.entries(PEOPLE)) {
    env.DB.database.prepare("INSERT INTO members (email, role, status, created_at) VALUES (?, ?, 'active', ?)").run(email, role, Date.now());
  }
  const as = (email) => ({ email, role: PEOPLE[email], status: "active" });
  const call = async (email, method, path, body, { origin = ORIGIN, type = "application/json" } = {}) => {
    const headers = {};
    if (method !== "GET") { headers.origin = origin; if (type) headers["content-type"] = type; }
    const response = await governanceApi(new Request(`${ORIGIN}/api/governance/${path}`, {
      method, headers, ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
    }), env, as(email));
    return { status: response.status, body: await response.json() };
  };
  const ready = (async () => {
    if (verified) assert.equal((await call("president@example.org", "POST", "rules", RULES)).status, 201);
    if (seat) for (const email of DIRECTORS) assert.equal((await call("president@example.org", "POST", "directors/seat", { email, seatTitle: "Director" })).status, 201);
  })();
  return { env, call, ready, sql: env.DB.database };
}

/** Creates a proposal that passed through submission and review, optionally placed on a meeting in session. */
async function readyProposal(w, { scheduledAt = Date.now() + 7 * DAY, start = true, attend = ["president@example.org", "vp@example.org", "treasurer@example.org"] } = {}) {
  const created = await w.call("bm1@example.org", "POST", "proposals", { title: "Adopt travel policy", body: "Resolved: adopt the policy.", category: "policy" });
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal((await w.call("bm1@example.org", "POST", `proposals/${id}/submit`, {})).status, 200);
  assert.equal((await w.call("secretary@example.org", "POST", `proposals/${id}/review`, { decision: "approve" })).status, 200);
  const meeting = await w.call("secretary@example.org", "POST", "meetings", { title: "Q1 meeting", type: "regular", scheduledAt, location: "Room 1" });
  assert.equal(meeting.status, 201);
  const meetingId = meeting.body.id;
  assert.equal((await w.call("secretary@example.org", "POST", `proposals/${id}/assign-meeting`, { meetingId })).status, 200);
  assert.equal((await w.call("secretary@example.org", "POST", `meetings/${meetingId}/notice`, { attest: true })).status, 200);
  for (const email of attend) assert.equal((await w.call("secretary@example.org", "POST", `meetings/${meetingId}/attendance`, { email })).status, 201);
  if (start) assert.equal((await w.call("secretary@example.org", "POST", `meetings/${meetingId}/start`, {})).status, 200);
  return { id, meetingId };
}

test("governance permissions: roles grant management only to the right officers", async () => {
  assert.equal(can({ role: "President", status: "active" }, "governance:verify"), true);
  for (const role of ["VicePresident", "Secretary", "Treasurer", "BoardMember"]) {
    assert.equal(ROLE_PERMISSIONS[role].includes("governance:verify"), false, role);
    assert.equal(ROLE_PERMISSIONS[role].includes("directors:manage"), false, role);
  }
  assert.equal(can({ role: "BoardMember", status: "suspended" }, "proposals:read"), false);
  assert.equal(can({ role: "BoardMember", status: "active", grants: ["directors:manage"] }, "directors:manage"), true);
});

test("server-side authorization rejects unauthorized governance actions and records denials", async () => {
  const w = world();
  await w.ready;
  assert.equal((await w.call("bm1@example.org", "POST", "rules", RULES)).status, 403);
  assert.equal((await w.call("secretary@example.org", "POST", "directors/seat", { email: "bm1@example.org", seatTitle: "x" })).status, 403);
  assert.equal((await w.call("bm1@example.org", "POST", "meetings", { title: "x", type: "regular", scheduledAt: Date.now() })).status, 403);
  assert.equal((await w.call("treasurer@example.org", "POST", "proposals/1/finalize", { bylawsReviewed: true })).status, 403);
  assert.equal((await w.call("vp@example.org", "POST", "proposals/1/review", { decision: "approve" })).status, 403);
  assert.ok(w.sql.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'authorization_denied'").get().n >= 5);
  assert.equal((await w.call("bm1@example.org", "GET", "nope")).status, 404);
});

test("state-changing governance requests require same-origin JSON", async () => {
  const w = world();
  await w.ready;
  const proposal = { title: "T", body: "B", category: "policy" };
  assert.equal((await w.call("bm1@example.org", "POST", "proposals", proposal, { origin: "https://evil.example" })).status, 403);
  assert.equal((await w.call("bm1@example.org", "POST", "proposals", proposal, { type: "text/plain" })).status, 400);
  assert.equal((await w.call("bm1@example.org", "POST", "proposals", "[1]")).status, 400);
  assert.equal((await w.call("bm1@example.org", "POST", "proposals", { ...proposal, category: "<script>" })).status, 400);
  assert.equal((await w.call("bm1@example.org", "POST", "proposals", { ...proposal, title: "x".repeat(201) })).status, 400);
  assert.equal((await w.call("bm1@example.org", "POST", "proposals", { ...proposal, body: "x".repeat(40_000) })).status, 400);
  assert.equal(w.sql.prepare("SELECT COUNT(*) AS n FROM proposals").get().n, 0);
});

test("proposal lifecycle: draft, edit, submit, review, privacy and archive", async () => {
  const w = world();
  await w.ready;
  const created = await w.call("bm1@example.org", "POST", "proposals", { title: "Budget", body: "Approve budget", category: "budget" });
  const id = created.body.id;
  assert.equal((await w.call("bm2@example.org", "GET", `proposals/${id}`)).status, 404, "drafts are private to the author");
  assert.equal((await w.call("bm2@example.org", "GET", "proposals")).body.proposals.length, 0);
  assert.equal((await w.call("bm2@example.org", "POST", `proposals/${id}/edit`, { title: "Hi", body: "jack", category: "policy", version: 1 })).status, 404);

  const edit = { title: "Budget v2", body: "Approve budget v2", category: "budget", version: 1 };
  assert.equal((await w.call("bm1@example.org", "POST", `proposals/${id}/edit`, edit)).status, 200);
  assert.equal((await w.call("bm1@example.org", "POST", `proposals/${id}/edit`, edit)).status, 409, "stale version");
  assert.equal((await w.call("bm1@example.org", "POST", `proposals/${id}/submit`, {})).status, 200);
  assert.equal((await w.call("bm1@example.org", "POST", `proposals/${id}/edit`, { ...edit, version: 3 })).status, 409, "submitted proposals are frozen");
  assert.equal((await w.call("bm1@example.org", "POST", `proposals/${id}/review`, { decision: "approve" })).status, 403);

  assert.equal((await w.call("secretary@example.org", "POST", `proposals/${id}/review`, { decision: "return" })).status, 400, "return needs a note");
  assert.equal((await w.call("secretary@example.org", "POST", `proposals/${id}/review`, { decision: "return", note: "Add figures" })).status, 200);
  const back = await w.call("bm1@example.org", "GET", `proposals/${id}`);
  assert.equal(back.body.proposal.status, "draft");
  assert.equal(back.body.proposal.reviewNote, "Add figures");
  assert.equal(back.body.revisions.length, 2);

  assert.equal((await w.call("bm1@example.org", "POST", `proposals/${id}/archive`, {})).status, 400);
  assert.equal((await w.call("bm1@example.org", "POST", `proposals/${id}/archive`, { reason: "Withdrawn" })).status, 200);
  const archived = await w.call("bm2@example.org", "GET", "proposals?status=archived");
  assert.equal(archived.body.proposals.length, 1);
  assert.equal((await w.call("bm1@example.org", "POST", `proposals/${id}/submit`, {})).status, 409);
  assert.throws(() => w.sql.prepare("UPDATE proposals SET title = 'x' WHERE id = ?").run(id), /read-only/);
  assert.throws(() => w.sql.prepare("DELETE FROM proposals WHERE id = ?").run(id), /retained/);
});

test("full governance flow: verified rules, quorum, votes, recusal, official resolution", async () => {
  const w = world();
  await w.ready;
  const { id, meetingId } = await readyProposal(w);

  const early = await w.call("bm1@example.org", "POST", `proposals/${id}/vote`, { choice: "yes" });
  assert.equal(early.status, 409);
  assert.equal(early.body.error, "voting_not_open");
  assert.equal((await w.call("bm1@example.org", "POST", `proposals/${id}/open-voting`, {})).status, 403);
  assert.equal((await w.call("secretary@example.org", "POST", `proposals/${id}/open-voting`, {})).status, 200);

  // Secretary holds an admin-style role but no director seat: no vote.
  const secretaryVote = await w.call("secretary@example.org", "POST", `proposals/${id}/vote`, { choice: "yes" });
  assert.equal(secretaryVote.status, 403);
  assert.equal(secretaryVote.body.error, "not_a_director");
  // Seated director who is not present cannot vote.
  assert.equal((await w.call("bm2@example.org", "POST", `proposals/${id}/vote`, { choice: "yes" })).body.error, "not_present");
  assert.equal((await w.call("vp@example.org", "POST", `proposals/${id}/vote`, { choice: "maybe" })).status, 400);

  assert.equal((await w.call("vp@example.org", "POST", `proposals/${id}/vote`, { choice: "yes" })).status, 201);
  const again = await w.call("vp@example.org", "POST", `proposals/${id}/vote`, { choice: "no" });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, "already_voted");

  // Conflict-of-interest recusal blocks the vote; a recusal after voting is refused.
  assert.equal((await w.call("treasurer@example.org", "POST", `proposals/${id}/recuse`, { reason: "Family interest" })).status, 201);
  assert.equal((await w.call("treasurer@example.org", "POST", `proposals/${id}/vote`, { choice: "yes" })).body.error, "recused");
  assert.equal((await w.call("vp@example.org", "POST", `proposals/${id}/recuse`, { reason: "late" })).body.error, "already_voted");
  assert.equal((await w.call("bm1@example.org", "POST", `proposals/${id}/recuse`, { email: "president@example.org", reason: "x" })).status, 403);
  assert.equal((await w.call("president@example.org", "POST", `proposals/${id}/vote`, { choice: "yes" })).status, 201);

  const mid = await w.call("bm1@example.org", "GET", `proposals/${id}`);
  assert.equal(mid.body.voting.votesCast, 2);
  assert.equal(mid.body.voting.rollCall, undefined, "individual votes stay hidden while voting is open");
  assert.equal(mid.body.quorum.met, true);
  assert.equal((await w.call("secretary@example.org", "POST", `meetings/${meetingId}/adjourn`, {})).body.error, "voting_still_open");

  const closed = await w.call("secretary@example.org", "POST", `proposals/${id}/close-voting`, {});
  assert.equal(closed.body.outcome, "passed");
  assert.deepEqual([closed.body.result.yes, closed.body.result.present], [2, 3]);

  const check = await w.call("secretary@example.org", "GET", `proposals/${id}`);
  assert.equal(check.body.finalization.ok, true);
  assert.equal((await w.call("secretary@example.org", "POST", `proposals/${id}/finalize`, {})).status, 400);
  const final = await w.call("secretary@example.org", "POST", `proposals/${id}/finalize`, { bylawsReviewed: true });
  assert.equal(final.status, 201);
  assert.match(final.body.number, /^RFF-\d{4}-001$/);
  assert.equal((await w.call("secretary@example.org", "POST", `proposals/${id}/finalize`, { bylawsReviewed: true })).status, 409);

  const detail = await w.call("bm2@example.org", "GET", `proposals/${id}`);
  assert.equal(detail.body.proposal.status, "finalized");
  assert.equal(detail.body.voting.rollCall.length, 2);
  assert.equal((await w.call("bm2@example.org", "GET", "resolutions")).body.resolutions[0].number, final.body.number);

  assert.throws(() => w.sql.prepare("UPDATE resolutions SET body = 'altered'").run(), /immutable/);
  assert.throws(() => w.sql.prepare("DELETE FROM resolutions").run(), /immutable/);
  assert.throws(() => w.sql.prepare("UPDATE votes SET choice = 'no'").run(), /final/);
  assert.throws(() => w.sql.prepare("DELETE FROM votes").run(), /final/);

  const actions = w.sql.prepare("SELECT action, detail_json FROM audit_log").all();
  for (const action of ["proposal_created", "proposal_reviewed", "meeting_started", "voting_opened", "vote_cast", "recusal_recorded", "voting_closed", "resolution_finalized"]) {
    assert.ok(actions.some((a) => a.action === action), action);
  }
  assert.ok(!actions.filter((a) => a.action === "vote_cast").some((a) => /yes|no|abstain/.test(a.detail_json)), "audit never records vote choices");
});

test("official resolutions are blocked until bylaws rules are verified", async () => {
  const w = world({ verified: false, seat: false });
  await w.ready;
  assert.equal((await w.call("president@example.org", "POST", "directors/seat", { email: "bm1@example.org", seatTitle: "D" })).body.error, "governance_rules_unverified");
  assert.equal((await w.call("president@example.org", "POST", "rules", { ...RULES, attestation: false })).status, 400);
  assert.equal((await w.call("president@example.org", "POST", "rules", { ...RULES, quorum: 9 })).status, 400);
  assert.equal((await w.call("president@example.org", "POST", "rules", { ...RULES, approvalRule: "whatever" })).status, 400);
  assert.equal((await w.call("president@example.org", "GET", "rules")).body.verified, false);
  // Even a hand-built passed motion cannot be finalized without verified rules.
  const now = Date.now();
  w.sql.prepare("INSERT INTO meetings (title, meeting_type, scheduled_at, status, created_by, created_at) VALUES ('m','regular',?, 'in_session','x',?)").run(now, now);
  w.sql.prepare("INSERT INTO proposals (title, body, category, status, author_email, meeting_id, created_at, updated_at, result_json) VALUES ('t','b','policy','passed','bm1@example.org',1,?,?,?)")
    .run(now, now, JSON.stringify({ yes: 3, no: 0, abstain: 0, present: 3, quorum: { present: 3, met: true } }));
  const refused = await w.call("president@example.org", "POST", "proposals/1/finalize", { bylawsReviewed: true });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, "governance_check_failed");
  assert.equal(refused.body.checks.find((c) => c.id === "rules_verified").ok, false);
  assert.equal(w.sql.prepare("SELECT COUNT(*) AS n FROM resolutions").get().n, 0);
  assert.throws(() => w.sql.prepare("INSERT INTO resolutions (number, proposal_id, meeting_id, title, body, tally_json, checks_json, rules_id, content_hash, finalized_by, finalized_at) VALUES ('X',1,1,'t','b','{}','[]',1,'h','x',1)").run(), /FOREIGN KEY|passed/);
  const scheduled = await w.call("secretary@example.org", "POST", "meetings", { title: "Next", type: "special", scheduledAt: Date.now() + 9 * DAY });
  const open = await w.call("secretary@example.org", "POST", `meetings/${scheduled.body.id}/start`, {});
  assert.equal(open.body.error, "governance_rules_unverified");
});

test("meeting cannot start without proper notice or quorum", async () => {
  const w = world();
  await w.ready;
  await assert.rejects(readyProposal(w, { scheduledAt: Date.now() + DAY }));
  assert.equal(w.sql.prepare("SELECT status FROM meetings").get().status, "scheduled");
  const row = w.sql.prepare("SELECT id FROM meetings").get();
  assert.equal((await w.call("secretary@example.org", "POST", `meetings/${row.id}/start`, {})).body.error, "notice_insufficient");

  const w2 = world();
  await w2.ready;
  await assert.rejects(readyProposal(w2, { attend: ["vp@example.org", "bm1@example.org"] }));
  const meeting = w2.sql.prepare("SELECT id FROM meetings").get();
  assert.equal((await w2.call("secretary@example.org", "POST", `meetings/${meeting.id}/start`, {})).body.error, "no_quorum");
  const detail = await w2.call("bm1@example.org", "GET", `meetings/${meeting.id}`);
  assert.deepEqual(detail.body.quorum, { present: 2, required: 3, met: false });
  assert.equal((await w2.call("secretary@example.org", "POST", `meetings/${meeting.id}/attendance`, { email: "secretary@example.org" })).body.error, "not_a_director");
});

test("database triggers enforce vote rules even if the Worker is bypassed", async () => {
  const w = world();
  await w.ready;
  const { id } = await readyProposal(w);
  const insert = (email) => w.sql.prepare("INSERT INTO votes (proposal_id, director_email, choice, cast_at) VALUES (?, ?, 'yes', 1)").run(id, email);
  assert.throws(() => insert("vp@example.org"), /not open for voting/);
  await w.call("secretary@example.org", "POST", `proposals/${id}/open-voting`, {});
  assert.throws(() => insert("bm2@example.org"), /not present/);
  assert.throws(() => insert("secretary@example.org"), /FOREIGN KEY|eligible/);
  insert("vp@example.org");
  assert.throws(() => insert("vp@example.org"), /UNIQUE|PRIMARY/);
  w.sql.prepare("INSERT INTO proposal_recusals (proposal_id, director_email, reason, declared_by, declared_at) VALUES (?, 'treasurer@example.org', 'COI', 'x', 1)").run(id);
  assert.throws(() => insert("treasurer@example.org"), /recused/);
  assert.throws(() => w.sql.prepare("INSERT INTO proposal_recusals VALUES (?, 'vp@example.org', 'late', 'x', 1)").run(id), /recusal not allowed/);
  w.sql.prepare("UPDATE board_directors SET ended_at = 1 WHERE email = 'president@example.org'").run();
  assert.throws(() => insert("president@example.org"), /eligible/);
});

test("quorum lost before close fails the motion; changed rules block finalization", async () => {
  const w = world();
  await w.ready;
  const { id } = await readyProposal(w);
  await w.call("secretary@example.org", "POST", `proposals/${id}/open-voting`, {});
  for (const email of ["vp@example.org", "treasurer@example.org", "president@example.org"]) await w.call(email, "POST", `proposals/${id}/vote`, { choice: "yes" });
  w.sql.prepare("UPDATE board_directors SET ended_at = 1 WHERE email = 'vp@example.org'").run();
  const closed = await w.call("secretary@example.org", "POST", `proposals/${id}/close-voting`, {});
  assert.equal(closed.body.outcome, "failed");
  assert.equal(closed.body.result.reason, "quorum_lost");

  const w2 = world();
  await w2.ready;
  const p = await readyProposal(w2);
  await w2.call("secretary@example.org", "POST", `proposals/${p.id}/open-voting`, {});
  for (const email of ["vp@example.org", "treasurer@example.org", "president@example.org"]) await w2.call(email, "POST", `proposals/${p.id}/vote`, { choice: "yes" });
  assert.equal((await w2.call("secretary@example.org", "POST", `proposals/${p.id}/close-voting`, {})).body.outcome, "passed");
  await w2.call("president@example.org", "POST", "rules", { ...RULES, quorum: 5 });
  const blocked = await w2.call("secretary@example.org", "POST", `proposals/${p.id}/finalize`, { bylawsReviewed: true });
  assert.equal(blocked.body.error, "governance_check_failed");
  assert.equal(blocked.body.checks.find((c) => c.id === "quorum_at_close").ok, false);
  assert.ok(w2.sql.prepare("SELECT 1 FROM audit_log WHERE action = 'finalization_blocked'").get());
});

test("approval thresholds follow the verified rule", () => {
  const base = { director_count: 7, quorum: 4, notice_days: 3 };
  assert.equal(tally({ ...base, approval_rule: "majority_present" }, { yes: 2, no: 0, abstain: 2, present: 4 }).passed, false);
  assert.equal(tally({ ...base, approval_rule: "majority_present" }, { yes: 3, no: 1, abstain: 0, present: 4 }).passed, true);
  assert.equal(tally({ ...base, approval_rule: "majority_votes_cast" }, { yes: 2, no: 1, abstain: 5, present: 8 }).passed, true);
  assert.equal(tally({ ...base, approval_rule: "majority_votes_cast" }, { yes: 0, no: 0, abstain: 4, present: 4 }).passed, false);
  assert.equal(tally({ ...base, approval_rule: "majority_all_directors" }, { yes: 3, no: 0, abstain: 0, present: 4 }).passed, false);
  assert.equal(tally({ ...base, approval_rule: "majority_all_directors" }, { yes: 4, no: 0, abstain: 0, present: 4 }).passed, true);
  assert.equal(tally({ ...base, approval_rule: "two_thirds_present" }, { yes: 3, no: 0, abstain: 0, present: 5 }).passed, false);
  assert.equal(tally({ ...base, approval_rule: "two_thirds_present" }, { yes: 4, no: 0, abstain: 0, present: 6 }).passed, true);
  assert.equal(rulesVerified(null), false);
  assert.equal(rulesVerified({ ...base, approval_rule: "majority_present", source_document: "s", statutory_basis: "b", verified_by: "p", verified_at: 1 }), true);
  assert.equal(rulesVerified({ ...base, quorum: 9, approval_rule: "majority_present", source_document: "s", statutory_basis: "b", verified_by: "p", verified_at: 1 }), false);
});

test("director seats honor the verified board size and re-seating works", async () => {
  const w = world();
  await w.ready;
  assert.equal((await w.call("president@example.org", "POST", "directors/seat", { email: "secretary@example.org", seatTitle: "Sixth" })).body.error, "seat_unavailable");
  assert.equal((await w.call("president@example.org", "POST", "directors/seat", { email: "vp@example.org", seatTitle: "Dup" })).status, 409);
  assert.equal((await w.call("president@example.org", "POST", "directors/end", { email: "vp@example.org" })).status, 200);
  assert.equal((await w.call("president@example.org", "POST", "directors/seat", { email: "secretary@example.org", seatTitle: "Sixth" })).status, 201);
  assert.equal((await w.call("president@example.org", "POST", "directors/seat", { email: "nobody@example.org", seatTitle: "x" })).body.error, "member_not_active");
  const list = await w.call("bm1@example.org", "GET", "directors");
  assert.equal(list.body.directors.filter((d) => !d.endedAt).length, 5);
});

test("minutes are versioned, approved by someone other than the drafter, then immutable", async () => {
  const w = world();
  await w.ready;
  const { meetingId } = await readyProposal(w);
  assert.equal((await w.call("bm1@example.org", "POST", `meetings/${meetingId}/minutes`, { content: "x" })).status, 403);
  assert.equal((await w.call("president@example.org", "POST", `meetings/${meetingId}/minutes`, { content: "Draft 1" })).status, 201);
  assert.equal((await w.call("president@example.org", "POST", `meetings/${meetingId}/minutes/approve`, { version: 1 })).body.error, "invalid_state", "meeting must be adjourned");
  assert.equal((await w.call("secretary@example.org", "POST", `meetings/${meetingId}/adjourn`, {})).status, 200);
  assert.equal((await w.call("president@example.org", "POST", `meetings/${meetingId}/minutes/approve`, { version: 1 })).body.error, "approval_not_permitted", "drafter cannot approve own minutes");
  assert.equal((await w.call("president@example.org", "POST", `meetings/${meetingId}/minutes`, { content: "Draft 2" })).status, 201);
  assert.throws(() => w.sql.prepare("UPDATE meeting_minutes SET content = 'tampered' WHERE version = 2").run(), /immutable/);
  assert.throws(() => w.sql.prepare("DELETE FROM meeting_minutes").run(), /retained/);
});

test("dashboard reports real state and identifies integrations that are not operational", async () => {
  const w = world();
  await w.ready;
  await readyProposal(w);
  const president = await w.call("president@example.org", "GET", "dashboard");
  assert.equal(president.status, 200);
  assert.equal(president.body.governance.rulesVerified, true);
  assert.equal(president.body.governance.seatedDirectors, 5);
  assert.equal(president.body.proposalCounts.ready, 1);
  assert.equal(president.body.upcomingMeetings.length, 1);
  const byId = Object.fromEntries(president.body.integrations.map((i) => [i.id, i]));
  for (const id of ["applications", "finance", "communications", "documents", "registry"]) assert.equal(byId[id].operational, false, id);
  assert.ok(president.body.security);
  const member = await w.call("bm1@example.org", "GET", "dashboard");
  assert.equal(member.body.security, undefined, "security posture is President-only");
  assert.equal(member.body.awaitingReview, null);
});
