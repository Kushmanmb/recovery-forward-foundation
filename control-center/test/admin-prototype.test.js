import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const appSource = readFileSync(new URL("../../admin-prototype/app.js", import.meta.url), "utf8");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function createApp(role = "Treasurer", extraFetch) {
  const registryRequests = [];
  const requests = [];
  const handlers = {};
  let logoutUrl;
  const main = {
    innerHTML: "",
    addEventListener(type, handler) { handlers[`main:${type}`] = handler; },
  };
  const sections = ["overview", "registry", "security", "board", "audit"];
  const buttons = sections.map((section) => ({
    getAttribute(name) { return name === "data-s" ? section : null; },
    classList: { toggle() {} },
  }));
  const nav = {
    addEventListener(type, handler) { handlers[`nav:${type}`] = handler; },
    querySelectorAll() { return buttons; },
  };
  const logout = {
    hidden: true,
    addEventListener(type, handler) { handlers[`logout:${type}`] = handler; },
  };
  const document = {
    getElementById(id) {
      return { main, nav, logout }[id];
    },
    createElement() {
      let text = "";
      return {
        set textContent(value) { text = value; },
        get innerHTML() { return text; },
      };
    },
  };
  const fetch = (path, options = {}) => {
    requests.push({ path, options });
    if (path === "/api/me") {
      return Promise.resolve({
        ok: true,
        json: async () => ({ email: "member@example.org", role, status: "active", permissions: [] }),
      });
    }
    if (path === "/api/registry/summary") {
      const request = deferred();
      registryRequests.push(request);
      return request.promise;
    }
    if (path === "/api/session" && options.method === "DELETE") {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    }
    if (extraFetch) return extraFetch(path, options);
    throw new Error(`Unexpected request: ${path}`);
  };

  vm.runInNewContext(appSource, {
    document,
    fetch,
    window: { location: { assign(url) { logoutUrl = url; } } },
  });
  while (registryRequests.length === 0) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  return {
    buttons,
    handlers,
    main,
    registryRequests,
    requests,
    get logoutUrl() { return logoutUrl; },
  };
}

for (const [name, rejectRequest] of [
  ["successful", false],
  ["failed", true],
]) {
  test(`stale ${name} Registry requests do not replace the selected Security section`, async () => {
    const app = await createApp();
    app.handlers["nav:click"]({ target: app.buttons[2] });
    assert.match(app.main.innerHTML, /<h2>Security<\/h2>/);

    if (rejectRequest) app.registryRequests[0].reject(new Error("registry unavailable"));
    else {
      app.registryRequests[0].resolve({
        ok: true,
        json: async () => ({ summary: { statusCounts: { pending: 0, verified: 0, closed: 0 } } }),
      });
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(app.main.innerHTML, /<h2>Security<\/h2>/);
  });
}

test("sign-out revokes the application session and navigates to Cloudflare Access logout", async () => {
  const app = await createApp();
  await app.handlers["logout:click"]();

  assert.equal(app.requests.some(({ path, options }) => path === "/api/session" && options.method === "DELETE"), true);
  assert.equal(app.logoutUrl, "/cdn-cgi/access/logout");
  app.registryRequests[0].resolve({
    ok: true,
    json: async () => ({ summary: { statusCounts: { pending: 0, verified: 0, closed: 0 } } }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.main.innerHTML, "");
});


test("President can navigate to the board roster and audit activity", async () => {
  const app = await createApp("President", async path => ({ ok: true, json: async () => path === "/api/board"
    ? { members: [{ email: "officer@example.org", role: "Secretary", status: "pending" }], roles: ["Secretary"] }
    : { entries: [{ actorEmail: "president@example.org", action: "board_invitation_created", detail: {}, createdAt: 1 }] } }));
  assert.equal(app.buttons[3].hidden, false);
  app.handlers["nav:click"]({ target: app.buttons[3] });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(app.main.innerHTML, /officer@example.org/);
  assert.match(app.main.innerHTML, /Activate member/);
  app.handlers["nav:click"]({ target: app.buttons[4] });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(app.main.innerHTML, /board_invitation_created/);
});

test("non-Presidents do not see board administration or audit navigation", async () => {
  const app = await createApp();
  assert.equal(app.buttons[3].hidden, true);
  assert.equal(app.buttons[4].hidden, true);
});

test("a stale board roster cannot replace the selected Security screen", async () => {
  const board = deferred();
  const app = await createApp("President", () => board.promise);
  app.handlers["nav:click"]({ target: app.buttons[3] });
  app.handlers["nav:click"]({ target: app.buttons[2] });
  board.resolve({ ok: true, json: async () => ({ members: [], roles: [] }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(app.main.innerHTML, /<h2>Security<\/h2>/);
});
