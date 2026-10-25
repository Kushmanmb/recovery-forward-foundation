import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { GOVERNANCE_ROUTES, governanceApi } from "../src/governance-api.js";
import { boardAccess } from "../src/board-access.js";
import { handleRequest } from "../src/worker.js";
import { validateStagingConfig } from "../scripts/check-staging-config.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const staging = read("../wrangler.staging.toml");
const production = read("../wrangler.toml");
const ORIGIN = "https://staging.example.org";

function createDb() {
  const database = new DatabaseSync(":memory:");
  for (const file of ["0001_initial.sql", "0003_board_access.sql", "0010_governance_core.sql", "0011_governance_rules_lock.sql"]) database.exec(read(`../migrations/${file}`));
  return {
    database,
    async batch(statements) { database.exec("BEGIN"); try { const r = statements.map((s) => s.run()); database.exec("COMMIT"); return r; } catch (e) { database.exec("ROLLBACK"); throw e; } },
    prepare(sql) {
      const statement = database.prepare(sql);
      let values = [];
      return { bind(...a) { values = a; return this; }, first() { return statement.get(...values) || null; }, all() { return { results: statement.all(...values) }; }, run() { return statement.run(...values); } };
    },
  };
}

test("staging config is isolated from production and passes the preflight", () => {
  assert.deepEqual(validateStagingConfig(staging, production), []);
  // Deploy mode fails only while a placeholder remains; a configured staging id must pass it.
  const deployProblems = validateStagingConfig(staging, production, { forDeploy: true }).join();
  if (/REPLACE_WITH_/.test(staging)) assert.match(deployProblems, /placeholders remain/);
  else assert.deepEqual(deployProblems, "");
  const withId = (id) => staging.replace(/database_id = "[^"]*"/, `database_id = "${id}"`);
  assert.match(validateStagingConfig(withId("REPLACE_WITH_STAGING_D1_DATABASE_ID"), production, { forDeploy: true }).join(), /placeholders remain/);
  assert.deepEqual(validateStagingConfig(withId("11111111-2222-3333-4444-555555555555"), production, { forDeploy: true }), []);
});

