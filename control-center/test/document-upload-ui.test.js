import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../admin-prototype/app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../../admin-prototype/style.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../../admin-prototype/index.html", import.meta.url), "utf8");
const sections = [...html.matchAll(/data-s="([a-z]+)"/g)].map((m) => m[1]);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const store = { maxBytes: 10485760, allowedTypes: ["pdf"], folders: [{ id: "board", label: "Board", canWrite: true }] };
const version = (n) => ({ version: n, filename: `v${n}.pdf`, sizeBytes: 10, sha256: "a".repeat(64), uploadedBy: "p@example.org", uploadedAt: 1 });

async function boot({ upload, versions = [1], rows }) {
  const handlers = {};
  const state = { versions: [...versions], message: "", messages: [], uploads: 0 };
  const main = {
    set innerHTML(value) { this._html = value; state.message = ""; },
    get innerHTML() { return this._html || ""; },
    addEventListener(type, handler) { handlers[`main:${type}`] = handler; },
  };
  const message = { set textContent(v) { state.message = v; state.messages.push(v); }, get textContent() { return state.message; } };
  const buttons = sections.map((s) => ({ getAttribute: (n) => (n === "data-s" ? s : null), classList: { toggle() {} }, hidden: false }));
  const fetch = async (path, options = {}) => {
    const key = path.split("?")[0];
    const ok = (body) => ({ ok: true, json: async () => body });
    if (key === "/api/me") return ok({ email: "p@example.org", role: "President", status: "active", permissions: [] });
    if (key === "/api/registry/summary") return ok({ summary: { statusCounts: { pending: 0, verified: 0, closed: 0 } } });
    if (key === "/api/governance/resolutions") return ok({ resolutions: [] });
    if (key === "/api/documents/folders") return ok(store);
    if (key === "/api/documents/5") return ok({ document: { id: 5, folder: "board", title: "Bylaws", status: "active", currentVersion: Math.max(...state.versions) }, versions: rows || state.versions.map(version).reverse() });
    if (key === "/api/documents" && options.method === "POST") { state.uploads++; return upload(state, path, options); }
    if (key === "/api/documents") return ok({ documents: [] });
    return { ok: false, json: async () => ({ error: "not_found" }) };
  };
  vm.runInNewContext(source, {
    document: { getElementById: (id) => ({ main, nav: { addEventListener(type, handler) { handlers[`nav:${type}`] = handler; }, querySelectorAll: () => buttons }, logout: { hidden: true, addEventListener() {} }, "gov-message": message })[id] ?? null, createElement() { let t = ""; return { set textContent(v) { t = v; }, get innerHTML() { return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); } }; } },
    fetch, window: { location: { assign() {} }, confirm: () => true }, FormData: class { constructor(form) { this.file = form.file; } get(name) { return name === "file" ? this.file : null; } },
    Number, Array, JSON, Date, encodeURIComponent,
  });
  await tick(); await tick();
  handlers["nav:click"]({ target: buttons[sections.indexOf("documents")] }); await tick(); await tick(); await tick();
  handlers["main:click"]({ target: { getAttribute: (n) => (n === "data-open-doc" ? "5" : null) } }); await tick(); await tick(); await tick(); await tick();
  const submit = async (file) => {
    const button = { disabled: false };
    await handlers["main:submit"]({ target: { id: "doc-upload", file, getAttribute: (n) => ({ "data-document": "5", "data-current-version": String(Math.max(...state.versions)) })[n] ?? null, querySelector: () => button }, preventDefault() {} });
  };
  return { main, state, submit };
}

const pdf = (name = "v2.pdf", size = 20) => ({ name, size, type: "application/pdf" });
const json = (status, body) => ({ ok: status < 300, json: async () => body });

test("committed new version shows success only after the server state refreshes", async () => {
  const app = await boot({ upload: async (state) => { state.versions.push(2); return json(201, { id: 5, version: 2, sha256: "b" }); } });
  assert.match(app.main.innerHTML, /Add a new version/);
  await app.submit(pdf());
  assert.equal(app.state.message, "Version 2 uploaded.");
  assert.match(app.main.innerHTML, /<h4>Version 2 <span class='tag ok'>Current<\/span><\/h4>/);
  assert.match(app.main.innerHTML, /data-current-version='2'/);
  assert.ok(app.state.messages.some((m) => /^Uploading/.test(m)), "progress is shown");
  assert.equal(app.state.messages.indexOf("Version 2 uploaded."), app.state.messages.length - 1);
});

