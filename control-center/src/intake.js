import { MAX_INTAKE_BYTES, storeSubmission, validateSubmission } from "./applications.js";

// Public, write-only intake. It has no read path, no cookies and no Access identity;
// applications are readable only through the Access-protected Control Center Worker.
const ALLOWED_ORIGINS = new Set(["https://recoveryforwardfoundation.org", "https://www.recoveryforwardfoundation.org"]);

function respond(status, origin, body = null, extra = {}) {
  const headers = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    vary: "origin",
    ...extra,
  };
  if (origin) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-methods"] = "POST, OPTIONS";
    headers["access-control-allow-headers"] = "content-type";
    headers["access-control-max-age"] = "600";
  }
  if (body) headers["content-type"] = "application/json; charset=utf-8";
  return new Response(body ? JSON.stringify(body) : null, { status, headers });
}

export async function handleIntake(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (url.pathname !== "/applications") return respond(404, null, { error: "not_found" });
  if (!ALLOWED_ORIGINS.has(origin)) return respond(403, null, { error: "forbidden" });
  if (request.method === "OPTIONS") return respond(204, origin);
  if (request.method !== "POST") return respond(405, origin, { error: "method_not_allowed" }, { allow: "POST, OPTIONS" });
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return respond(415, origin, { error: "invalid_request" });
  }
  if (Number(request.headers.get("content-length") || 0) > MAX_INTAKE_BYTES) {
    return respond(413, origin, { error: "invalid_request" });
  }

  let submission = null;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_INTAKE_BYTES) return respond(413, origin, { error: "invalid_request" });
    submission = validateSubmission(JSON.parse(text));
  } catch {
    submission = null;
  }
  if (!submission) return respond(400, origin, { error: "invalid_request" });

  try {
    await storeSubmission(env.DB, submission);
  } catch {
    // Fixed message only: never log submission content.
    console.error("application intake storage failed");
    return respond(503, origin, { error: "unavailable" });
  }
  // Identical response for new and duplicate RCGIs.
  return respond(202, origin, { received: true });
}

export default { fetch: handleIntake };
