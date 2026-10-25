import { can } from "./rbac.js";
import { auditStatement, changed, cleanText, reply, sameOrigin, sha256Bytes } from "./http.js";

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

// Each folder maps to server-checked permissions. Nothing here is ever served from a public URL.
export const FOLDERS = {
  board: { label: "Board", read: "documents:board:read", write: "documents:board:write" },
  finance: { label: "Finance", read: "finance:read", write: "documents:finance:write" },
  records: { label: "Records", read: "documents:board:read", write: "documents:records:write" },
  restricted: { label: "Restricted (President)", read: "documents:restricted:read", write: "documents:restricted:write" },
};

// Allow-list only. Active content (html, svg, js) is intentionally absent.
const TYPES = {
  pdf: { mime: "application/pdf", check: (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]) },
  png: { mime: "image/png", check: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  jpg: { mime: "image/jpeg", check: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  jpeg: { mime: "image/jpeg", check: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", check: isZip },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", check: isZip },
  txt: { mime: "text/plain", check: isText },
  csv: { mime: "text/csv", check: isText },
};

function startsWith(bytes, signature) {
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}
function isZip(bytes) { return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]); }
function isText(bytes) {
  if (bytes.includes(0)) return false;
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return true; } catch { return false; }
}

export function sanitizeFilename(value) {
  if (typeof value !== "string") return null;
  const base = value.split(/[\\/]/).pop().normalize("NFC")
    .replace(/[^\p{L}\p{N} ._()-]/gu, "_").replace(/^\.+/, "").trim().slice(-150);
  return /\.[A-Za-z0-9]{1,5}$/.test(base) ? base : null;
}

/** Validates name, declared type, size and content signature. Returns { ok, ... } or { ok: false, error }. */
export function validateFile(filename, declaredType, bytes) {
  const name = sanitizeFilename(filename);
  if (!name) return { ok: false, error: "invalid_filename" };
  const type = TYPES[name.split(".").pop().toLowerCase()];
  if (!type) return { ok: false, error: "unsupported_file_type" };
  if (bytes.length === 0) return { ok: false, error: "empty_file" };
  if (bytes.length > MAX_DOCUMENT_BYTES) return { ok: false, error: "file_too_large" };
  if (String(declaredType || "").split(";")[0].trim().toLowerCase() !== type.mime) return { ok: false, error: "content_type_mismatch" };
  if (!type.check(bytes)) return { ok: false, error: "content_mismatch" };
  return { ok: true, name, mime: type.mime };
}

