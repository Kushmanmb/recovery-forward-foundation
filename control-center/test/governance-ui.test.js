import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../admin-prototype/app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../../admin-prototype/index.html", import.meta.url), "utf8");
const sections = [...html.matchAll(/data-s="([a-z]+)"/g)].map((m) => m[1]);
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function boot(role, permissions, routes) {
  const handlers = {};
  const main = { innerHTML: "", addEventListener(type, handler) { handlers[`main:${type}`] = handler; } };
  const buttons = sections.map((section) => ({ getAttribute: (name) => (name === "data-s" ? section : null), classList: { toggle() {} }, hidden: false }));
  const nav = { addEventListener(type, handler) { handlers[`nav:${type}`] = handler; }, querySelectorAll: () => buttons };
  const requests = [];
  const fetch = async (path, options = {}) => {
    requests.push({ path, options });
    const key = path.split("?")[0];
    if (key === "/api/me") return { ok: true, json: async () => ({ email: "m@example.org", role, status: "active", permissions }) };
    const body = routes[key];
    if (body === undefined) return { ok: false, json: async () => ({ error: "not_found" }) };
    return { ok: true, json: async () => body };
  };
  const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  vm.runInNewContext(source, {
    document: { getElementById: (id) => ({ main, nav, logout: { hidden: true, addEventListener() {} } })[id] ?? null, createElement() { let t = ""; return { set textContent(v) { t = v; }, get innerHTML() { return escape(t); } }; } },
    fetch, window: { location: { assign() {} }, confirm: () => true }, FormData: class { forEach() {} }, Number, Array, JSON, Date, encodeURIComponent,
  });
  await tick(); await tick();
  const go = async (section) => { handlers["nav:click"]({ target: buttons[sections.indexOf(section)] }); await tick(); await tick(); await tick(); };
  return { main, go, handlers, requests };
}

const summary = { summary: { statusCounts: { pending: 1, verified: 2, closed: 3 } } };
const dashboard = {
  proposalCounts: { voting: 1 }, awaitingReview: 2, votesNeeded: [{ id: 9, title: "Vote me" }], upcomingMeetings: [],
  governance: { rulesVerified: false, seatedDirectors: 0, directorCount: null },
  integrations: [{ id: "finance", name: "Finance and payments", operational: false, note: "Not operational: no accounting integration." }],
};

test("every navigation section renders content and unsupported sections say they are not operational", async () => {
  const app = await boot("President", ["proposals:read"], {
    "/api/registry/summary": summary, "/api/governance/dashboard": dashboard, "/api/governance/proposals": { proposals: [] },
    "/api/governance/meetings": { meetings: [] }, "/api/governance/directors": { directors: [] },
    "/api/governance/rules": { rules: null, verified: false, approvalRules: [] }, "/api/governance/resolutions": { resolutions: [] },
    "/api/board": { members: [], roles: [] }, "/api/audit": { entries: [] },
  });
  assert.deepEqual(sections.slice(0, 3), ["overview", "proposals", "meetings"]);
  for (const section of ["applications", "finance", "comms"]) {
    await app.go(section);
    assert.match(app.main.innerHTML, /Not operational/, section);
  }
  for (const section of sections) {
    await app.go(section);
    assert.ok(app.main.innerHTML.length > 40, `${section} renders`);
    assert.doesNotMatch(app.main.innerHTML, /Control Center unavailable/, section);
  }
  await app.go("overview");
  assert.match(app.main.innerHTML, /Official action is blocked/);
  assert.match(app.main.innerHTML, /Vote me/);
  assert.match(app.main.innerHTML, /Not operational/);
  await app.go("documents");
  assert.match(app.main.innerHTML, /File storage not operational/);
});

test("proposal views escape content and show vote buttons only to eligible directors", async () => {
  const detail = (eligible) => ({
    proposal: { id: 4, title: "<script>alert(1)</script>", body: "<b>x</b>", category: "policy", status: "voting", version: 2, authorEmail: "a@example.org", meetingId: 1 },
    revisions: [], recusals: [], meeting: { title: "Mtg", status: "in_session" }, quorum: { present: 3, required: 3, met: true }, rulesVerified: true,
    voting: { eligibleToVote: eligible, myVote: null, recused: false, votesCast: 0, presentNotRecused: 3 }, resolution: null,
  });
  const routes = { "/api/registry/summary": summary, "/api/governance/dashboard": dashboard, "/api/governance/proposals/4": detail(true) };
  let app = await boot("BoardMember", ["proposals:read", "votes:cast"], { ...routes, "/api/governance/proposals": { proposals: [{ id: 4, title: "<script>alert(1)</script>", category: "policy", status: "voting", authorEmail: "a@example.org", updatedAt: 1 }] } });
  await app.go("proposals");
  assert.doesNotMatch(app.main.innerHTML, /<script>/);
  assert.match(app.main.innerHTML, /&lt;script&gt;/);
  const open = { getAttribute: (name) => (name === "data-open-proposal" ? "4" : null) };
  await app.handlers["main:click"]({ target: open }); await tick(); await tick();
  assert.match(app.main.innerHTML, /data-choice='yes'/);
  assert.match(app.main.innerHTML, /data-choice='abstain'/);
  assert.match(app.main.innerHTML, /quorum met/);
  assert.doesNotMatch(app.main.innerHTML, /close-voting/, "no officer controls without meetings:manage");
  assert.doesNotMatch(app.main.innerHTML, /<script>/);

  app = await boot("BoardMember", ["proposals:read", "votes:cast"], { ...routes, "/api/governance/proposals/4": detail(false) });
  app.handlers["main:click"]({ target: open }); await tick(); await tick(); await tick();
  assert.doesNotMatch(app.main.innerHTML, /data-choice=/);
});

test("documents section lists private storage, escapes titles and offers upload only where writable", async () => {
  const store = { maxBytes: 10485760, allowedTypes: ["pdf"], folders: [{ id: "board", label: "Board", canWrite: true }, { id: "finance", label: "Finance", canWrite: false }] };
  const app = await boot("President", ["documents:board:read"], {
    "/api/registry/summary": summary, "/api/governance/resolutions": { resolutions: [] }, "/api/documents/folders": store,
    "/api/documents": { documents: [{ id: 3, folder: "board", title: "<img src=x>", status: "active", currentVersion: 2, filename: "a.pdf", uploadedAt: 1 }] },
  });
  await app.go("documents");
  assert.match(app.main.innerHTML, /Private bucket/);
  assert.match(app.main.innerHTML, /id='doc-upload'/);
  assert.match(app.main.innerHTML, /&lt;img src=x&gt;/);
  assert.doesNotMatch(app.main.innerHTML, /<img src=x>/);
  assert.match(app.main.innerHTML, /\/api\/documents\/3\/download/);
  assert.doesNotMatch(app.main.innerHTML, /File storage not operational/);
});
