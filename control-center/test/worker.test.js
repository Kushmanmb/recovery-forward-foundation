import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handleRequest, verifyAccessAssertion } from "../src/worker.js";

let domainNumber = 0;
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

async function signedIdentity(email, claimOverrides = {}) {
  const domain = `test-${++domainNumber}.cloudflareaccess.com`;
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const keyId = `test-key-${domainNumber}`;
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  Object.assign(jwk, { kid: keyId, use: "sig", alg: "RS256" });
  const header = encode({ alg: "RS256", typ: "JWT", kid: keyId });
  const claims = encode({
    iss: `https://${domain}`,
    aud: ["test-audience"],
    sub: "verified-subject",
    email,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
    ...claimOverrides,
  });
  const signed = `${header}.${claims}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(signed));
  const token = `${signed}.${Buffer.from(signature).toString("base64url")}`;
  return { domain, jwk, token };
}

async function withFetch(mock, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function mockDb(role, status = "active") {
  return {
    prepare(sql) {
      return {
        bind() { return this; },
        async first() {
          if (sql.includes("FROM sessions JOIN members")) {
            return { email: "member@example.org", role, status };
          }
          return null;
        },
        async all() { return { results: [] }; },
        async run() { return { success: true }; },
      };
    },
  };
}

function databaseDb() {
  const database = new DatabaseSync(":memory:");
  database.exec(readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8"));
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

function bootstrapDb() {
  let member = null;
  const sessions = new Map();
  return {
    get member() { return member; },
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() {
          if (sql.includes("FROM sessions JOIN members")) {
            const session = sessions.get(values[0]);
            return session && !session.revokedAt && session.expiresAt > values[1] && member
              ? { email: member.email, role: member.role, status: member.status }
              : null;
          }
          if (sql.includes("SELECT COUNT(*) AS count FROM members")) return { count: member ? 1 : 0 };
          if (sql.includes("FROM members WHERE email = ?")) {
            return member?.email === values[0] ? { ...member } : null;
          }
          return null;
        },
        async all() { return { results: [] }; },
        async run() {
          if (sql.includes("INSERT OR IGNORE INTO members")) {
            member ||= { email: values[0], role: "President", status: "pending" };
          } else if (sql.includes("INSERT INTO sessions")) {
            sessions.set(values[0], { expiresAt: values[3], revokedAt: null });
          } else if (sql.includes("UPDATE members SET status = 'active'")) {
            if (member?.email === values[1] && member.role === "President" && member.status === "pending") member.status = "active";
          } else if (sql.includes("UPDATE sessions SET revoked_at")) {
            const session = sessions.get(values[1]);
            if (session) session.revokedAt = values[0];
          }
          return { success: true };
        },
      };
    },
  };
}

function requestEnv(identity, extra = {}) {
  return {
    ACCESS_TEAM_DOMAIN: identity.domain,
    ACCESS_AUD: "test-audience",
    PRESIDENT_EMAIL: "president@example.org",
    ...extra,
  };
}

async function sessionRequest(identity, env, path, { method = "GET", cookie, body } = {}) {
  const headers = { "cf-access-jwt-assertion": identity.token };
  if (cookie) headers.cookie = cookie;
  if (method !== "GET") headers.origin = "https://admin.example.org";
  if (body !== undefined) headers["content-type"] = "application/json";
  return withIdentity(identity, () => handleRequest(new Request(`https://admin.example.org${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), env));
}

async function withIdentity(identity, callback) {
  return withFetch(
    async () => Response.json({ keys: [identity.jwk] }),
    callback,
  );
}

test("Cloudflare Access assertions require a valid signature and matching claims", async () => {
  const identity = await signedIdentity("PRESIDENT@example.org");
  await withFetch(async () => Response.json({ keys: [identity.jwk] }), async () => {
    assert.deepEqual(
      await verifyAccessAssertion(identity.token, requestEnv(identity)),
      { email: "president@example.org", subject: "verified-subject" },
    );

    const [header, claims, signature] = identity.token.split(".");
    const altered = `${header}.${encode({ ...JSON.parse(Buffer.from(claims, "base64url")), email: "attacker@example.org" })}.${signature}`;
    assert.equal(await verifyAccessAssertion(altered, requestEnv(identity)), null);
    assert.equal(await verifyAccessAssertion("not.a.jwt", requestEnv(identity)), null);
  });

  const wrongAudience = await signedIdentity("president@example.org", { aud: "another-app" });
  await withFetch(async () => Response.json({ keys: [wrongAudience.jwk] }), async () => {
    assert.equal(await verifyAccessAssertion(wrongAudience.token, requestEnv(wrongAudience)), null);
  });
});

