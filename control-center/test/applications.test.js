import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handleRequest } from "../src/worker.js";
import { handleIntake } from "../src/intake.js";
import { validateSubmission } from "../src/applications.js";

const ORIGIN = "https://admin.example.org";
const SITE = "https://recoveryforwardfoundation.org";
const SERVER_REGISTRY_TOKEN = ["synthetic", "registry", "existence", "token"].join("-");
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
  for (const file of ["0001_initial.sql", "0004_applications.sql", "0005_intake_abuse_controls.sql"]) {
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
        _run() { return statement.run(...values); },
      };
    },
    async batch(statements) {
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement._run());
        database.exec("COMMIT");
        return results.map((result) => ({ meta: { changes: Number(result.changes) } }));
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
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

async function intake(db, body, {
  origin = SITE,
  method = "POST",
  raw,
  headers = {},
  ip = "192.0.2.1",
  botScore,
  registry = async () => Response.json({ exists: true }),
  env: envOverrides = {},
} = {}) {
  const request = new Request("https://intake.example.org/applications", {
    method,
    headers: { ...(origin ? { origin } : {}), "cf-connecting-ip": ip, "content-type": "application/json", ...headers },
    ...(method === "POST" ? { body: raw ?? JSON.stringify(body) } : {}),
  });
  if (botScore !== undefined) Object.defineProperty(request, "cf", { value: { botManagement: { score: botScore } } });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = registry;
  try {
    return await handleIntake(request, {
      DB: db,
      INTAKE_RATE_LIMIT_SECRET: "synthetic-intake-rate-limit-secret-0123456789",
      REGISTRY_RCGI_VERIFY_URL: "https://api.recoveryforwardfoundation.org/integration/participants",
      REGISTRY_EXISTENCE_TOKEN: SERVER_REGISTRY_TOKEN,
      ...envOverrides,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
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

function raceAfterApplicationRead(db, onRead) {
  const prepare = db.prepare;
  let raced = false;
  db.prepare = function (sql) {
    const query = prepare.call(this, sql);
    if (sql !== "SELECT * FROM applications WHERE rcgi = ?") return query;
    return {
      bind(...values) { query.bind(...values); return this; },
      first() {
        const row = query.first();
        if (!raced) {
          raced = true;
          onRead();
        }
        return row;
      },
      all() { return query.all(); },
      run() { return query.run(); },
    };
  };
}

const store = async (db, rcgi) => assert.equal((await intake(db, validBody(rcgi))).status, 202);

test("intake stores a validated submission with an RCGI reference and a content-free audit entry", async () => {
  const db = makeDb();
  let registryRequest;
  const response = await intake(db, validBody(), {
    registry: async (url, options) => {
      registryRequest = { url: new URL(url), options };
      return Response.json({ exists: true });
    },
  });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { received: true });
  assert.equal(response.headers.get("access-control-allow-origin"), SITE);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(registryRequest.url.pathname, "/integration/participants/RCGI-0123456789ab/exists");
  assert.equal(registryRequest.url.search, "");
  assert.equal(registryRequest.options.headers.authorization.split(" ")[1], SERVER_REGISTRY_TOKEN);
  assert.equal(registryRequest.options.redirect, "manual");
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
  let invalidRequestIndex = 0;
  const crossOriginDb = makeDb();
  const crossOriginPost = await intake(crossOriginDb, validBody(), { origin: "https://evil.example.org" });
  assert.equal(crossOriginPost.status, 202);
  assert.equal(crossOriginPost.headers.get("access-control-allow-origin"), null);
  const serverPost = await intake(makeDb(), validBody(), { origin: null });
  assert.equal(serverPost.status, 202);
  assert.equal(serverPost.headers.get("access-control-allow-origin"), null);
  const preflight = await intake(db, null, { method: "OPTIONS" });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), SITE);
  assert.equal((await intake(db, null, { method: "OPTIONS", origin: "https://evil.example.org" })).status, 403);
  assert.equal((await intake(db, null, { method: "GET" })).status, 405);
  assert.equal((await intake(db, validBody(), { ip: "192.0.2.30", headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await intake(db, null, { ip: "192.0.2.31", raw: "x".repeat(9000) })).status, 413);
  assert.equal((await intake(db, null, { ip: "192.0.2.32", raw: "{not json" })).status, 400);
  let invalidRcgiLookups = 0;
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
    invalidRequestIndex += 1;
    assert.equal((await intake(db, bad, {
      ip: `192.0.2.${32 + invalidRequestIndex}`,
      registry: async () => {
        invalidRcgiLookups += 1;
        return Response.json({ exists: true });
      },
    })).status, 400);
  }
  assert.equal(invalidRcgiLookups, 0);
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

test("Registry existence false is acknowledged without storing", async () => {
  const db = makeDb();
  const response = await intake(db, validBody(), { registry: async () => Response.json({ exists: false }) });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { received: true });
  assert.equal(db.database.prepare("SELECT COUNT(*) AS c FROM applications").get().c, 0);
  assert.equal(db.database.prepare("SELECT COUNT(*) AS c FROM audit_log").get().c, 0);
});

test("unauthorized Registry access fails closed and caller credentials are never forwarded", async () => {
  const db = makeDb();
  const response = await intake(db, validBody(), {
    headers: { authorization: "caller-supplied" },
    registry: async (_url, options) => {
      assert.equal(options.headers.authorization.split(" ")[1], SERVER_REGISTRY_TOKEN);
      return Response.json({ error: "unauthorized" }, { status: 401 });
    },
  });
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes("synthetic-registry-token"));
  assert.equal(db.database.prepare("SELECT COUNT(*) AS c FROM applications").get().c, 0);
});

test("intake fails closed when the Registry existence token is missing", async () => {
  const db = makeDb();
  let registryCalls = 0;
  const response = await intake(db, validBody(), {
    registry: async () => {
      registryCalls += 1;
      return Response.json({ exists: true });
    },
    env: { REGISTRY_EXISTENCE_TOKEN: undefined },
  });
  assert.equal(response.status, 503);
  assert.equal(registryCalls, 0);
  assert.equal(db.database.prepare("SELECT COUNT(*) AS c FROM applications").get().c, 0);
});

test("malformed Registry responses fail closed without storing", async () => {
  for (const registry of [
    async () => new Response("{ malformed", { headers: { "content-type": "application/json" } }),
    async () => Response.json({ exists: "yes" }),
    async () => Response.json({}),
    async () => Response.json([ { exists: true } ]),
  ]) {
    const db = makeDb();
    const response = await intake(db, validBody(), { registry });
    assert.equal(response.status, 503);
    assert.equal(db.database.prepare("SELECT COUNT(*) AS c FROM applications").get().c, 0);
  }
});

test("Registry unavailable responses and redirects fail closed without storing", async () => {
  for (const registry of [
    async () => { throw new Error("secret and applicant data must not be logged"); },
    async () => Response.json({ exists: true }, { status: 500 }),
    async () => Response.json({ exists: true }, { status: 503 }),
    async () => new Response(null, { status: 302, headers: { location: "https://attacker.example/" } }),
  ]) {
    const db = makeDb();
    const response = await intake(db, validBody(), { registry });
    assert.equal(response.status, 503);
    assert.equal(db.database.prepare("SELECT COUNT(*) AS c FROM applications").get().c, 0);
    assert.equal(db.database.prepare("SELECT COUNT(*) AS c FROM audit_log").get().c, 0);
  }
});

test("server-side rate limits and bot scores suppress abusive submissions", async () => {
  const db = makeDb();
  let registryCalls = 0;
  const registry = async () => {
    registryCalls += 1;
    return Response.json({ exists: true });
  };
  for (let index = 0; index < 5; index += 1) {
    const rcgi = `RCGI-${index.toString(16).padStart(12, "0")}`;
    assert.equal((await intake(db, validBody(rcgi), { ip: "192.0.2.20", registry })).status, 202);
  }
  const limited = await intake(db, validBody("RCGI-000000000005"), { ip: "192.0.2.20", registry });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "600");
  assert.equal(registryCalls, 5);

  let botRegistryCalls = 0;
  const botDb = makeDb();
  const bot = await intake(botDb, validBody(), {
    ip: "192.0.2.21",
    botScore: 1,
    registry: async () => {
      botRegistryCalls += 1;
      return Response.json({ exists: true });
    },
  });
  assert.equal(bot.status, 202);
  assert.equal(botRegistryCalls, 0);
  assert.equal(botDb.database.prepare("SELECT COUNT(*) AS c FROM applications").get().c, 0);
});

test("intake fails closed when the rate-limit secret is missing", async () => {
  const db = makeDb();
  let registryCalls = 0;
  const response = await intake(db, validBody(), {
    env: { INTAKE_RATE_LIMIT_SECRET: "" },
    registry: async () => {
      registryCalls += 1;
      return Response.json({ exists: true });
    },
  });
  assert.equal(response.status, 503);
  assert.equal(registryCalls, 0);
  assert.equal(db.database.prepare("SELECT COUNT(*) AS c FROM applications").get().c, 0);
});

test("application insertion and its audit entry roll back together on audit failure", async () => {
  const db = makeDb();
  db.database.exec(`
    CREATE TRIGGER fail_intake_audit BEFORE INSERT ON audit_log
    WHEN NEW.actor_email = 'system:intake'
    BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END;
  `);
  const response = await intake(db, validBody());
  assert.equal(response.status, 503);
  assert.equal(db.database.prepare("SELECT COUNT(*) AS c FROM applications").get().c, 0);
  assert.equal(db.database.prepare("SELECT COUNT(*) AS c FROM audit_log").get().c, 0);
});

test("intake storage failure returns a generic 503 and logs no content", async () => {
  const logs = [];
  const original = console.error;
  console.error = (...args) => logs.push(args.join(" "));
  try {
    const db = makeDb();
    const brokenDb = { ...db, async batch() { throw new Error("SYNTHETIC-NEED-TEXT leaked"); } };
    const response = await intake(brokenDb, validBody());
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

test("concurrent reassignment prevents a stale President assignment from overwriting it", async () => {
  const { db, actors, people } = await setup();
  await store(db, "RCGI-0123456789ab");
  for (const email of [people.reviewer, people.other]) {
    assert.equal((await actors.president.api("/api/applications/reviewers", {
      method: "POST",
      body: { email, authorized: true },
    })).status, 200);
  }
  const path = "/api/applications/RCGI-0123456789ab";
  assert.equal((await actors.president.api(`${path}/assign`, {
    method: "POST",
    body: { assignee: people.reviewer },
  })).status, 200);

  raceAfterApplicationRead(db, () => {
    db.database.prepare(
      "UPDATE applications SET assigned_to = ?, assigned_by = ?, assigned_at = ?, status = 'assigned' WHERE rcgi = ?",
    ).run(people.other, people.president, Date.now(), "RCGI-0123456789ab");
  });
  const staleAssignment = await actors.president.api(`${path}/assign`, {
    method: "POST",
    body: { assignee: people.reviewer },
  });
  assert.equal(staleAssignment.status, 409);
  const row = db.database.prepare("SELECT assigned_to, status FROM applications WHERE rcgi = ?").get("RCGI-0123456789ab");
  assert.deepEqual({ ...row }, { assigned_to: people.other, status: "assigned" });
  assert.equal(db.database.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'application_assigned'").get().c, 1);
});

test("reviewer authorization and assignment are rechecked atomically for status updates", async () => {
  const { db, actors, people } = await setup();
  await store(db, "RCGI-0123456789ab");
  for (const email of [people.reviewer, people.other]) {
    assert.equal((await actors.president.api("/api/applications/reviewers", {
      method: "POST",
      body: { email, authorized: true },
    })).status, 200);
  }
  const path = "/api/applications/RCGI-0123456789ab";
  assert.equal((await actors.president.api(`${path}/assign`, {
    method: "POST",
    body: { assignee: people.reviewer },
  })).status, 200);

  raceAfterApplicationRead(db, () => {
    db.database.prepare(
      "UPDATE applications SET assigned_to = ?, assigned_by = ?, assigned_at = ? WHERE rcgi = ?",
    ).run(people.other, people.president, Date.now(), "RCGI-0123456789ab");
  });
  const oldReviewerUpdate = await actors.reviewer.api(`${path}/status`, {
    method: "POST",
    body: { status: "recommended" },
  });
  assert.equal(oldReviewerUpdate.status, 404);
  const row = db.database.prepare("SELECT assigned_to, status FROM applications WHERE rcgi = ?").get("RCGI-0123456789ab");
  assert.deepEqual({ ...row }, { assigned_to: people.other, status: "assigned" });
  assert.equal(db.database.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'application_status_changed'").get().c, 0);
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

const RCGI = "RCGI-0123456789ab";
const APP = `/api/applications/${RCGI}`;
const authorize = (actors, email, authorized = true) => actors.president.api("/api/applications/reviewers", { method: "POST", body: { email, authorized } });
const snapshot = (db) => ({
  app: { ...db.database.prepare("SELECT status, assigned_to, assigned_by, assigned_at, updated_at FROM applications").get() },
  reviewers: db.database.prepare("SELECT member_email, revoked_at FROM application_reviewers ORDER BY member_email").all().map((r) => ({ ...r })),
});
const failAudit = (db, action) => db.database.exec(
  `CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log WHEN NEW.action = '${action}' BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END;`,
);

test("a reviewer revoked between authorization and the read cannot see details or the list", async () => {
  const { db, actors, people } = await setup();
  await store(db, RCGI);
  await authorize(actors, people.reviewer);
  await actors.president.api(`${APP}/assign`, { method: "POST", body: { assignee: people.reviewer } });
  raceAfterApplicationRead(db, () => {
    db.database.prepare("UPDATE application_reviewers SET revoked_at = ? WHERE member_email = ?").run(Date.now(), people.reviewer);
  });
  const detail = await actors.reviewer.api(APP);
  assert.equal(detail.status, 404);
  assert.ok(!(await detail.text()).includes("SYNTHETIC-GOALS-TEXT"));
  db.database.prepare("UPDATE application_reviewers SET revoked_at = NULL").run();
  db.database.prepare("UPDATE application_reviewers SET revoked_at = ?").run(Date.now());
  assert.equal((await actors.reviewer.api(APP)).status, 403);
  assert.equal((await actors.reviewer.api("/api/applications")).status, 403);
});

test("a stale reviewer read after reassignment returns nothing and the new assignee sees the record", async () => {
  const { db, actors, people } = await setup();
  await store(db, RCGI);
  await authorize(actors, people.reviewer);
  await authorize(actors, people.other);
  await actors.president.api(`${APP}/assign`, { method: "POST", body: { assignee: people.reviewer } });
  raceAfterApplicationRead(db, () => {
    db.database.prepare("UPDATE applications SET assigned_to = ?").run(people.other);
  });
  assert.equal((await actors.reviewer.api(APP)).status, 404);
  assert.equal((await actors.reviewer.api("/api/applications").then((r) => r.json())).applications.length, 0);
  assert.equal((await actors.other.api(APP)).status, 200);
  assert.equal(db.database.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'application_viewed'").get().c, 1);
});

test("reassignment away from a reviewer revokes their access and revocation with unassignment is atomic with audit", async () => {
  const { db, actors, people } = await setup();
  await store(db, RCGI);
  await authorize(actors, people.reviewer);
  await authorize(actors, people.other);
  await actors.president.api(`${APP}/assign`, { method: "POST", body: { assignee: people.reviewer } });
  await actors.president.api(`${APP}/assign`, { method: "POST", body: { assignee: people.other } });
  assert.equal((await actors.reviewer.api(APP)).status, 404);
  assert.equal((await actors.reviewer.api(`${APP}/status`, { method: "POST", body: { status: "in_review" } })).status, 404);

  const before = snapshot(db);
  failAudit(db, "application_reviewer_revoked");
  const failed = await authorize(actors, people.other, false).catch(() => ({ status: 500 }));
  assert.ok(failed.status >= 500);
  assert.deepEqual(snapshot(db), before);
  assert.equal(db.database.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'application_reviewer_revoked'").get().c, 0);
});

test("audit-write failures roll back assignment, unassignment, status, authorization and revocation", async () => {
  for (const [action, run] of [
    ["application_assigned", (a, p) => a.president.api(`${APP}/assign`, { method: "POST", body: { assignee: p.reviewer } })],
    ["application_unassigned", (a) => a.president.api(`${APP}/assign`, { method: "POST", body: { assignee: null } })],
    ["application_status_changed", (a) => a.reviewer.api(`${APP}/status`, { method: "POST", body: { status: "in_review" } })],
    ["application_reviewer_authorized", (a, p) => authorize(a, p.other)],
    ["application_reviewer_revoked", (a, p) => authorize(a, p.reviewer, false)],
  ]) {
    const { db, actors, people } = await setup();
    await store(db, RCGI);
    await authorize(actors, people.reviewer);
    if (action !== "application_assigned") await actors.president.api(`${APP}/assign`, { method: "POST", body: { assignee: people.reviewer } });
    const before = snapshot(db);
    const auditCount = db.database.prepare("SELECT COUNT(*) AS c FROM audit_log").get().c;
    failAudit(db, action);
    const response = await run(actors, people).catch(() => ({ status: 500 }));
    assert.ok(response.status >= 500, action);
    assert.deepEqual(snapshot(db), before, action);
    assert.equal(db.database.prepare("SELECT COUNT(*) AS c FROM audit_log").get().c, auditCount, action);
  }
});

test("a suspended President cannot change application state even with a stale session", async () => {
  const { db, actors, people } = await setup();
  await store(db, RCGI);
  await authorize(actors, people.reviewer);
  raceAfterApplicationRead(db, () => {
    db.database.prepare("UPDATE members SET status = 'suspended' WHERE email = ?").run(people.president);
  });
  assert.equal((await actors.president.api(`${APP}/assign`, { method: "POST", body: { assignee: people.reviewer } })).status, 409);
  assert.equal(db.database.prepare("SELECT status FROM applications").get().status, "new");
  assert.equal(db.database.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'application_assigned'").get().c, 0);
});

function raceAfterQuery(db, matchSql, onRead) {
  const prepare = db.prepare;
  let raced = false;
  db.prepare = function (sql) {
    const query = prepare.call(this, sql);
    if (sql !== matchSql) return query;
    return {
      bind(...values) { query.bind(...values); return this; },
      first() {
        const row = query.first();
        if (!raced) { raced = true; onRead(); }
        return row;
      },
      all() { return query.all(); },
      run() { return query.run(); },
      _run() { return query._run(); },
    };
  };
}

const auditCount = (db, action) => db.database.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE action = ?").get(action).c;

test("authorizing a member suspended mid-request writes no reviewer row and no audit entry", async () => {
  const { db, actors, people } = await setup();
  raceAfterQuery(db, "SELECT email, role, status FROM members WHERE email = ?", () => {
    db.database.prepare("UPDATE members SET status = 'suspended' WHERE email = ?").run(people.reviewer);
  });
  assert.equal((await authorize(actors, people.reviewer)).status, 409);
  assert.equal(db.database.prepare("SELECT COUNT(*) AS c FROM application_reviewers").get().c, 0);
  assert.equal(auditCount(db, "application_reviewer_authorized"), 0);
});

test("repeated authorization and revocation are idempotent and not re-audited; a lost revocation race is not audited", async () => {
  const { db, actors, people } = await setup();
  assert.equal((await authorize(actors, people.reviewer)).status, 200);
  assert.equal((await authorize(actors, people.reviewer)).status, 200);
  assert.equal(auditCount(db, "application_reviewer_authorized"), 1);
  assert.equal((await authorize(actors, people.reviewer, false)).status, 200);
  assert.equal((await authorize(actors, people.reviewer, false)).status, 200);
  assert.equal(auditCount(db, "application_reviewer_revoked"), 1);

  // The President is suspended after the permission check: nothing changes and nothing is audited.
  assert.equal((await authorize(actors, people.reviewer)).status, 200);
  await store(db, RCGI);
  await actors.president.api(`${APP}/assign`, { method: "POST", body: { assignee: people.reviewer } });
  const before = snapshot(db);
  const audits = db.database.prepare("SELECT COUNT(*) AS c FROM audit_log").get().c;
  raceAfterQuery(db, "SELECT email, role, status FROM members WHERE email = ?", () => {
    db.database.prepare("UPDATE members SET status = 'suspended' WHERE email = ?").run(people.president);
  });
  assert.equal((await authorize(actors, people.reviewer, false)).status, 409);
  assert.deepEqual(snapshot(db), before);
  assert.equal(db.database.prepare("SELECT COUNT(*) AS c FROM audit_log").get().c, audits);
});
