import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handleRequest } from "../src/worker.js";

let counter = 0;
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

async function identity(email) {
  const domain = `gov-${++counter}.cloudflareaccess.com`;
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  Object.assign(jwk, { kid: `k${counter}`, use: "sig", alg: "RS256" });
  const now = Math.floor(Date.now() / 1000);
  const signed = `${encode({ alg: "RS256", typ: "JWT", kid: jwk.kid })}.${encode({ iss: `https://${domain}`, aud: ["aud"], sub: "s", email, iat: now, exp: now + 300 })}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(signed));
  return { domain, jwk, token: `${signed}.${Buffer.from(signature).toString("base64url")}` };
}

function createDb() {
  const database = new DatabaseSync(":memory:");
  for (const file of ["0001_initial.sql", "0003_board_access.sql", "0010_governance_core.sql", "0011_governance_rules_lock.sql"]) database.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
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

async function api(who, env, path, { method = "GET", cookie, body } = {}) {
  const headers = { "cf-access-jwt-assertion": who.token };
  if (cookie) headers.cookie = cookie;
  if (method !== "GET") headers.origin = "https://admin.example.org";
  if (body !== undefined) headers["content-type"] = "application/json";
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ keys: [who.jwk] });
  try {
    return await handleRequest(new Request(`https://admin.example.org${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), { ...env, ACCESS_TEAM_DOMAIN: who.domain, ACCESS_AUD: "aud", PRESIDENT_EMAIL: "president@example.org" });
  } finally { globalThis.fetch = original; }
}

async function signIn(who, env) {
  const response = await api(who, env, "/api/session", { method: "POST" });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

test("governance API is reachable only through Access plus an active server session", async () => {
  const DB = createDb();
  const env = { DB };
  const add = (email, role, status) => DB.database.prepare("INSERT INTO members (email, role, status, created_at) VALUES (?, ?, ?, ?)").run(email, role, status, Date.now());
  add("president@example.org", "President", "active");
  add("sec@example.org", "Secretary", "active");
  add("pending@example.org", "BoardMember", "pending");
  DB.database.prepare("INSERT INTO board_access_invitations (email, role, token_hash, created_at, expires_at, accepted_at) VALUES ('pending@example.org', 'BoardMember', 'h', 1, 2, 1)").run();
  add("susp@example.org", "BoardMember", "active");

  const anonymous = await handleRequest(new Request("https://admin.example.org/api/governance/dashboard"), { ...env, ACCESS_TEAM_DOMAIN: "x.cloudflareaccess.com", ACCESS_AUD: "aud" });
  assert.equal(anonymous.status, 401);

  const sec = await identity("sec@example.org");
  assert.equal((await api(sec, env, "/api/governance/dashboard")).status, 401, "no application session");
  const cookie = await signIn(sec, env);
  const dash = await api(sec, env, "/api/governance/dashboard", { cookie });
  assert.equal(dash.status, 200);
  assert.equal(dash.headers.get("cache-control"), "no-store");
  assert.equal((await dash.json()).governance.rulesVerified, false);

  const me = await (await api(sec, env, "/api/me", { cookie })).json();
  assert.ok(me.permissions.includes("proposals:review"));
  assert.ok(!me.permissions.includes("governance:verify"));

  // Cross-site writes and role escalation are refused end to end.
  const forged = await handleRequest(new Request("https://admin.example.org/api/governance/meetings", { method: "POST", headers: { "cf-access-jwt-assertion": sec.token, cookie, origin: "https://evil.example", "content-type": "application/json" }, body: "{}" }), { ...env, ACCESS_TEAM_DOMAIN: sec.domain, ACCESS_AUD: "aud", PRESIDENT_EMAIL: "president@example.org" }).catch(() => null);
  assert.ok(forged === null || forged.status >= 400);
  assert.equal((await api(sec, env, "/api/governance/rules", { method: "POST", cookie, body: {} })).status, 403);

  const pending = await identity("pending@example.org");
  const pendingCookie = await signIn(pending, env);
  assert.equal((await api(pending, env, "/api/governance/proposals", { cookie: pendingCookie })).status, 403, "pending members cannot use governance");

  const suspended = await identity("susp@example.org");
  const suspendedCookie = await signIn(suspended, env);
  DB.database.prepare("UPDATE members SET status = 'suspended' WHERE email = 'susp@example.org'").run();
  assert.equal((await api(suspended, env, "/api/governance/proposals", { cookie: suspendedCookie })).status, 401);

  const president = await identity("president@example.org");
  const presidentCookie = await signIn(president, env);
  const created = await api(sec, env, "/api/governance/proposals", { method: "POST", cookie, body: { title: "<img src=x onerror=alert(1)>", body: "b", category: "policy" } });
  assert.equal(created.status, 201);
  const listed = await (await api(president, env, "/api/governance/proposals", { cookie: presidentCookie })).json();
  assert.equal(listed.proposals.length, 0, "another member's draft is not listed");
  assert.equal((await api(president, env, "/api/audit", { cookie: presidentCookie })).status, 200);
  assert.equal((await api(sec, env, "/api/audit", { cookie })).status, 403, "President-only audit access preserved");
  assert.equal((await api(sec, env, "/api/board", { cookie })).status, 403, "President-only board administration preserved");
});