test("unverified requests cannot reach the UI or API", async () => {
  const response = await handleRequest(new Request("https://admin.example.org/"), {
    ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com",
    ACCESS_AUD: "test-audience",
    ASSETS: { fetch: () => new Response("UI") },
  });
  assert.equal(response.status, 401);
  assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
});

test("server RBAC denies non-Presidents access to the audit endpoint", async () => {
  const president = await signedIdentity("member@example.org");
  const boardMember = await signedIdentity("member@example.org");

  for (const [identity, role, expectedStatus] of [
    [president, "President", 200],
    [boardMember, "BoardMember", 403],
  ]) {
    const env = requestEnv(identity, { DB: mockDb(role) });
    const response = await withFetch(
      async () => Response.json({ keys: [identity.jwk] }),
      () => handleRequest(new Request("https://admin.example.org/api/audit", {
        headers: {
          "cf-access-jwt-assertion": identity.token,
          cookie: "__Host-rff_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        },
      }), env),
    );
    assert.equal(response.status, expectedStatus);
  }
});

test("Registry adapter keeps credentials server-side and returns aggregates only", async () => {
  const identity = await signedIdentity("member@example.org");
  const secret = "synthetic-registry-token";
  const env = requestEnv(identity, {
    DB: mockDb("Treasurer"),
    REGISTRY_API_URL: "https://api.recoveryforwardfoundation.org/v1/summary",
    REGISTRY_API_TOKEN: secret,
  });
  let registryAuthorization;
  const response = await withFetch(async (url, options = {}) => {
    if (String(url).endsWith("/cdn-cgi/access/certs")) return Response.json({ keys: [identity.jwk] });
    registryAuthorization = options.headers.authorization;
    return Response.json({
      summary: { statusCounts: { pending: 2, verified: 3, closed: 4 } },
      applicant: { email: "private@example.org" },
    });
  }, () => handleRequest(new Request("https://admin.example.org/api/registry/summary", {
    headers: {
      "cf-access-jwt-assertion": identity.token,
      cookie: "__Host-rff_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    },
  }), env));

  const body = await response.text();
  assert.equal(response.status, 200);
  assert.equal(registryAuthorization, "Bearer " + secret);
  assert.deepEqual(JSON.parse(body), { summary: { statusCounts: { pending: 2, verified: 3, closed: 4 } } });
  assert.equal(body.includes(secret), false);
  assert.equal(body.includes("private@example.org"), false);
});

test("public registration is denied for identities other than the configured President", async () => {
  const identity = await signedIdentity("uninvited@example.org");
  const env = requestEnv(identity, { DB: mockDb("BoardMember", "active") });
  const response = await withFetch(
    async () => Response.json({ keys: [identity.jwk] }),
    () => handleRequest(new Request("https://admin.example.org/api/session", {
      method: "POST",
      headers: {
        origin: "https://admin.example.org",
        "cf-access-jwt-assertion": identity.token,
      },
    }), env),
  );
  assert.equal(response.status, 403);
});

test("pending members cannot access administrative APIs or claim role permissions", async () => {
  const identity = await signedIdentity("member@example.org");
  const env = requestEnv(identity, { DB: mockDb("President", "pending") });

  await withIdentity(identity, async () => {
    for (const path of ["/api/audit", "/api/registry/summary", "/api/unknown"]) {
      const response = await handleRequest(new Request(`https://admin.example.org${path}`, {
        headers: {
          "cf-access-jwt-assertion": identity.token,
          cookie: "__Host-rff_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        },
      }), env);
      assert.equal(response.status, 403, path);
    }

    const profile = await handleRequest(new Request("https://admin.example.org/api/me", {
      headers: {
        "cf-access-jwt-assertion": identity.token,
        cookie: "__Host-rff_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      },
    }), env);
    assert.deepEqual(await profile.json(), {
      email: "member@example.org",
      role: "President",
      status: "pending",
      setupRequired: true,
      permissions: [],
    });
  });
});

test("database-backed sessions enforce issuance, identity, expiry, revocation, and suspension", async () => {
  const identity = await signedIdentity("member@example.org");
  const otherIdentity = await signedIdentity("other@example.org");
  const DB = databaseDb();
  const env = requestEnv(identity, { DB });
  DB.database.prepare("INSERT INTO members (email, role, status, created_at) VALUES (?, ?, ?, ?)")
    .run("member@example.org", "Treasurer", "active", Date.now());

  try {
    const nonexistentCookie = `__Host-rff_session=${"A".repeat(43)}`;
    assert.equal((await sessionRequest(identity, env, "/api/me", { cookie: nonexistentCookie })).status, 401);

    const login = await sessionRequest(identity, env, "/api/session", { method: "POST" });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const token = cookie.split("=")[1];
    const session = DB.database.prepare("SELECT session_hash, member_email, expires_at FROM sessions").get();
    assert.equal(session.member_email, "member@example.org");
    assert.match(session.session_hash, /^[a-f0-9]{64}$/);
    assert.notEqual(session.session_hash, token);
    assert.equal((await sessionRequest(identity, env, "/api/me", { cookie })).status, 200);
    assert.equal((await sessionRequest(otherIdentity, requestEnv(otherIdentity, { DB }), "/api/me", { cookie })).status, 401);

    DB.database.prepare("UPDATE sessions SET expires_at = 0 WHERE session_hash = ?").run(session.session_hash);
    assert.equal((await sessionRequest(identity, env, "/api/me", { cookie })).status, 401);

    const secondLogin = await sessionRequest(identity, env, "/api/session", { method: "POST" });
    assert.equal(secondLogin.status, 200);
    const secondCookie = secondLogin.headers.get("set-cookie").split(";")[0];
    const logout = await sessionRequest(identity, env, "/api/session", { method: "DELETE", cookie: secondCookie });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
    const secondSession = DB.database.prepare("SELECT session_hash, revoked_at FROM sessions ORDER BY rowid DESC LIMIT 1").get();
    assert.notEqual(secondSession.revoked_at, null);
    assert.equal((await sessionRequest(identity, env, "/api/me", { cookie: secondCookie })).status, 401);

    const thirdLogin = await sessionRequest(identity, env, "/api/session", { method: "POST" });
    const thirdCookie = thirdLogin.headers.get("set-cookie").split(";")[0];
    DB.database.prepare("UPDATE members SET status = 'suspended' WHERE email = ?").run("member@example.org");
    assert.equal((await sessionRequest(identity, env, "/api/me", { cookie: thirdCookie })).status, 401);
    assert.equal((await sessionRequest(identity, env, "/api/session", { method: "DELETE", cookie: thirdCookie })).status, 200);
    assert.notEqual(DB.database.prepare("SELECT revoked_at FROM sessions ORDER BY rowid DESC LIMIT 1").get().revoked_at, null);
  } finally {
    DB.database.close();
  }
});

test("database-backed pending President sessions cannot access administrative endpoints", async () => {
  const identity = await signedIdentity("president@example.org");
  const DB = databaseDb();
  const env = requestEnv(identity, { DB });

  try {
    const login = await sessionRequest(identity, env, "/api/session", { method: "POST" });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).status, "pending");
    const cookie = login.headers.get("set-cookie").split(";")[0];
    for (const path of ["/api/audit", "/api/registry/summary", "/api/unknown"]) {
      assert.equal((await sessionRequest(identity, env, path, { cookie })).status, 403, path);
    }
  } finally {
    DB.database.close();
  }
});

test("only the configured President can bootstrap and activate the first account", async () => {
  const unauthorizedIdentity = await signedIdentity("attacker@example.org");
  const emptyDB = bootstrapDb();
  await withIdentity(unauthorizedIdentity, async () => {
    const denied = await handleRequest(new Request("https://admin.example.org/api/session", {
      method: "POST",
      headers: {
        origin: "https://admin.example.org",
        "cf-access-jwt-assertion": unauthorizedIdentity.token,
      },
    }), requestEnv(unauthorizedIdentity, { DB: emptyDB }));
    assert.equal(denied.status, 403);
    assert.equal(emptyDB.member, null);
  });

  const identity = await signedIdentity("president@example.org");
  const DB = bootstrapDb();
  const env = requestEnv(identity, { DB });

  await withIdentity(identity, async () => {
    const login = await handleRequest(new Request("https://admin.example.org/api/session", {
      method: "POST",
      headers: { origin: "https://admin.example.org", "cf-access-jwt-assertion": identity.token },
    }), env);
    assert.equal(login.status, 200);
    assert.deepEqual((await login.clone().json()).permissions, []);
    assert.equal(DB.member.status, "pending");
    const cookie = login.headers.get("set-cookie").split(";")[0];

    const noAcknowledgement = await handleRequest(new Request("https://admin.example.org/api/bootstrap/complete", {
      method: "POST",
      headers: {
        origin: "https://admin.example.org",
        "content-type": "application/json",
        cookie,
        "cf-access-jwt-assertion": identity.token,
      },
      body: JSON.stringify({ policyAck: false }),
    }), env);
    assert.equal(noAcknowledgement.status, 400);
    assert.equal(DB.member.status, "pending");

    const mismatch = await handleRequest(new Request("https://admin.example.org/api/bootstrap/complete", {
      method: "POST",
      headers: {
        origin: "https://admin.example.org",
        "content-type": "application/json",
        cookie,
        "cf-access-jwt-assertion": identity.token,
      },
      body: JSON.stringify({ policyAck: true }),
    }), { ...env, PRESIDENT_EMAIL: "different@example.org" });
    assert.equal(mismatch.status, 403);
    assert.equal(DB.member.status, "pending");

    const activation = await handleRequest(new Request("https://admin.example.org/api/bootstrap/complete", {
      method: "POST",
      headers: {
        origin: "https://admin.example.org",
        "content-type": "application/json",
        cookie,
        "cf-access-jwt-assertion": identity.token,
      },
      body: JSON.stringify({ policyAck: true }),
    }), env);
    assert.equal(activation.status, 200);
    assert.equal((await activation.json()).status, "active");
    assert.equal(DB.member.status, "active");

    const audit = await handleRequest(new Request("https://admin.example.org/api/audit", {
      headers: { cookie, "cf-access-jwt-assertion": identity.token },
    }), env);
    assert.equal(audit.status, 200);
  });
});

test("authentication_unavailable emits safe distinct diagnostics", async () => {
  const realFetch = globalThis.fetch;
  const realError = console.error;
  const cases = [
    ["access_env_missing", {}, null],
    ["access_team_domain_invalid", { ACCESS_TEAM_DOMAIN: "evil.example.com", ACCESS_AUD: "a" }, null],
    ["jwks_fetch_failed", null, () => { throw new Error("network"); }],
    ["jwks_non_200", null, () => new Response("no", { status: 502 })],
    ["jwks_invalid_json", null, () => new Response("not json")],
    ["jwks_missing_keys", null, () => new Response(JSON.stringify({ keys: [] }))],
  ];
  try {
    for (const [reason, env, fetcher] of cases) {
      const identity = await signedIdentity("president@example.org");
      const logs = [];
      console.error = (line) => logs.push(line);
      globalThis.fetch = fetcher ? async () => fetcher() : realFetch;
      const response = await handleRequest(new Request("https://admin.example.org/api/me", {
        headers: { "cf-access-jwt-assertion": identity.token },
      }), env ?? requestEnv(identity));
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "authentication_unavailable" });
      assert.equal(logs.length, 1);
      assert.equal(JSON.parse(logs[0]).reason, reason);
      assert.ok(!logs[0].includes(identity.token));
      assert.ok(!logs[0].includes("president@example.org"));
    }
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
  }
});
