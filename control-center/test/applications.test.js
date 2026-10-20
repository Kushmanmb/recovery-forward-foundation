import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handleRequest } from "../src/worker.js";
import { handleIntake } from "../src/intake.js";
import { validateSubmission } from "../src/applications.js";

const ORIGIN = "https://admin.example.org";
const SITE = "https://recoveryforwardfoundation.org";
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
let counter = 0;

async function signedIdentity(email) {
  const domain = `inbox-${++counter}.cloudflareaccess.com`;
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  Object.assign(jwk, { kid: `k${counter}`, use: "sig", alg: "RS256" });
  const now = Math.floor(Date.now() / 1000);
  const signed = `${encode({ alg: "RS256", typ: "JWT", kid: jwk.kid })}.${encode({
    iss: `https://${domain}`, aud: ["aud"], sub: `sub-${counter}`, email, iat: now, exp: now + 300,
  })}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(signed));
  return { domain, jwk, token: `${signed}.${Buffer.from(signature).toString("base64url")}` };
}

function makeDb() {
  const database = new DatabaseSync(":memory:");
  for (const file of ["0001_initial.sql", "0002_applications.sql"]) {
    database.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  return {
    database,
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

const validBody = (rcgi = "RCGI-0123456789ab") => ({
  rcgi,
  recoveryStage: "3–6 months in recovery",
  recoverySupport: "Weekly peer group",
  needs: ["housing", "employment"],
  needDescription: "SYNTHETIC-NEED-TEXT",
  goals: "SYNTHETIC-GOALS-TEXT",
  confirmation: true,
});

function intake(db, body, { origin = SITE, method = "POST", raw, headers = {} } = {}) {
  return handleIntake(new Request("https://intake.example.org/applications", {
    method,
    headers: { origin, "content-type": "application/json", ...headers },
    ...(method === "POST" ? { body: raw ?? JSON.stringify(body) } : {}),
  }), { DB: db });
}

async function setup() {
  const db = makeDb();
  const now = Date.now();
  const people = {
    president: "president@example.org",
    reviewer: "reviewer@example.org",
    other: "other@example.org",
    unauthorized: "board@example.org",
  };
  db.database.prepare("INSERT INTO members (email, role, status, created_at, policy_ack_at) VALUES (?, 'President', 'active', ?, ?)").run(people.president, now, now);
  for (const [key, role] of [["reviewer", "BoardMember"], ["other", "Secretary"], ["unauthorized", "Treasurer"]]) {
    db.database.prepare("INSERT INTO members (email, role, status, created_at) VALUES (?, ?, 'active', ?)").run(people[key], role, now);
  }
  const actors = {};
  for (const [key, email] of Object.entries(people)) {
    const identity = await signedIdentity(email);
    const env = { ACCESS_TEAM_DOMAIN: identity.domain, ACCESS_AUD: "aud", PRESIDENT_EMAIL: people.president, DB: db };
    const call = async (path, { method = "GET", body, cookie, origin = ORIGIN } = {}) => {
      const headers = { "cf-access-jwt-assertion": identity.token };
      if (cookie) headers.cookie = cookie;
      if (method !== "GET") headers.origin = origin;
      if (body !== undefined) headers["content-type"] = "application/json";
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => Response.json({ keys: [identity.jwk] });
      try {
        return await handleRequest(new Request(`${ORIGIN}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), env);
      } finally {
        globalThis.fetch = originalFetch;
      }
    };
    const login = await call("/api/session", { method: "POST" });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    actors[key] = { email: people[key], api: (path, options = {}) => call(path, { ...options, cookie }) };
  }
  return { db, actors, people };
}

const store = async (db, rcgi) => assert.equal((await intake(db, validBody(rcgi))).status, 202);

test("intake stores a validated submission with an RCGI reference and a content-free audit entry", async () => {
  const db = makeDb();
  const response = await intake(db, validBody());
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { received: true });
  assert.equal(response.headers.get("access-control-allow-origin"), SITE);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const row = db.database.prepare("SELECT * FROM applications").get();
  assert.equal(row.rcgi, "RCGI-0123456789ab");
  assert.equal(row.status, "new");
  assert.equal(row.assigned_to, null);
  const audits = db.database.prepare("SELECT * FROM audit_log").all();
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "application_received");
  assert.equal(audits[0].detail_json, JSON.stringify({ rcgi: "RCGI-0123456789ab" }));
  assert.ok(!JSON.stringify(audits).includes("SYNTHETIC"));
});

test("intake rejects bad origins, methods, content types, oversize and invalid bodies", async () => {
  const db = makeDb();
  assert.equal((await intake(db, validBody(), { origin: "https://evil.example.org" })).status, 403);
  assert.equal((await intake(db, validBody(), { origin: null })).status, 403);
  const preflight = await intake(db, null, { method: "OPTIONS" });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), SITE);
  assert.equal((await intake(db, null, { method: "GET" })).status, 405);
  assert.equal((await intake(db, validBody(), { headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await intake(db, null, { raw: "x".repeat(9000) })).status, 413);
  assert.equal((await intake(db, null, { raw: "{not json" })).status, 400);
  for (const bad of [
    { ...validBody(), rcgi: "RCGI-XYZ" },
    { ...validBody(), recoveryStage: "other" },
    { ...validBody(), needs: [] },
    { ...validBody(), needs: ["housing", "housing"] },
    { ...validBody(), needs: ["pets"] },
    { ...validBody(), goals: "" },
    { ...validBody(), goals: "x".repeat(1501) },
    { ...validBody(), confirmation: false },
    { ...validBody(), email: "applicant@example.org" },
  ]) {
    assert.equal(validateSubmission(bad), null);
    assert.equal((await intake(db, bad)).status, 400);
  }
  const notFound = await handleIntake(new Request("https://intake.example.org/other", { headers: { origin: SITE } }), { DB: db });
  assert.equal(notFound.status, 404);
  assert.equal(db.database.prepare("SELECT COUNT(*) AS c FROM applications").get().c, 0);
});

test("duplicate RCGI submissions are indistinguishable and cannot overwrite", async () => {
  const db = makeDb();
  await store(db, "RCGI-0123456789ab");
  const second = { ...validBody("RCGI-0123456789ab"), goals: "OVERWRITE" };
  const response = await intake(db, second);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { received: true });
  assert.equal(db.database.prepare("SELECT goals FROM applications").get().goals, "SYNTHETIC-GOALS-TEXT");
  assert.equal(db.database.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'application_received'").get().c, 1);
});

test("intake storage failure returns a generic 503 and logs no content", async () => {
  const logs = [];
  const original = console.error;
  console.error = (...args) => logs.push(args.join(" "));
  try {
    const response = await handleIntake(new Request("https://intake.example.org/applications", {
      method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: JSON.stringify(validBody()),
    }), { DB: { prepare() { throw new Error("SYNTHETIC-NEED-TEXT leaked"); } } });
    assert.equal(response.status, 503);
  } finally {
    console.error = original;
  }
  assert.ok(logs.every((line) => !line.includes("SYNTHETIC")));
});

test("the President sees the inbox; reviewers and others do not by default", async () => {
  const { db, actors } = await setup();
  await store(db, "RCGI-0123456789ab");
  const list = await actors.president.api("/api/applications");
  assert.equal(list.status, 200);
  const { applications } = await list.json();
  assert.equal(applications.length, 1);
  assert.deepEqual(Object.keys(applications[0]).sort(), ["assignedTo", "createdAt", "rcgi", "status", "updatedAt"]);
  assert.ok(!JSON.stringify(applications).includes("SYNTHETIC"));

  const detail = await actors.president.api("/api/applications/RCGI-0123456789ab");
  assert.equal((await detail.json()).application.goals, "SYNTHETIC-GOALS-TEXT");

  for (const key of ["reviewer", "other", "unauthorized"]) {
    assert.equal((await actors[key].api("/api/applications")).status, 403);
    assert.equal((await actors[key].api("/api/applications/RCGI-0123456789ab")).status, 403);
  }
  assert.equal((await actors.president.api("/api/applications/not-an-id")).status, 404);
  assert.equal((await actors.president.api("/api/applications/RCGI-ffffffffffff")).status, 404);
});

test("President authorizes reviewers, assigns, and only the assignee can read and review", async () => {
  const { db, actors, people } = await setup();
  await store(db, "RCGI-0123456789ab");
  await store(db, "RCGI-aaaaaaaaaaaa");
  const assign = (assignee, rcgi = "RCGI-0123456789ab") => actors.president.api(`/api/applications/${rcgi}/assign`, { method: "POST", body: { assignee } });

  // Not yet authorized as a reviewer.
  assert.equal((await assign(people.reviewer)).status, 400);
  // Only the President may manage reviewers.
  assert.equal((await actors.reviewer.api("/api/applications/reviewers", { method: "POST", body: { email: people.reviewer, authorized: true } })).status, 403);
  // The President cannot be a reviewer; unknown members are rejected.
  assert.equal((await actors.president.api("/api/applications/reviewers", { method: "POST", body: { email: people.president, authorized: true } })).status, 400);
  assert.equal((await actors.president.api("/api/applications/reviewers", { method: "POST", body: { email: "nobody@example.org", authorized: true } })).status, 400);

  assert.equal((await actors.president.api("/api/applications/reviewers", { method: "POST", body: { email: people.reviewer, authorized: true } })).status, 200);
  assert.equal((await assign(people.unauthorized)).status, 400);
  assert.equal((await assign(people.reviewer)).status, 200);

  const mine = await (await actors.reviewer.api("/api/applications")).json();
  assert.deepEqual(mine.applications.map((a) => a.rcgi), ["RCGI-0123456789ab"]);
  assert.equal(mine.applications[0].status, "assigned");
  assert.equal((await actors.reviewer.api("/api/applications/RCGI-0123456789ab")).status, 200);
  // Unassigned and nonexistent records are indistinguishable to a reviewer.
  assert.equal((await actors.reviewer.api("/api/applications/RCGI-aaaaaaaaaaaa")).status, 404);
  assert.equal((await actors.reviewer.api("/api/applications/RCGI-ffffffffffff")).status, 404);
  // Another authorized reviewer who is not assigned cannot read or change it.
  await actors.president.api("/api/applications/reviewers", { method: "POST", body: { email: people.other, authorized: true } });
  assert.equal((await actors.other.api("/api/applications/RCGI-0123456789ab")).status, 404);
  assert.equal((await actors.other.api("/api/applications/RCGI-0123456789ab/status", { method: "POST", body: { status: "recommended" } })).status, 404);
  assert.deepEqual((await (await actors.other.api("/api/applications")).json()).applications, []);

  const status = (actor, value) => actor.api("/api/applications/RCGI-0123456789ab/status", { method: "POST", body: { status: value } });
  assert.equal((await status(actors.reviewer, "in_review")).status, 200);
  assert.equal((await status(actors.reviewer, "closed")).status, 400);
  assert.equal((await status(actors.reviewer, "new")).status, 400);
  assert.equal((await status(actors.reviewer, "recommended")).status, 200);
  assert.equal((await actors.reviewer.api("/api/applications/RCGI-0123456789ab/assign", { method: "POST", body: { assignee: people.other } })).status, 403);

  assert.equal((await status(actors.president, "closed")).status, 200);
  assert.equal((await status(actors.reviewer, "in_review")).status, 409);
  assert.equal((await assign(people.other)).status, 409);
});

test("revoking a reviewer returns their open applications to the unassigned queue", async () => {
  const { db, actors, people } = await setup();
  await store(db, "RCGI-0123456789ab");
  await actors.president.api("/api/applications/reviewers", { method: "POST", body: { email: people.reviewer, authorized: true } });
  await actors.president.api("/api/applications/RCGI-0123456789ab/assign", { method: "POST", body: { assignee: people.reviewer } });
  assert.equal((await actors.president.api("/api/applications/reviewers", { method: "POST", body: { email: people.reviewer, authorized: false } })).status, 200);
  const row = db.database.prepare("SELECT status, assigned_to FROM applications").get();
  assert.deepEqual({ ...row }, { status: "new", assigned_to: null });
  assert.equal((await actors.reviewer.api("/api/applications")).status, 403);
  // Re-authorization works after revocation.
  assert.equal((await actors.president.api("/api/applications/reviewers", { method: "POST", body: { email: people.reviewer, authorized: true } })).status, 200);
  assert.equal((await actors.reviewer.api("/api/applications")).status, 200);
});

test("unassigning, same-origin and body checks, and status/assignee consistency", async () => {
  const { db, actors, people } = await setup();
  await store(db, "RCGI-0123456789ab");
  await actors.president.api("/api/applications/reviewers", { method: "POST", body: { email: people.reviewer, authorized: true } });
  const path = "/api/applications/RCGI-0123456789ab";
  // Unassigned applications cannot be put in review.
  assert.equal((await actors.president.api(`${path}/status`, { method: "POST", body: { status: "in_review" } })).status, 409);
  await actors.president.api(`${path}/assign`, { method: "POST", body: { assignee: people.reviewer } });
  assert.equal((await actors.president.api(`${path}/assign`, { method: "POST", body: { assignee: null } })).status, 200);
  assert.deepEqual({ ...db.database.prepare("SELECT status, assigned_to FROM applications").get() }, { status: "new", assigned_to: null });
  assert.equal((await actors.president.api(`${path}/assign`, { method: "POST", body: { assignee: 5 } })).status, 400);
});

test("every inbox action and denial is audited without application content", async () => {
  const { db, actors, people } = await setup();
  await store(db, "RCGI-0123456789ab");
  await actors.president.api("/api/applications/reviewers", { method: "POST", body: { email: people.reviewer, authorized: true } });
  await actors.president.api("/api/applications/RCGI-0123456789ab/assign", { method: "POST", body: { assignee: people.reviewer } });
  await actors.reviewer.api("/api/applications/RCGI-0123456789ab");
  await actors.reviewer.api("/api/applications/RCGI-0123456789ab/status", { method: "POST", body: { status: "in_review" } });
  await actors.unauthorized.api("/api/applications");
  await actors.president.api("/api/applications");

  const actions = db.database.prepare("SELECT actor_email, action FROM audit_log ORDER BY id").all().map((r) => `${r.actor_email}:${r.action}`);
  for (const expected of [
    "system:intake:application_received",
    `${people.president}:application_reviewer_authorized`,
    `${people.president}:application_assigned`,
    `${people.reviewer}:application_viewed`,
    `${people.reviewer}:application_status_changed`,
    `${people.unauthorized}:authorization_denied`,
    `${people.president}:application_list_read`,
  ]) assert.ok(actions.includes(expected), expected);
  assert.ok(!JSON.stringify(db.database.prepare("SELECT * FROM audit_log").all()).includes("SYNTHETIC"));

  const feed = await (await actors.president.api("/api/audit")).json();
  assert.ok(feed.entries.some((entry) => entry.action === "application_assigned"));
  assert.throws(() => db.database.prepare("DELETE FROM audit_log").run(), /append-only/);
  assert.equal((await actors.reviewer.api("/api/audit")).status, 403);
});

test("state-changing application endpoints require same-origin JSON", async () => {
  const { db, actors, people } = await setup();
  await store(db, "RCGI-0123456789ab");
  const body = { email: people.reviewer, authorized: true };
  const crossOrigin = await actors.president.api("/api/applications/reviewers", { method: "POST", body, origin: "https://evil.example.org" });
  assert.equal(crossOrigin.status, 403);
  assert.equal((await actors.president.api("/api/applications/RCGI-0123456789ab/status", { method: "POST" })).status, 400);
  assert.equal(db.database.prepare("SELECT COUNT(*) AS c FROM application_reviewers").get().c, 0);
});
