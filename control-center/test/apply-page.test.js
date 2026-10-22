import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../../docs/apply.html", import.meta.url), "utf8");
const block = html.match(/\/\/ INTAKE-BEGIN([\s\S]*?)\/\/ INTAKE-END/)[1];
const docs = (name) => readFileSync(new URL(`../docs/${name}`, import.meta.url), "utf8");

function load(url) {
  const code = url === null ? block : block.replace("const INTAKE_URL = null;", `const INTAKE_URL = ${JSON.stringify(url)};`);
  return vm.runInNewContext(`${code}; ({ sendIntake, intakeErrorMessage, INTAKE_URL })`);
}

const payload = { rcgi: "RCGI-0123456789ab", goals: "secret answer" };

test("intake is dormant in the shipped page", () => {
  assert.match(html, /const INTAKE_URL = null;/);
  assert.equal(html.match(/const INTAKE_URL\s*=/g).length, 1);
});

test("disabled intake never calls fetch or transmits answers", async () => {
  let calls = 0;
  const { sendIntake } = load(null);
  const outcome = await sendIntake(payload, () => { calls++; });
  assert.equal(calls, 0);
  assert.equal(outcome.sent, false);
  assert.equal(outcome.disabled, true);
});

test("enabled intake posts JSON without credentials and reports success only on 202", async () => {
  let seen;
  const { sendIntake } = load("https://intake.example.test/applications");
  const ok = await sendIntake(payload, async (url, init) => { seen = { url, init }; return { status: 202 }; });
  assert.equal(ok.sent, true);
  assert.equal(seen.url, "https://intake.example.test/applications");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.credentials, "omit");
  assert.equal(JSON.parse(seen.init.body).goals, "secret answer");
  const ok200 = await sendIntake(payload, async () => ({ status: 200 }));
  assert.equal(ok200.sent, false);
});

test("HTTP errors map to accurate messages and are retryable", async () => {
  const { sendIntake } = load("https://intake.example.test/applications");
  const messages = new Set();
  for (const status of [400, 413, 415, 429, 503, 500]) {
    const outcome = await sendIntake(payload, async () => ({ status }));
    assert.equal(outcome.sent, false);
    assert.equal(outcome.disabled, false);
    assert.ok(outcome.message);
    messages.add(`${status}:${outcome.message}`);
  }
  assert.match([...messages].find((m) => m.startsWith("429:")), /Too many/);
  assert.match([...messages].find((m) => m.startsWith("503:")), /unavailable/);
  assert.match([...messages].find((m) => m.startsWith("413:")), /too long/);
  const network = await sendIntake(payload, async () => { throw new TypeError("offline"); });
  assert.equal(network.sent, false);
  assert.ok(network.message);
  const retry = await sendIntake(payload, async () => ({ status: 202 }));
  assert.equal(retry.sent, true);
});

test("page wires a retry button and sends only after the RCGI is created", () => {
  assert.match(html, /id="intake-retry-button"/);
  assert.ok(html.indexOf("pendingIntake = {") > html.indexOf("application.participantId"));
  assert.match(html, /needs: Array\.from\(selectedNeeds/);
});

test("docs mark the Registry /exists contract as unverified and list deployment gates", () => {
  assert.match(docs("06-APPLICATION-INBOX.md"), /unverified proposed contract/);
  const checklist = docs("07-DEPLOYMENT-CHECKLIST.md");
  for (const term of ["Staging", "D1 backups", "Migrations", "Cloudflare secrets", "Security requirements", "Deployment blockers"]) {
    assert.ok(checklist.includes(term), term);
  }
  assert.doesNotMatch(checklist, /[0-9a-f]{40,}/i);
});
