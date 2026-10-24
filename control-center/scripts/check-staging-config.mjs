import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PLACEHOLDER = /REPLACE_WITH_[A-Z0-9_]+/;
const value = (text, key) => new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m").exec(text)?.[1];
const routes = (text) => [...text.matchAll(/pattern\s*=\s*"([^"]+)"/g)].map((m) => m[1]);

/** Returns a list of problems; empty means the staging config is isolated from production. */
export function validateStagingConfig(staging, production, { forDeploy = false } = {}) {
  const problems = [];
  const same = (key, label) => {
    if (value(staging, key) && value(staging, key) === value(production, key)) problems.push(`${label} is identical to production`);
  };
  same("name", "Worker name");
  same("database_id", "D1 database_id");
  same("database_name", "D1 database_name");
  if (!/staging/i.test(value(staging, "name") ?? "")) problems.push("Worker name must contain 'staging'");
  if (!/staging/i.test(value(staging, "database_name") ?? "")) problems.push("D1 database_name must contain 'staging'");
  for (const pattern of routes(staging)) {
    if (routes(production).includes(pattern)) problems.push(`route ${pattern} is a production route`);
    if (!/staging/i.test(pattern)) problems.push(`route ${pattern} must be a staging hostname`);
  }
  if (!routes(staging).length) problems.push("staging needs a route so Cloudflare Access can protect a hostname");
  if (!/^workers_dev\s*=\s*false/m.test(staging)) problems.push("workers_dev must be false");
  if (!/^preview_urls\s*=\s*false/m.test(staging)) problems.push("preview_urls must be false");
  if (value(staging, "APP_ENV") !== "staging") problems.push("APP_ENV must be 'staging'");
  if (!/^binding\s*=\s*"DB"/m.test(staging)) problems.push("D1 binding must be DB");
  if (/\b(ACCESS_AUD|ACCESS_TEAM_DOMAIN|PRESIDENT_EMAIL|REGISTRY_API_TOKEN|REGISTRY_API_URL)\s*=/.test(staging)) problems.push("identity and integration settings must be secrets, not file values");
  if (forDeploy && PLACEHOLDER.test(staging)) problems.push("placeholders remain: " + PLACEHOLDER.exec(staging)[0]);
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
  const problems = validateStagingConfig(read("wrangler.staging.toml"), read("wrangler.toml"), { forDeploy: process.argv.includes("--deploy") });
  if (problems.length) { console.error(problems.map((p) => `FAIL: ${p}`).join("\n")); process.exit(1); }
  console.log("Staging config is isolated from production.");
}
