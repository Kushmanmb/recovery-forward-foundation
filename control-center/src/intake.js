import { MAX_INTAKE_BYTES, storeSubmission, validateSubmission } from "./applications.js";

const ALLOWED_ORIGINS = new Set(["https://recoveryforwardfoundation.org", "https://www.recoveryforwardfoundation.org"]);
const MAX_REGISTRY_RESPONSE_BYTES = 1024;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 5;
const BOT_SCORE_THRESHOLD = 30;

function respond(status, origin, body = null, extra = {}) {
  const headers = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    vary: "origin",
    ...extra,
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-methods"] = "POST, OPTIONS";
    headers["access-control-allow-headers"] = "content-type";
    headers["access-control-max-age"] = "600";
  }
  if (body) headers["content-type"] = "application/json; charset=utf-8";
  return new Response(body ? JSON.stringify(body) : null, { status, headers });
}

async function intakeClientKey(ip, secret) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("rate limit secret unavailable");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function enforceRateLimit(request, env) {
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip) throw new Error("client address unavailable");
  const now = Date.now();
  const windowStart = Math.floor(now / RATE_WINDOW_MS) * RATE_WINDOW_MS;
  const clientKey = await intakeClientKey(ip, env.INTAKE_RATE_LIMIT_SECRET);
  await env.DB.prepare("DELETE FROM intake_rate_limits WHERE window_start < ?")
    .bind(windowStart).run();
  const row = await env.DB.prepare(
    `INSERT INTO intake_rate_limits (window_start, client_key, request_count)
     VALUES (?, ?, 1)
     ON CONFLICT(window_start, client_key) DO UPDATE SET request_count = request_count + 1
     RETURNING request_count`,
  ).bind(windowStart, clientKey).first();
  if (!Number.isSafeInteger(row?.request_count)) throw new Error("rate limit unavailable");
  return row.request_count <= RATE_LIMIT;
}

async function readBoundedBody(request, limit) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new RangeError("request body too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function readRegistryJson(response) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REGISTRY_RESPONSE_BYTES) {
    throw new Error("registry response too large");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("registry response missing body");
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
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

async function verifyRegistryRcgi(rcgi, env) {
  if (!env.REGISTRY_RCGI_VERIFY_URL || !env.REGISTRY_INTEGRATION_TOKEN) throw new Error("registry verification unavailable");
  let url;
  try {
    url = new URL(env.REGISTRY_RCGI_VERIFY_URL);
  } catch {
    throw new Error("registry verification unavailable");
  }
  if (url.protocol !== "https:" || url.hostname !== "api.recoveryforwardfoundation.org"
    || url.username || url.password || url.search || url.hash) {
    throw new Error("registry verification unavailable");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${encodeURIComponent(rcgi)}/exists`;
  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json", authorization: "Bearer " + env.REGISTRY_INTEGRATION_TOKEN },
    redirect: "manual",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("registry verification failed");
  const body = await readRegistryJson(response);
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.exists !== "boolean") {
    throw new Error("registry response invalid");
  }
  return body.exists === true;
}

export async function handleIntake(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const corsOrigin = ALLOWED_ORIGINS.has(origin) ? origin : null;
  if (url.pathname !== "/applications") return respond(404, corsOrigin, { error: "not_found" });
  if (request.method === "OPTIONS") {
    return corsOrigin ? respond(204, corsOrigin) : respond(403, null, { error: "forbidden" });
  }
  if (request.method !== "POST") return respond(405, corsOrigin, { error: "method_not_allowed" }, { allow: "POST, OPTIONS" });

  let submission;
  try {
    if (!(await enforceRateLimit(request, env))) {
      return respond(429, corsOrigin, { error: "try_later" }, { "retry-after": "600" });
    }
  } catch {
    console.error("application intake rate limit unavailable");
    return respond(503, corsOrigin, { error: "unavailable" });
  }

  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return respond(415, corsOrigin, { error: "invalid_request" });
  }
  if (Number(request.headers.get("content-length") || 0) > MAX_INTAKE_BYTES) {
    return respond(413, corsOrigin, { error: "invalid_request" });
  }
  try {
    submission = validateSubmission(JSON.parse(await readBoundedBody(request, MAX_INTAKE_BYTES)));
  } catch (error) {
    if (error instanceof RangeError) return respond(413, corsOrigin, { error: "invalid_request" });
    submission = null;
  }
  if (!submission) return respond(400, corsOrigin, { error: "invalid_request" });

  const botScore = request.cf?.botManagement?.score;
  if (Number.isSafeInteger(botScore) && botScore < BOT_SCORE_THRESHOLD) {
    return respond(202, corsOrigin, { received: true });
  }

  let rcgiExists;
  try {
    rcgiExists = await verifyRegistryRcgi(submission.rcgi, env);
  } catch {
    console.error("application intake Registry verification unavailable");
    return respond(503, corsOrigin, { error: "unavailable" });
  }
  if (!rcgiExists) return respond(202, corsOrigin, { received: true });

  try {
    await storeSubmission(env.DB, submission);
  } catch {
    console.error("application intake storage failed");
    return respond(503, corsOrigin, { error: "unavailable" });
  }
  return respond(202, corsOrigin, { received: true });
}

export default { fetch: handleIntake };
