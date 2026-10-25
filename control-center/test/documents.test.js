import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { handleRequest } from "../src/worker.js";
import { sanitizeFilename, validateFile } from "../src/documents-api.js";
import { validateStagingConfig } from "../scripts/check-staging-config.mjs";

let counter = 0;
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const migrations = ["0001_initial.sql", "0003_board_access.sql", "0010_governance_core.sql", "0011_governance_rules_lock.sql", "0020_documents.sql", "0021_documents_require_version.sql"];

async function identity(email) {
  const domain = `docs-${++counter}.cloudflareaccess.com`;
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
  for (const file of migrations) database.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
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

function fakeBucket() {
  const objects = new Map();
  return {
    objects,
    async put(key, value, options) {
      const bytes = new Uint8Array(value);
      const actual = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      if (options?.sha256 !== undefined) {
        const expected = typeof options.sha256 === "string" ? options.sha256 : Buffer.from(options.sha256).toString("hex");
        if (expected !== Buffer.from(actual).toString("hex")) throw new Error("The SHA-256 checksum you specified did not match what we received.");
      }
      objects.set(key, { bytes, options });
      return { size: bytes.length, checksums: { sha256: actual.buffer } };
    },
    async get(key) { const o = objects.get(key); return o ? { body: new Blob([o.bytes]).stream() } : null; },
    async delete(key) { objects.delete(key); },
  };
}

async function call(who, env, path, { method = "GET", cookie, body, type, origin = "https://admin.example.org" } = {}) {
  const headers = { "cf-access-jwt-assertion": who.token };
  if (cookie) headers.cookie = cookie;
  if (method !== "GET" && origin) headers.origin = origin;
  if (type) headers["content-type"] = type;
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ keys: [who.jwk] });
  try {
    return await handleRequest(new Request(`https://admin.example.org${path}`, { method, headers, ...(body !== undefined ? { body } : {}) }),
      { ...env, ACCESS_TEAM_DOMAIN: who.domain, ACCESS_AUD: "aud", PRESIDENT_EMAIL: "president@example.org" });
  } finally { globalThis.fetch = original; }
}

async function setup() {
  const DB = createDb();
  const DOCUMENTS = fakeBucket();
  const env = { DB, DOCUMENTS };
  const people = {};
  for (const [name, email, role] of [["president", "president@example.org", "President"], ["secretary", "sec@example.org", "Secretary"],
    ["treasurer", "treasurer@example.org", "Treasurer"], ["board", "board@example.org", "BoardMember"]]) {
    DB.database.prepare("INSERT INTO members (email, role, status, created_at) VALUES (?, ?, 'active', ?)").run(email, role, Date.now());
    const who = await identity(email);
    const response = await call(who, env, "/api/session", { method: "POST" });
    assert.equal(response.status, 200);
    people[name] = { who, cookie: response.headers.get("set-cookie").split(";")[0] };
  }
  return { DB, DOCUMENTS, env, people };
}

const PDF = new TextEncoder().encode("%PDF-1.4 synthetic test document");
const upload = (p, env, query, bytes = PDF, type = "application/pdf") => call(p.who, env, `/api/documents?${query}`, { method: "POST", cookie: p.cookie, body: bytes, type });
const auditActions = (DB) => DB.database.prepare("SELECT action FROM audit_log").all().map((r) => r.action);

test("file validation enforces name, type, size and content signature", () => {
  assert.equal(validateFile("a.pdf", "application/pdf", PDF).ok, true);
  assert.equal(validateFile("a.pdf", "application/pdf; charset=x", PDF).ok, true);
  assert.equal(validateFile("a.exe", "application/octet-stream", PDF).error, "unsupported_file_type");
  assert.equal(validateFile("a.html", "text/html", new TextEncoder().encode("<script>")).error, "unsupported_file_type");
  assert.equal(validateFile("a.svg", "image/svg+xml", new Uint8Array([1])).error, "unsupported_file_type");
  assert.equal(validateFile("a.pdf", "text/plain", PDF).error, "content_type_mismatch");
  assert.equal(validateFile("a.pdf", "application/pdf", new TextEncoder().encode("<html>")).error, "content_mismatch");
  assert.equal(validateFile("a.png", "image/png", PDF).error, "content_mismatch");
  assert.equal(validateFile("a.txt", "text/plain", new Uint8Array([65, 0, 66])).error, "content_mismatch");
  assert.equal(validateFile("a.pdf", "application/pdf", new Uint8Array(0)).error, "empty_file");
  assert.equal(validateFile("a.pdf", "application/pdf", new Uint8Array(10 * 1024 * 1024 + 1)).error, "content_mismatch".replace("content_mismatch", "file_too_large"));
  assert.equal(validateFile("noext", "application/pdf", PDF).error, "invalid_filename");
  assert.equal(sanitizeFilename("../../etc/pa<ss>wd.pdf"), "pa_ss_wd.pdf");
});

