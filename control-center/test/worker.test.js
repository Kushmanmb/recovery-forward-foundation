import test from "node:test";
import assert from "node:assert/strict";
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

function requestEnv(identity, extra = {}) {
  return {
    ACCESS_TEAM_DOMAIN: identity.domain,
    ACCESS_AUD: "test-audience",
    PRESIDENT_EMAIL: "president@example.org",
    ...extra,
  };
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