test("preflight rejects configs that touch production resources", () => {
  const prodDbId = /database_id = "([^"]+)"/.exec(production)[1];
  const bad = (text) => validateStagingConfig(text, production).join("|");
  assert.match(bad(staging.replace(/database_id = "[^"]*"/, `database_id = "${prodDbId}"`)), /database_id is identical/);
  assert.match(bad(staging.replace(/database_name = "[^"]+"/, 'database_name = "recovery-forward-control-center-db"')), /database_name/);
  assert.match(bad(staging.replace("admin-staging.", "admin.")), /route/);
  assert.match(bad(staging.replace('name = "recovery-forward-control-center-staging"', 'name = "recovery-forward-control-center"')), /Worker name/);
  assert.match(bad(staging.replace("workers_dev = false", "workers_dev = true")), /workers_dev/);
  assert.match(bad(staging.replace('APP_ENV = "staging"', 'APP_ENV = "production"')), /APP_ENV/);
  assert.match(bad(`${staging}\nACCESS_AUD = "abc"`), /secrets/);
});

test("production config is unchanged by staging work", () => {
  assert.match(production, /database_id = "3c02163b-1451-4221-b49c-73b4c908dda7"/);
  assert.match(production, /admin\.recoveryforwardfoundation\.org/);
  assert.doesNotMatch(production, /staging/i);
});

test("staging Worker fails closed without Cloudflare Access settings", async () => {
  const response = await handleRequest(new Request(`${ORIGIN}/api/governance/dashboard`, { headers: { "cf-access-jwt-assertion": "a.b.c" } }), { DB: createDb(), APP_ENV: "staging" });
  assert.equal(response.status, 503);
  const anonymous = await handleRequest(new Request(`${ORIGIN}/`), { DB: createDb(), APP_ENV: "staging", ACCESS_TEAM_DOMAIN: "x.cloudflareaccess.com", ACCESS_AUD: "aud" });
  assert.equal(anonymous.status, 401);
});

test("every governance route enforces permission, active status and same-origin writes", async () => {
  const env = { DB: createDb() };
  const call = (member, route, origin = ORIGIN) => governanceApi(new Request(`${ORIGIN}/api/governance/${route.sample}`, {
    method: route.method,
    headers: route.method === "POST" ? { origin, "content-type": "application/json" } : {},
    ...(route.method === "POST" ? { body: "{}" } : {}),
  }), env, member);
  const routes = GOVERNANCE_ROUTES.map((route) => ({ ...route, sample: route.pattern.source.replace(/^\^|\$$/g, "").replace(/\\\//g, "/").replace(/\(\\d\+\)/g, "1") }));
  assert.ok(routes.length >= 30);
  for (const route of routes) {
    assert.doesNotMatch(route.sample, /[\\()]/, `sample path ${route.sample}`);
    if (route.permission) {
      assert.equal((await call({ email: "x@example.org", role: "President", status: "suspended" }, route)).status, 403, `suspended: ${route.method} ${route.sample}`);
      assert.equal((await call({ email: "x@example.org", role: "Nonexistent", status: "active" }, route)).status, 403, `unknown role: ${route.method} ${route.sample}`);
    }
    if (route.method === "POST") {
      const forged = await call({ email: "p@example.org", role: "President", status: "active" }, route, "https://evil.example");
      assert.equal(forged.status, 403, `cross-origin: ${route.sample}`);
    }
  }
});

test("board management routes are President-only", async () => {
  const env = { DB: createDb() };
  const secretary = { email: "s@example.org", role: "Secretary", status: "active" };
  for (const [method, path] of [["GET", "/api/board"], ["POST", "/api/board/invite"], ["POST", "/api/board/activate"], ["POST", "/api/board/suspend"], ["POST", "/api/board/reinstate"], ["POST", "/api/board/revoke"]]) {
    const response = await boardAccess(new Request(`${ORIGIN}${path}`, { method, headers: { origin: ORIGIN, "content-type": "application/json" }, ...(method === "POST" ? { body: "{}" } : {}) }), env, secretary);
    assert.equal(response.status, 403, path);
  }
});

test("frontend calls only API routes that the Worker implements", () => {
  const app = read("../../admin-prototype/app.js");
  const known = (method, path) => GOVERNANCE_ROUTES.some((route) => route.method === method && route.pattern.test(path));
  const check = (method, path) => assert.ok(known(method, path), `${method} /api/governance/${path} is not implemented`);

  for (const match of app.matchAll(/"\/api\/governance\/([a-z-]+)(?:\/")?/g)) check("GET", match[1]);
  const region = (from, to) => app.slice(app.indexOf(from), app.indexOf(to));
  const proposal = region("function renderProposal(", "function renderMeetingList(");
  const meeting = region("function renderMeeting(d)", "function renderMembers(");
  const members = region("function renderMembers(", "function renderDocuments(");
  const list = region("function renderProposalList(", "function checklist(");
  const meetings = region("function renderMeetingList(", "function renderMeeting(d)");

  const suffixes = (text) => [...text.matchAll(/base \+ "\/([a-z/-]+)"/g)].map((m) => m[1]);
  assert.ok(suffixes(proposal).length >= 8 && suffixes(meeting).length >= 5);
  for (const suffix of suffixes(proposal)) check("POST", `proposals/1/${suffix}`);
  for (const suffix of suffixes(meeting)) check("POST", `meetings/1/${suffix}`);
  for (const text of [members, list, meetings]) for (const match of text.matchAll(/(?:govForm|govButton)\("([a-z/-]+)"/g)) check("POST", match[1]);
  for (const path of ["proposals", "meetings", "directors", "rules", "resolutions", "dashboard"]) check("GET", path);
  assert.match(app, /"\/api\/board"/);
  assert.match(app, /"\/api\/audit"/);
});