test("authorized upload stores bytes privately, records metadata and audits", async () => {
  const { DB, DOCUMENTS, env, people } = await setup();
  const response = await upload(people.president, env, "folder=board&title=Bylaws&filename=bylaws.pdf&description=Current");
  assert.equal(response.status, 201);
  const { id, version, sha256 } = await response.json();
  assert.equal(version, 1);
  assert.equal(DOCUMENTS.objects.size, 1);
  const [key, stored] = [...DOCUMENTS.objects.entries()][0];
  assert.doesNotMatch(key, /bylaws/i, "object keys never embed user-supplied names");
  assert.equal(Buffer.from(stored.options.sha256).toString("hex"), sha256);
  assert.equal(sha256, createHash("sha256").update(PDF).digest("hex"), "digest covers the exact uploaded bytes");
  assert.ok(auditActions(DB).includes("document_uploaded"));

  const list = await (await call(people.board.who, env, "/api/documents", { cookie: people.board.cookie })).json();
  assert.equal(list.documents.length, 1);
  assert.equal(list.documents[0].title, "Bylaws");
  assert.equal(JSON.stringify(list).includes(key), false, "object keys are never returned to clients");

  const download = await call(people.board.who, env, `/api/documents/${id}/download`, { cookie: people.board.cookie });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-type"), "application/pdf");
  assert.match(download.headers.get("content-disposition"), /^attachment/);
  assert.equal(download.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), PDF);
  assert.ok(auditActions(DB).includes("document_downloaded"));
});

test("new versions keep history and any version stays downloadable", async () => {
  const { env, people } = await setup();
  const first = await (await upload(people.secretary, env, "folder=records&title=Minutes&filename=m.txt", new TextEncoder().encode("one"), "text/plain")).json();
  const second = await upload(people.secretary, env, `documentId=${first.id}&filename=m2.txt`, new TextEncoder().encode("two"), "text/plain");
  assert.equal(second.status, 201);
  assert.equal((await second.json()).version, 2);
  const detail = await (await call(people.board.who, env, `/api/documents/${first.id}`, { cookie: people.board.cookie })).json();
  assert.deepEqual(detail.versions.map((v) => v.version), [2, 1]);
  assert.equal(detail.document.currentVersion, 2);
  const old = await call(people.board.who, env, `/api/documents/${first.id}/download?version=1`, { cookie: people.board.cookie });
  assert.equal(await old.text(), "one");
  assert.equal((await call(people.board.who, env, `/api/documents/${first.id}/download?version=9`, { cookie: people.board.cookie })).status, 404);
});

test("version rows are immutable and documents cannot be deleted", async () => {
  const { DB, env, people } = await setup();
  await upload(people.president, env, "folder=board&title=T&filename=a.pdf");
  assert.throws(() => DB.database.prepare("UPDATE document_versions SET sha256 = ?").run("0".repeat(64)), /immutable/);
  assert.throws(() => DB.database.prepare("DELETE FROM document_versions").run(), /immutable/);
  assert.throws(() => DB.database.prepare("DELETE FROM documents").run(), /cannot be deleted/);
});

