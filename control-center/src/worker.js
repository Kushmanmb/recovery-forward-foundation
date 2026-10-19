import { ROLE_PERMISSIONS, ROLES, can } from "./rbac.js";

const COOKIE_NAME = "__Host-rff_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const MAX_REGISTRY_RESPONSE_BYTES = 64 * 1024;
const ACCESS_KEY_CACHE_MS = 5 * 60 * 1000;
let accessKeyCache;

class AccessUnavailable extends Error {
  constructor(reason = "unknown", details = {}) {
    super(reason);
    this.reason = reason;
    this.details = details;
  }
}

function logAccessDiagnostic(error) {
  // Only fixed reason codes and non-sensitive metadata are logged; never JWTs, secrets or env values.
  console.error(JSON.stringify({ event: "access_authentication_unavailable", reason: error.reason, ...error.details }));
}

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", ...headers },
});

function secureHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function base64UrlBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeSegment(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlBytes(value)));
}

function validTeamDomain(domain) {
  return typeof domain === "string" && /^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(domain);
}

async function getAccessKeys(domain, refresh = false) {
  if (!refresh && accessKeyCache?.domain === domain && accessKeyCache.expires > Date.now()) return accessKeyCache.keys;
  let response;
  try {
    response = await fetch(`https://${domain}/cdn-cgi/access/certs`, {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new AccessUnavailable("jwks_fetch_failed");
  }
  if (!response.ok) throw new AccessUnavailable("jwks_non_200", { status: response.status });
  let jwks;
  try {
    jwks = await response.json();
  } catch {
    throw new AccessUnavailable("jwks_invalid_json");
  }
  if (!Array.isArray(jwks?.keys) || jwks.keys.length === 0) throw new AccessUnavailable("jwks_missing_keys");
  accessKeyCache = { domain, keys: jwks.keys, expires: Date.now() + ACCESS_KEY_CACHE_MS };
  return jwks.keys;
}

export async function verifyAccessAssertion(assertion, env) {
  const teamDomainSet = typeof env.ACCESS_TEAM_DOMAIN === "string" && env.ACCESS_TEAM_DOMAIN !== "";
  const audSet = typeof env.ACCESS_AUD === "string" && env.ACCESS_AUD !== "";
  if (!teamDomainSet || !audSet) {
    throw new AccessUnavailable("access_env_missing", { access_team_domain_set: teamDomainSet, access_aud_set: audSet });
  }
  if (!validTeamDomain(env.ACCESS_TEAM_DOMAIN)) {
    throw new AccessUnavailable("access_team_domain_invalid");
  }
  if (typeof assertion !== "string" || assertion.length > 16_384) return null;

  let encodedHeader, encodedClaims, encodedSignature, header, claims;
  try {
    const parts = assertion.split(".");
    if (parts.length !== 3 || parts.some((part) => !part)) return null;
    [encodedHeader, encodedClaims, encodedSignature] = parts;
    header = decodeSegment(encodedHeader);
    claims = decodeSegment(encodedClaims);
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") return null;

  let keys = await getAccessKeys(env.ACCESS_TEAM_DOMAIN);
  let jwk = keys.find((key) => key.kid === header.kid && key.kty === "RSA" && (!key.use || key.use === "sig") && (!key.alg || key.alg === "RS256"));
  if (!jwk) {
    keys = await getAccessKeys(env.ACCESS_TEAM_DOMAIN, true);
    jwk = keys.find((key) => key.kid === header.kid && key.kty === "RSA" && (!key.use || key.use === "sig") && (!key.alg || key.alg === "RS256"));
  }
  if (!jwk) return null;

  let signatureValid = false;
  try {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    signatureValid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      base64UrlBytes(encodedSignature),
      new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`),
    );
  } catch {
    return null;
  }
  if (!signatureValid) return null;

  const now = Math.floor(Date.now() / 1000);
  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    claims.iss !== issuer
    || !audiences.includes(env.ACCESS_AUD)
    || typeof claims.email !== "string"
    || !claims.email.trim()
    || typeof claims.sub !== "string"
    || !claims.sub
    || !Number.isFinite(claims.exp)
    || claims.exp <= now
    || !Number.isFinite(claims.iat)
    || claims.iat > now + 60
    || claims.exp - claims.iat > SESSION_TTL_SECONDS
    || (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now))
  ) return null;

  return { email: claims.email.trim().toLowerCase(), subject: claims.sub };
}

async function digest(value) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function sessionToken(request) {
  const cookies = request.headers.get("cookie") || "";
  const match = cookies.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`));
  const value = match?.slice(COOKIE_NAME.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

function sessionCookie(token, maxAge = SESSION_TTL_SECONDS) {
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Strict`;
}

function sameOrigin(request) {
  return request.headers.get("origin") === new URL(request.url).origin;
}

async function audit(db, actor, action, detail = {}) {
  await db.prepare("INSERT INTO audit_log (actor_email, action, detail_json, created_at) VALUES (?, ?, ?, ?)")
    .bind(actor || "system", action, JSON.stringify(detail), Date.now()).run();
}

async function readRegistryJson(response) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REGISTRY_RESPONSE_BYTES) throw new Error("registry response too large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("registry response missing");
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REGISTRY_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("registry response too large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(body));
}

async function currentMember(request, db, identity) {
  const token = sessionToken(request);
  if (!token) return null;
  const sessionHash = await digest(token);
  const result = await db.prepare(
    "SELECT members.email, members.role, members.status FROM sessions JOIN members ON members.email = sessions.member_email WHERE sessions.session_hash = ? AND sessions.revoked_at IS NULL AND sessions.expires_at > ?",
  ).bind(sessionHash, Date.now()).first();
  if (!result || result.email !== identity.email || !["active", "pending"].includes(result.status)) return null;
  return result;
}

async function profile(member) {
  return {
    email: member.email,
    role: member.role,
    status: member.status,
    setupRequired: member.status === "pending" && member.role === "President",
    permissions: member.status === "active" ? ROLE_PERMISSIONS[member.role] || [] : [],
  };
}

async function createSession(request, env, identity) {
  const presidentEmail = typeof env.PRESIDENT_EMAIL === "string" ? env.PRESIDENT_EMAIL.trim().toLowerCase() : "";
  if (!presidentEmail) return json({ error: "application_unavailable" }, 503);

  let member = await env.DB.prepare("SELECT email, role, status FROM members WHERE email = ?").bind(identity.email).first();
  if (identity.email === presidentEmail) {
    if (member && member.role !== "President") {
      await audit(env.DB, identity.email, "login_denied");
      return json({ error: "authentication_required" }, 403);
    }
    if (!member) {
      const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM members").first();
      if (count?.count === 0) {
        await env.DB.prepare("INSERT OR IGNORE INTO members (email, role, status, created_at) VALUES (?, 'President', 'pending', ?)")
          .bind(presidentEmail, Date.now()).run();
        await audit(env.DB, presidentEmail, "president_bootstrap", {});
      }
      member = await env.DB.prepare("SELECT email, role, status FROM members WHERE email = ?").bind(identity.email).first();
    }
  } else if (!member || member.status !== "active" || !ROLES.includes(member.role)) {
    await audit(env.DB, identity.email, "login_denied");
    return json({ error: "authentication_required" }, 403);
  }

  if (!member || !ROLES.includes(member.role) || !["active", "pending"].includes(member.status)) {
    await audit(env.DB, identity.email, "login_denied");
    return json({ error: "authentication_required" }, 403);
  }

  const token = randomSessionToken();
  const now = Date.now();
  await env.DB.prepare("INSERT INTO sessions (session_hash, member_email, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await digest(token), member.email, now, now + SESSION_TTL_SECONDS * 1000).run();
  await audit(env.DB, member.email, "session_created", { role: member.role });
  return json(await profile(member), 200, { "set-cookie": sessionCookie(token) });
}

async function registrySummary(env, member) {
  if (!can(member, "grants:summary:read")) {
    await audit(env.DB, member.email, "authorization_denied", { permission: "grants:summary:read" });
    return json({ error: "forbidden" }, 403);
  }
  if (!env.REGISTRY_API_URL || !env.REGISTRY_API_TOKEN) {
    return json({ error: "registry_unavailable" }, 503);
  }

  let url;
  try {
    url = new URL(env.REGISTRY_API_URL);
  } catch {
    return json({ error: "registry_unavailable" }, 503);
  }
  if (url.protocol !== "https:" || url.hostname !== "api.recoveryforwardfoundation.org" || url.username || url.password || url.search || url.hash) {
    return json({ error: "registry_unavailable" }, 503);
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json", authorization: "Bearer " + env.REGISTRY_API_TOKEN },
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("registry error");
    const body = await readRegistryJson(response);
    const counts = body?.summary?.statusCounts;
    if (!counts || !["pending", "verified", "closed"].every((key) => Number.isSafeInteger(counts[key]) && counts[key] >= 0)) {
      throw new Error("unexpected registry response");
    }
    await audit(env.DB, member.email, "registry_summary_read");
    return json({ summary: { statusCounts: { pending: counts.pending, verified: counts.verified, closed: counts.closed } } });
  } catch {
    await audit(env.DB, member.email, "registry_read_failed");
    return json({ error: "registry_unavailable" }, 503);
  }
}

async function handleApi(request, env, identity, url) {
  if (url.pathname === "/api/session" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
    return createSession(request, env, identity);
  }

  if (url.pathname === "/api/session" && request.method === "DELETE") {
    if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
    const token = sessionToken(request);
    if (token) {
      await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE session_hash = ? AND member_email = ? AND revoked_at IS NULL")
        .bind(Date.now(), await digest(token), identity.email).run();
    }
    await audit(env.DB, identity.email, "session_revoked");
    return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
  }

  const member = await currentMember(request, env.DB, identity);
  if (!member) return json({ error: "authentication_required" }, 401);

  if (url.pathname === "/api/me" && request.method === "GET") return json(await profile(member));

  if (member.status === "pending"
    && !(url.pathname === "/api/bootstrap/complete" && request.method === "POST")) {
    await audit(env.DB, member.email, "authorization_denied", { status: "pending" });
    return json({ error: "forbidden" }, 403);
  }

  if (url.pathname === "/api/audit" && request.method === "GET") {
    if (!can(member, "audit:read")) {
      await audit(env.DB, member.email, "authorization_denied", { permission: "audit:read" });
      return json({ error: "forbidden" }, 403);
    }
    const { results = [] } = await env.DB.prepare(
      "SELECT actor_email, action, detail_json, created_at FROM audit_log ORDER BY id DESC LIMIT 100",
    ).all();
    return json({ entries: results.map((entry) => ({
      actorEmail: entry.actor_email,
      action: entry.action,
      detail: JSON.parse(entry.detail_json),
      createdAt: entry.created_at,
    })) });
  }

  if (url.pathname === "/api/bootstrap/complete" && request.method === "POST") {
    const presidentEmail = typeof env.PRESIDENT_EMAIL === "string" ? env.PRESIDENT_EMAIL.trim().toLowerCase() : "";
    if (!sameOrigin(request) || !presidentEmail || member.email !== presidentEmail
      || member.role !== "President" || member.status !== "pending") return json({ error: "forbidden" }, 403);
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json"
      || Number(request.headers.get("content-length") || 0) > 1024) return json({ error: "invalid_request" }, 400);
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid_request" }, 400);
    }
    if (body?.policyAck !== true) return json({ error: "acknowledgement_required" }, 400);
    await env.DB.prepare("UPDATE members SET status = 'active', policy_ack_at = ? WHERE email = ? AND role = 'President' AND status = 'pending'")
      .bind(Date.now(), member.email).run();
    await audit(env.DB, member.email, "president_bootstrap_completed");
    return json(await profile({ ...member, status: "active" }));
  }

  if (url.pathname === "/api/registry/summary" && request.method === "GET") {
    if (member.status !== "active") return json({ error: "authentication_required" }, 401);
    return registrySummary(env, member);
  }

  return json({ error: "not_found" }, 404);
}

export async function handleRequest(request, env) {
  let identity;
  try {
    identity = await verifyAccessAssertion(request.headers.get("cf-access-jwt-assertion"), env);
  } catch (error) {
    if (error instanceof AccessUnavailable) {
      logAccessDiagnostic(error);
      return secureHeaders(json({ error: "authentication_unavailable" }, 503));
    }
    return secureHeaders(json({ error: "authentication_required" }, 401));
  }
  if (!identity) return secureHeaders(json({ error: "authentication_required" }, 401));

  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    try {
      return secureHeaders(await handleApi(request, env, identity, url));
    } catch {
      return secureHeaders(json({ error: "request_failed" }, 500));
    }
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return secureHeaders(json({ error: "not_found" }, 404));
  }
  if (!env.ASSETS) return secureHeaders(json({ error: "application_unavailable" }, 503));
  try {
    return secureHeaders(await env.ASSETS.fetch(request));
  } catch {
    return secureHeaders(json({ error: "application_unavailable" }, 503));
  }
}

export default { fetch: handleRequest };
