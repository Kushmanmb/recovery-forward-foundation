export const reply = (body, status = 200) => Response.json(body, { status });

export const changed = (result) => Number(result?.meta?.changes ?? result?.changes ?? 0) > 0;

export const insertedId = (result) => Number(result?.meta?.last_row_id ?? result?.lastInsertRowid ?? 0);

export const sameOrigin = (request) => request.headers.get("origin") === new URL(request.url).origin;

/** Reads a bounded JSON object body; throws Error("invalid_request") on any violation. */
export async function readJson(request, maxBytes = 32 * 1024) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") throw new Error("invalid_request");
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) { await reader.cancel(); throw new Error("invalid_request"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let result;
  try { result = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("invalid_request"); }
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("invalid_request");
  return result;
}

/** Audit insert; when `conditional`, it only lands if the preceding statement changed a row. */
export function auditStatement(db, actor, action, detail, now, conditional = false) {
  return db.prepare("INSERT INTO audit_log (actor_email, action, detail_json, created_at) SELECT ?, ?, ?, ?" + (conditional ? " WHERE changes() > 0" : ""))
    .bind(actor, action, JSON.stringify(detail), now);
}

export async function sha256Hex(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Digest of the exact bytes; sha256Hex above hashes text and would stringify a Uint8Array.
export async function sha256Bytes(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return { digest, hex: Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("") };
}

export function cleanText(value, min, max) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length >= min && text.length <= max ? text : null;
}