test("permissions are enforced server-side per folder", async () => {
  const { DB, DOCUMENTS, env, people } = await setup();
  // Board members cannot write anywhere; the Treasurer can write finance only.
  assert.equal((await upload(people.board, env, "folder=board&title=T&filename=a.pdf")).status, 403);
  assert.equal((await upload(people.treasurer, env, "folder=board&title=T&filename=a.pdf")).status, 403);
  assert.equal((await upload(people.secretary, env, "folder=finance&title=T&filename=a.pdf")).status, 403);
  assert.equal(DOCUMENTS.objects.size, 0, "denied uploads never touch storage");
  assert.ok(auditActions(DB).includes("authorization_denied"));
  assert.equal((await upload(people.treasurer, env, "folder=finance&title=Budget&filename=b.pdf")).status, 201);
  const restricted = await (await upload(people.president, env, "folder=restricted&title=Private&filename=p.pdf")).json();

  const asBoard = await call(people.board.who, env, "/api/documents/folders", { cookie: people.board.cookie });
  const folders = (await asBoard.json()).folders.map((f) => f.id);
  assert.ok(!folders.includes("restricted"));
  assert.equal((await call(people.board.who, env, "/api/documents?folder=restricted", { cookie: people.board.cookie })).status, 403);
  assert.equal((await call(people.secretary.who, env, `/api/documents/${restricted.id}`, { cookie: people.secretary.cookie })).status, 404);
  assert.equal((await call(people.secretary.who, env, `/api/documents/${restricted.id}/download`, { cookie: people.secretary.cookie })).status, 404);
  const all = await (await call(people.secretary.who, env, "/api/documents", { cookie: people.secretary.cookie })).json();
  assert.ok(all.documents.every((d) => d.folder !== "restricted"));
  assert.equal((await call(people.secretary.who, env, `/api/documents/${restricted.id}/archive`, { method: "POST", cookie: people.secretary.cookie })).status, 404);
});

test("unauthenticated, cross-origin and malformed requests are rejected", async () => {
  const { DOCUMENTS, env, people } = await setup();
  const p = people.president;
  assert.equal((await call(p.who, env, "/api/documents")).status, 401, "no server session");
  const bad = await call({ token: "x", domain: p.who.domain, jwk: p.who.jwk }, env, "/api/documents", { cookie: p.cookie });
  assert.equal(bad.status, 401, "no Access identity");
  assert.equal((await call(p.who, env, "/api/documents?folder=board&title=T&filename=a.pdf", { method: "POST", cookie: p.cookie, body: PDF, type: "application/pdf", origin: "https://evil.example" })).status, 403);
  assert.equal((await call(p.who, env, "/api/documents?folder=board&title=T&filename=a.pdf", { method: "POST", cookie: p.cookie, body: PDF, type: "application/pdf", origin: null })).status, 403);
  assert.equal((await upload(p, env, "folder=nope&title=T&filename=a.pdf")).status, 400);
  assert.equal((await upload(p, env, "folder=board&filename=a.pdf")).status, 400);
  assert.equal((await upload(p, env, "folder=board&title=T&filename=a.exe", PDF, "application/octet-stream")).status, 400);
  assert.equal((await upload(p, env, "folder=board&title=T&filename=a.pdf", new TextEncoder().encode("<html>"), "application/pdf")).status, 400);
  assert.equal((await upload(p, env, "folder=board&title=T&filename=a.pdf", new Uint8Array(10 * 1024 * 1024 + 1))).status, 413);
  assert.equal((await call(p.who, env, "/api/documents/abc", { cookie: p.cookie })).status, 404);
  assert.equal(DOCUMENTS.objects.size, 0);
});

test("missing R2 binding fails closed", async () => {
  const { env, people } = await setup();
  const noStorage = { DB: env.DB };
  assert.equal((await upload(people.president, noStorage, "folder=board&title=T&filename=a.pdf")).status, 503);
  const documents = await (await call(people.president.who, env, "/api/governance/dashboard", { cookie: people.president.cookie })).json();
  assert.equal(documents.integrations.find((i) => i.id === "documents").operational, true);
  const without = await (await call(people.president.who, noStorage, "/api/governance/dashboard", { cookie: people.president.cookie })).json();
  assert.equal(without.integrations.find((i) => i.id === "documents").operational, false);
});

test("a failed metadata commit removes the stored object and reports conflicts", async () => {
  const { DB, DOCUMENTS, env, people } = await setup();
  const first = await (await upload(people.president, env, "folder=board&title=T&filename=a.pdf")).json();
  const realBatch = DB.batch;
  DB.batch = async (statements) => { DB.database.prepare("UPDATE documents SET current_version = 5 WHERE id = ?").run(first.id); return realBatch.call(DB, statements); };
  const response = await upload(people.president, env, `documentId=${first.id}&filename=b.pdf`, new TextEncoder().encode("%PDF-1.4 changed"));
  DB.batch = realBatch;
  assert.equal(response.status, 409);
  assert.equal(DOCUMENTS.objects.size, 1, "orphaned object removed");
});