async function readBounded(request, max) {
  if (Number(request.headers.get("content-length") || 0) > max) return null;
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

const canRead = (member, folder) => Boolean(FOLDERS[folder]) && can(member, FOLDERS[folder].read);
const canWrite = (member, folder) => Boolean(FOLDERS[folder]) && can(member, FOLDERS[folder].write);

async function deny(env, member, permission, extra = {}) {
  await auditStatement(env.DB, member.email, "authorization_denied", { permission, ...extra }, Date.now()).run();
  return reply({ error: "forbidden" }, 403);
}

const documentView = (row) => ({
  id: row.id, folder: row.folder, title: row.title, description: row.description, status: row.status,
  currentVersion: row.current_version, createdBy: row.created_by, createdAt: row.created_at,
  ...(row.filename ? { filename: row.filename, contentType: row.content_type, sizeBytes: row.size_bytes, sha256: row.sha256, uploadedAt: row.uploaded_at } : {}),
});

const versionView = (row) => ({
  version: row.version, filename: row.filename, contentType: row.content_type, sizeBytes: row.size_bytes,
  sha256: row.sha256, uploadedBy: row.uploaded_by, uploadedAt: row.uploaded_at,
});

function listFolders(member) {
  return reply({
    maxBytes: MAX_DOCUMENT_BYTES,
    allowedTypes: Object.keys(TYPES),
    folders: Object.entries(FOLDERS).filter(([key]) => canRead(member, key))
      .map(([key, f]) => ({ id: key, label: f.label, canWrite: canWrite(member, key) })),
  });
}

async function listDocuments(env, member, url) {
  const folder = url.searchParams.get("folder");
  if (folder && !FOLDERS[folder]) return reply({ error: "invalid_request" }, 400);
  if (folder && !canRead(member, folder)) return deny(env, member, FOLDERS[folder].read, { folder });
  const readable = Object.keys(FOLDERS).filter((key) => canRead(member, key) && (!folder || key === folder));
  if (!readable.length) return reply({ documents: [] });
  const { results = [] } = await env.DB.prepare(`SELECT d.*, v.filename, v.content_type, v.size_bytes, v.sha256, v.uploaded_at
    FROM documents d JOIN document_versions v ON v.document_id = d.id AND v.version = d.current_version
    WHERE d.current_version > 0 AND d.folder IN (${readable.map(() => "?").join(",")}) ORDER BY d.created_at DESC, d.id DESC LIMIT 200`)
    .bind(...readable).all();
  return reply({ documents: results.map(documentView) });
}

async function findDocument(env, id) {
  return Number.isSafeInteger(id) && id > 0
    ? env.DB.prepare("SELECT * FROM documents WHERE id = ? AND current_version > 0").bind(id).first() : null;
}

async function readDocument(env, member, id) {
  const doc = await findDocument(env, id);
  if (!doc) return reply({ error: "not_found" }, 404);
  if (!canRead(member, doc.folder)) {
    await deny(env, member, FOLDERS[doc.folder].read, { documentId: id });
    return reply({ error: "not_found" }, 404);
  }
  const { results = [] } = await env.DB.prepare("SELECT * FROM document_versions WHERE document_id = ? ORDER BY version DESC").bind(id).all();
  return reply({ document: documentView(doc), versions: results.map(versionView) });
}

async function download(env, member, id, url) {
  if (!env.DOCUMENTS) return reply({ error: "documents_unavailable" }, 503);
  const doc = await findDocument(env, id);
  if (!doc) return reply({ error: "not_found" }, 404);
  if (!canRead(member, doc.folder)) {
    await deny(env, member, FOLDERS[doc.folder].read, { documentId: id });
    return reply({ error: "not_found" }, 404);
  }
  const requested = url.searchParams.get("version");
  const version = requested === null ? doc.current_version : Number(requested);
  if (!Number.isSafeInteger(version) || version < 1) return reply({ error: "invalid_request" }, 400);
  const row = await env.DB.prepare("SELECT * FROM document_versions WHERE document_id = ? AND version = ?").bind(id, version).first();
  if (!row) return reply({ error: "not_found" }, 404);
  const object = await env.DOCUMENTS.get(row.object_key);
  if (!object) return reply({ error: "not_found" }, 404);
  await auditStatement(env.DB, member.email, "document_downloaded", { documentId: id, version, folder: doc.folder, sha256: row.sha256 }, Date.now()).run();
  return new Response(object.body, {
    status: 200,
    headers: {
      "content-type": row.content_type,
      "content-length": String(row.size_bytes),
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      "x-content-type-options": "nosniff",
      "x-document-sha256": row.sha256,
      "cache-control": "private, no-store",
    },
  });
}

async function upload(request, env, member, url) {
  if (!sameOrigin(request)) return reply({ error: "forbidden" }, 403);
  if (!env.DOCUMENTS) return reply({ error: "documents_unavailable" }, 503);

  const documentId = url.searchParams.has("documentId") ? Number(url.searchParams.get("documentId")) : null;
  let existing = null;
  let folder = url.searchParams.get("folder");
  if (documentId !== null) {
    existing = await findDocument(env, documentId);
    if (!existing) return reply({ error: "not_found" }, 404);
    folder = existing.folder;
    if (!canRead(member, folder)) return reply({ error: "not_found" }, 404);
  }
  if (!FOLDERS[folder]) return reply({ error: "invalid_request" }, 400);
  if (!canWrite(member, folder)) return deny(env, member, FOLDERS[folder].write, { folder });
  if (existing?.status === "archived") return reply({ error: "document_archived" }, 409);

  const title = existing ? existing.title : cleanText(url.searchParams.get("title"), 1, 200);
  const rawDescription = url.searchParams.get("description");
  const description = existing ? existing.description : rawDescription ? cleanText(rawDescription, 1, 1000) : null;
  if (!title || (rawDescription && !description)) return reply({ error: "invalid_request" }, 400);

  const bytes = await readBounded(request, MAX_DOCUMENT_BYTES);
  if (!bytes) return reply({ error: "file_too_large" }, 413);
  const checked = validateFile(url.searchParams.get("filename"), request.headers.get("content-type"), bytes);
  if (!checked.ok) return reply({ error: checked.error }, checked.error === "file_too_large" ? 413 : 400);

  const requestId = crypto.randomUUID();
  const { digest, hex: hash } = await sha256Bytes(bytes);
  const now = Date.now();

  // Idempotent retry: identical content already stored for this request is returned, never duplicated.
  const replay = existing
    ? await env.DB.prepare("SELECT d.id, d.current_version AS version, v.sha256 FROM documents d JOIN document_versions v ON v.document_id = d.id AND v.version = d.current_version WHERE d.id = ? AND v.sha256 = ?").bind(existing.id, hash).first()
    : await env.DB.prepare("SELECT d.id, d.current_version AS version, v.sha256 FROM documents d JOIN document_versions v ON v.document_id = d.id AND v.version = 1 WHERE d.folder = ? AND d.title = ? AND d.created_by = ? AND d.current_version = 1 AND d.status = 'active' AND v.sha256 = ? ORDER BY d.id DESC LIMIT 1")
      .bind(folder, title, member.email, hash).first();
  if (replay) return reply({ id: replay.id, version: replay.version, sha256: hash, duplicate: true }, 200);

  // The object is written first; no D1 row exists until the bytes are safely stored.
  const key = `${folder}/${crypto.randomUUID()}`;
  try {
    // R2 verifies the digest server-side and rejects the write on mismatch.
    const stored = await env.DOCUMENTS.put(key, bytes, { httpMetadata: { contentType: checked.mime }, sha256: digest.buffer });
    const storedHash = stored?.checksums?.sha256;
    if (!storedHash || toHex(storedHash) !== hash || (stored.size !== undefined && stored.size !== bytes.length)) {
      throw new Error("stored_object_integrity_mismatch");
    }
  } catch (error) {
    // A failed or unverifiable write may still have left an object behind; remove it.
    await discardObject(env, key, requestId);
    logFailure(error?.message === "stored_object_integrity_mismatch" ? "storage_integrity_failed" : "storage_write_failed", requestId, error);
    return reply({ error: "storage_write_failed", requestId }, 502);
  }

  const expected = existing?.current_version ?? 0;
  const version = expected + 1;
  const action = "document_uploaded"; // detail_json.version distinguishes new versions
  const versionColumns = "(document_id, version, object_key, filename, content_type, size_bytes, sha256, uploaded_by, uploaded_at)";
  let results;
  try {
    // One atomic batch: a document row and its first version commit together or not at all.
    results = existing
      ? await env.DB.batch([
        env.DB.prepare("UPDATE documents SET current_version = ? WHERE id = ? AND current_version = ? AND status = 'active'").bind(version, existing.id, expected),
        env.DB.prepare(`INSERT INTO document_versions ${versionColumns} SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0`)
          .bind(existing.id, version, key, checked.name, checked.mime, bytes.length, hash, member.email, now),
        auditStatement(env.DB, member.email, action, { documentId: existing.id, version, folder, size: bytes.length, sha256: hash }, now, true),
      ])
      : await env.DB.batch([
        env.DB.prepare("INSERT INTO documents (folder, title, description, current_version, created_by, created_at) VALUES (?, ?, ?, 1, ?, ?)")
          .bind(folder, title, description, member.email, now),
        env.DB.prepare(`INSERT INTO document_versions ${versionColumns} SELECT last_insert_rowid(), 1, ?, ?, ?, ?, ?, ?, ?`)
          .bind(key, checked.name, checked.mime, bytes.length, hash, member.email, now),
        env.DB.prepare(`INSERT INTO audit_log (actor_email, action, detail_json, created_at)
          SELECT ?, ?, json_object('documentId', document_id, 'version', 1, 'folder', ?, 'size', ?, 'sha256', ?), ? FROM document_versions WHERE object_key = ?`)
          .bind(member.email, action, folder, bytes.length, hash, now, key),
      ]);
  } catch (error) {
    await discardObject(env, key, requestId);
    logFailure("database_write_failed", requestId, error);
    return reply({ error: "database_write_failed", requestId }, 500);
  }
  if (!changed(results[1])) {
    await discardObject(env, key, requestId);
    return reply({ error: "version_conflict" }, 409);
  }
  const id = existing ? existing.id : Number((await env.DB.prepare("SELECT document_id FROM document_versions WHERE object_key = ?").bind(key).first())?.document_id);
  return reply({ id, version, sha256: hash }, 201);
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function discardObject(env, key, requestId) {
  try { await env.DOCUMENTS.delete(key); } catch (error) {
    // The object is unreferenced; its key is logged so it can be reaped without exposing contents.
    logFailure("orphan_object_cleanup_failed", requestId, error, { objectKey: key });
  }
}

function logFailure(stage, requestId, error, extra = {}) {
  console.error(JSON.stringify({ event: "document_upload_failed", stage, requestId, errorName: error?.name, errorMessage: String(error?.message ?? "").slice(0, 200), ...extra }));
}

async function archive(request, env, member, id) {
  if (!sameOrigin(request)) return reply({ error: "forbidden" }, 403);
  const doc = await findDocument(env, id);
  if (!doc || !canRead(member, doc.folder)) return reply({ error: "not_found" }, 404);
  if (!canWrite(member, doc.folder)) return deny(env, member, FOLDERS[doc.folder].write, { documentId: id });
  const now = Date.now();
  const results = await env.DB.batch([
    env.DB.prepare("UPDATE documents SET status = 'archived', archived_by = ?, archived_at = ? WHERE id = ? AND status = 'active'").bind(member.email, now, id),
    auditStatement(env.DB, member.email, "document_archived", { documentId: id, folder: doc.folder }, now, true),
  ]);
  return changed(results[0]) ? reply({ ok: true }) : reply({ error: "invalid_state" }, 409);
}

export async function documentsApi(request, env, member, url) {
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;
  if (path === "/api/documents/folders" && method === "GET") return listFolders(member);
  if (path === "/api/documents" && method === "GET") return listDocuments(env, member, url);
  if (path === "/api/documents" && method === "POST") return upload(request, env, member, url);
  const match = /^\/api\/documents\/(\d{1,12})(\/download|\/archive)?$/.exec(path);
  if (match) {
    const id = Number(match[1]);
    if (!match[2] && method === "GET") return readDocument(env, member, id);
    if (match[2] === "/download" && method === "GET") return download(env, member, id, url);
    if (match[2] === "/archive" && method === "POST") return archive(request, env, member, id);
  }
  return reply({ error: "not_found" }, 404);
}
