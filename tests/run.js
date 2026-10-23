"use strict";
/* jsdom windows are memory hungry, so page-heavy files run once per page in separate processes. */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const HEAVY = ["seasonal-lights", "seasonal-signature", "seasonal-content", "seasonal-placement", "seasonal-switch-hero"].map((n) => n + ".test.js");
const dir = __dirname;
const docs = path.join(dir, "..", "docs");
const pages = fs.readdirSync(docs).filter((f) => f.endsWith(".html"));
const light = fs.readdirSync(dir).filter((f) => f.endsWith(".test.js") && !HEAVY.includes(f));
let failed = false;
function run(files, env) {
  const r = spawnSync(process.execPath, ["--expose-gc", "--test", "--test-concurrency=1", ...files.map((f) => path.join(dir, f))],
    { stdio: "inherit", env: Object.assign({}, process.env, env) });
  if (r.status !== 0) failed = true;
}
run(light, {});
for (const p of pages) { console.log("\n== page: " + p); run(HEAVY, { RFF_PAGE: p }); }
process.exit(failed ? 1 : 0);