test("archived documents accept no new versions and archiving is audited", async () => {
  const { DB, env, people } = await setup();
  const doc = await (await upload(people.president, env, "folder=board&title=T&filename=a.pdf")).json();
  assert.equal((await call(people.board.who, env, `/api/documents/${doc.id}/archive`, { method: "POST", cookie: people.board.cookie })).status, 403);
  assert.equal((await call(people.president.who, env, `/api/documents/${doc.id}/archive`, { method: "POST", cookie: people.president.cookie })).status, 200);
  assert.ok(auditActions(DB).includes("document_archived"));
  assert.equal((await upload(people.president, env, `documentId=${doc.id}&filename=b.pdf`)).status, 409);
  assert.equal((await call(people.board.who, env, `/api/documents/${doc.id}/download`, { cookie: people.board.cookie })).status, 200);
});

test("the staging config binds only a private staging bucket", () => {
  const staging = readFileSync(new URL("../wrangler.staging.toml", import.meta.url), "utf8");
  const production = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.deepEqual(validateStagingConfig(staging, production), []);
  assert.match(staging, /binding = "DOCUMENTS"/);
  assert.match(validateStagingConfig(staging.replace("documents-staging", "documents"), production).join(), /bucket_name must contain 'staging'/);
  assert.match(validateStagingConfig(staging + '\npublic_access = true\n', production).join(), /public/);
});

const counts = (DB) => ({
  documents: DB.database.prepare("SELECT COUNT(*) n FROM documents").get().n,
  versions: DB.database.prepare("SELECT COUNT(*) n FROM document_versions").get().n,
});
async function quietly(fn) {
  const original = console.error; const logs = [];
  console.error = (line) => logs.push(String(line));
  try { return { result: await fn(), logs }; } finally { console.error = original; }
}

test("upload then download round-trips bytes, with version 1 and audit entries", async () => {
  const { DB, DOCUMENTS, env, people } = await setup();
  const response = await upload(people.president, env, "folder=board&title=Minutes&filename=minutes.pdf");
  assert.equal(response.status, 201);
  const { id, version } = await response.json();
  assert.equal(version, 1);
  assert.equal(DB.database.prepare("SELECT current_version FROM documents WHERE id = ?").get(id).current_version, 1);
  assert.equal(DOCUMENTS.objects.size, 1);
  const download = await call(people.president.who, env, `/api/documents/${id}/download`, { cookie: people.president.cookie });
  assert.equal(download.status, 200);
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), PDF);
  assert.deepEqual(auditActions(DB).filter((a) => a.startsWith("document_")), ["document_uploaded", "document_downloaded"]);
  const detail = JSON.parse(DB.database.prepare("SELECT detail_json FROM audit_log WHERE action = 'document_uploaded'").get().detail_json);
  assert.equal(detail.documentId, id);
});

test("failed R2 upload leaves no document, version or object and reports a safe error", async () => {
  const { DB, DOCUMENTS, env, people } = await setup();
  DOCUMENTS.put = async () => { throw new Error("R2 exploded secret-token-123"); };
  const { result: response, logs } = await quietly(() => upload(people.president, env, "folder=board&title=Minutes&filename=minutes.pdf"));
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error, "storage_write_failed");
  assert.match(body.requestId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(counts(DB), { documents: 0, versions: 0 });
  assert.equal(DOCUMENTS.objects.size, 0);
  assert.ok(logs.some((line) => line.includes("storage_write_failed") && line.includes(body.requestId)));
  assert.ok(!JSON.stringify(body).includes("secret-token"));
  assert.ok(!logs.join().includes("PDF-1.4"));
});

test("failed D1 version insert rolls back atomically and removes the R2 object", async () => {
  const { DB, DOCUMENTS, env, people } = await setup();
  DB.database.exec("CREATE TRIGGER fail_version BEFORE INSERT ON document_versions BEGIN SELECT RAISE(ABORT, 'boom'); END;");
  const { result: response } = await quietly(() => upload(people.president, env, "folder=board&title=Minutes&filename=minutes.pdf"));
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, "database_write_failed");
  assert.deepEqual(counts(DB), { documents: 0, versions: 0 });
  assert.equal(DOCUMENTS.objects.size, 0);
  assert.equal(DB.database.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'document_uploaded'").get().n, 0);
  assert.equal(DB.database.prepare("SELECT COUNT(*) n FROM documents WHERE current_version = 0").get().n, 0);
});