test("stale success is cleared before each attempt and an identical file is not reported as uploaded", async () => {
  const app = await boot({ upload: async (state) => { state.versions.push(2); return json(201, { id: 5, version: 2 }); } });
  await app.submit(pdf());
  assert.equal(app.state.message, "Version 2 uploaded.");
  app.state.messages.length = 0;
  app.state.message = "Version 2 uploaded.";
  await app.submit(null);
  assert.equal(app.state.messages[0], "", "old message cleared first");
  assert.match(app.state.message, /Choose a non-empty file/);

  const dup = await boot({ upload: async () => json(200, { id: 5, version: 1, sha256: "a", duplicate: true }) });
  await dup.submit(pdf());
  assert.match(dup.state.message, /No new version was created/);
  assert.doesNotMatch(dup.state.message, /uploaded\./);
});

test("missing or empty files never reach the API", async () => {
  const app = await boot({ upload: async () => json(500, {}) });
  await app.submit(null);
  await app.submit(pdf("empty.pdf", 0));
  assert.equal(app.state.uploads, 0);
  assert.match(app.state.message, /Choose a non-empty file/);
});

for (const [name, status, body, expected] of [
  ["authorization failure", 403, { error: "forbidden" }, null],
  ["R2 failure", 502, { error: "storage_write_failed", requestId: "req-1" }, /Nothing was saved.*Reference: req-1/],
  ["D1 rollback", 500, { error: "database_write_failed", requestId: "req-2" }, /Reference: req-2/],
  ["version conflict", 409, { error: "version_conflict" }, /Someone else added a version/],
]) {
  test(`${name} shows an error, never success, and leaves history unchanged`, async () => {
    const app = await boot({ upload: async () => json(status, body) });
    await app.submit(pdf());
    assert.doesNotMatch(app.state.message, /uploaded|Uploaded/i);
    assert.ok(app.state.message.length > 0);
    if (expected) assert.match(app.state.message, expected);
    assert.doesNotMatch(app.main.innerHTML, /<h4>Version 2/);
  });
}

test("a success response the server state does not confirm is not reported as success", async () => {
  const app = await boot({ upload: async () => json(201, { id: 5, version: 2 }) });
  await app.submit(pdf());
  assert.match(app.state.message, /did not confirm/);
});

test("version history renders labelled stacked cards with every field and an accessible Download", async () => {
  const app = await boot({ upload: async () => json(500, {}), versions: [1, 2] });
  const out = app.main.innerHTML;
  assert.doesNotMatch(out, /<table|<td|<th/, "no cramped table for version history");
  assert.equal((out.match(/<li class='version-card'>/g) || []).length, 2);
  for (const label of ["Filename", "File size", "SHA-256", "Uploaded by", "Date"]) assert.match(out, new RegExp(`<dt>${label}</dt>`));
  assert.match(out, /<dd>10 B<\/dd>/);
  assert.match(out, /<code>a{64}<\/code>/);
  assert.match(out, /aria-label='Download version 2: v2\.pdf'/);
  assert.match(out, /href='\/api\/documents\/5\/download\?version=1'/);
  assert.ok(out.indexOf("Version 2") < out.indexOf("Version 1"), "newest first");
});

test("version history strings are escaped", async () => {
  const bad = { ...version(1), filename: "<img src=x onerror=1>'.pdf", uploadedBy: "<b>x</b>" };
  const app = await boot({ upload: async () => json(500, {}), rows: [bad] });
  assert.doesNotMatch(app.main.innerHTML, /<img|<b>x/);
  assert.match(app.main.innerHTML, /&lt;img src=x onerror=1&gt;/);
});

test("responsive CSS: stacked single column on phones, no overflow sources, desktop grid", () => {
  const phone = css.slice(css.lastIndexOf("@media(max-width:600px){"));
  assert.match(phone, /\.version-card dl\{grid-template-columns:1fr\}/);
  assert.match(phone, /\.version-card \.btn\{width:100%\}/);
  assert.match(css, /\.version-card dd\{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.version-card code\{[^}]*word-break:break-all/);
  assert.match(css, /\.version-card\{min-width:0;/);
  assert.match(css, /\.version-card dl\{[^}]*repeat\(auto-fit,minmax\(min\(100%,10rem\),1fr\)\)/);
  assert.match(css, /\.version-card \.btn\{[^}]*inline-flex/);
  assert.doesNotMatch(css, /\.versions\b/, "no leftover table-hacking rules");
  assert.doesNotMatch(css, /left:-9999px/);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/);
});