test("failed cleanup of an unreferenced object is logged by key, not hidden", async () => {
  const { DB, DOCUMENTS, env, people } = await setup();
  DB.database.exec("CREATE TRIGGER fail_version BEFORE INSERT ON document_versions BEGIN SELECT RAISE(ABORT, 'boom'); END;");
  DOCUMENTS.delete = async () => { throw new Error("delete failed"); };
  const { result: response, logs } = await quietly(() => upload(people.president, env, "folder=board&title=Minutes&filename=minutes.pdf"));
  assert.equal(response.status, 500);
  assert.ok(logs.some((line) => line.includes("orphan_object_cleanup_failed") && line.includes([...DOCUMENTS.objects.keys()][0])));
});

test("a failed new-version upload leaves the current version intact", async () => {
  const { DB, DOCUMENTS, env, people } = await setup();
  const { id } = await (await upload(people.president, env, "folder=board&title=Minutes&filename=minutes.pdf")).json();
  DB.database.exec("CREATE TRIGGER fail_version BEFORE INSERT ON document_versions BEGIN SELECT RAISE(ABORT, 'boom'); END;");
  const next = new TextEncoder().encode("%PDF-1.4 second");
  const { result: response } = await quietly(() => upload(people.president, env, `documentId=${id}&filename=minutes.pdf`, next));
  assert.equal(response.status, 500);
  assert.equal(DB.database.prepare("SELECT current_version FROM documents WHERE id = ?").get(id).current_version, 1);
  assert.equal(DOCUMENTS.objects.size, 1);
});

test("duplicate retries are idempotent and do not create documents, versions or objects", async () => {
  const { DB, DOCUMENTS, env, people } = await setup();
  const first = await (await upload(people.president, env, "folder=board&title=Minutes&filename=minutes.pdf")).json();
  const retry = await upload(people.president, env, "folder=board&title=Minutes&filename=minutes.pdf");
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), { id: first.id, version: 1, sha256: first.sha256, duplicate: true });
  const versionRetry = await upload(people.president, env, `documentId=${first.id}&filename=minutes.pdf`);
  assert.equal((await versionRetry.json()).duplicate, true);
  assert.deepEqual(counts(DB), { documents: 1, versions: 1 });
  assert.equal(DOCUMENTS.objects.size, 1);
});

test("retry after a failed upload succeeds cleanly", async () => {
  const { DB, DOCUMENTS, env, people } = await setup();
  const put = DOCUMENTS.put;
  DOCUMENTS.put = async () => { throw new Error("transient"); };
  await quietly(() => upload(people.president, env, "folder=board&title=Minutes&filename=minutes.pdf"));
  DOCUMENTS.put = put;
  assert.equal((await upload(people.president, env, "folder=board&title=Minutes&filename=minutes.pdf")).status, 201);
  assert.deepEqual(counts(DB), { documents: 1, versions: 1 });
});

test("schema refuses new document rows without a version and keeps history immutable", async () => {
  const { DB, env, people } = await setup();
  assert.throws(() => DB.database.prepare("INSERT INTO documents (folder, title, current_version, created_by, created_at) VALUES ('board', 't', 0, 'x', 1)").run(), /must be created with a version/);
  const { id } = await (await upload(people.president, env, "folder=board&title=Minutes&filename=minutes.pdf")).json();
  assert.throws(() => DB.database.prepare("UPDATE document_versions SET filename = 'x' WHERE document_id = ?").run(id), /immutable/);
  assert.throws(() => DB.database.prepare("DELETE FROM audit_log").run(), /append-only/);
});

test("unauthorized and invalid uploads are still rejected before any write", async () => {
  const { DB, DOCUMENTS, env, people } = await setup();
  assert.equal((await upload(people.board, env, "folder=restricted&title=X&filename=x.pdf")).status, 403);
  assert.equal((await upload(people.president, env, "folder=board&title=X&filename=x.pdf", new TextEncoder().encode("nope"))).status, 400);
  assert.deepEqual(counts(DB), { documents: 0, versions: 0 });
  assert.equal(DOCUMENTS.objects.size, 0);
});

test("R2 checksum mismatch fails safely: no rows, no object, no leaked detail", async () => {
  const { DB, DOCUMENTS, env, people } = await setup();
  const put = DOCUMENTS.put;
  DOCUMENTS.put = (key, value, options) => put(key, value, { ...options, sha256: new Uint8Array(32).buffer });
  const { result: response } = await quietly(() => upload(people.president, env, "folder=board&title=Minutes&filename=minutes.pdf"));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, "storage_write_failed");
  assert.deepEqual(counts(DB), { documents: 0, versions: 0 });
  assert.equal(DOCUMENTS.objects.size, 0);
});

test("a stored object whose checksum differs from the computed digest is rejected and removed", async () => {
  const { DB, DOCUMENTS, env, people } = await setup();
  const put = DOCUMENTS.put;
  DOCUMENTS.put = async (...args) => ({ ...(await put(...args)), checksums: { sha256: new Uint8Array(32).buffer } });
  const { result: response } = await quietly(() => upload(people.president, env, "folder=board&title=Minutes&filename=minutes.pdf"));
  assert.equal(response.status, 502);
  assert.deepEqual(counts(DB), { documents: 0, versions: 0 });
  assert.equal(DOCUMENTS.objects.size, 0);
});

test("a legacy-shaped document 5 receives version 2 atomically with a document_uploaded audit event", async () => {
  const { DB, DOCUMENTS, env, people } = await setup();
  const first = await (await upload(people.president, env, "folder=board&title=Bylaws&filename=a.pdf")).json();
  const before = DB.database.prepare("SELECT * FROM document_versions WHERE document_id = ?").all(first.id);
  const next = new TextEncoder().encode("%PDF-1.4 revised");
  const response = await upload(people.president, env, `documentId=${first.id}&filename=b.pdf`, next);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: first.id, version: 2, sha256: createHash("sha256").update(next).digest("hex") });
  assert.equal(DB.database.prepare("SELECT current_version FROM documents WHERE id = ?").get(first.id).current_version, 2);
  assert.deepEqual(DB.database.prepare("SELECT * FROM document_versions WHERE document_id = ? AND version = 1").all(first.id), before, "version 1 is untouched");
  assert.equal(DB.database.prepare("SELECT COUNT(*) n FROM documents").get().n, 1, "same document ID, no new document");
  const audits = DB.database.prepare("SELECT detail_json FROM audit_log WHERE action = 'document_uploaded' ORDER BY id").all().map((r) => JSON.parse(r.detail_json));
  assert.deepEqual(audits.map((a) => a.version), [1, 2]);
  assert.equal(audits[1].documentId, first.id);
  assert.equal(DOCUMENTS.objects.size, 2);
});

test("re-uploading identical content is an explicit duplicate, not a new version or audit event", async () => {
  const { DB, env, people } = await setup();
  const first = await (await upload(people.president, env, "folder=board&title=Bylaws&filename=a.pdf")).json();
  const audits = DB.database.prepare("SELECT COUNT(*) n FROM audit_log").get().n;
  const again = await upload(people.president, env, `documentId=${first.id}&filename=a.pdf`);
  assert.equal(again.status, 200);
  const body = await again.json();
  assert.equal(body.duplicate, true);
  assert.equal(body.version, 1);
  assert.equal(DB.database.prepare("SELECT current_version FROM documents WHERE id = ?").get(first.id).current_version, 1);
  assert.equal(DB.database.prepare("SELECT COUNT(*) n FROM audit_log").get().n, audits);
});

test("unauthorized version uploads are denied before storage or database writes", async () => {
  const { DB, DOCUMENTS, env, people } = await setup();
  const first = await (await upload(people.president, env, "folder=board&title=Bylaws&filename=a.pdf")).json();
  const next = new TextEncoder().encode("%PDF-1.4 other");
  assert.equal((await upload(people.board, env, `documentId=${first.id}&filename=b.pdf`, next)).status, 403);
  const denied = await upload(people.treasurer, env, `documentId=${first.id}&filename=b.pdf`, next);
  assert.equal(denied.status, 403);
  assert.equal(DOCUMENTS.objects.size, 1);
  assert.equal(DB.database.prepare("SELECT current_version FROM documents WHERE id = ?").get(first.id).current_version, 1);
});
