"use strict";
const test = require("node:test");
const { assert, fs, path, JSDOM, DOCS, SCRIPT, engine, PAGES, load, windows, MOBILE } = require("./helpers");

test("month is read in America/Indiana/Indianapolis, not UTC", () => {
  // Oct 1 03:00 UTC is still Sep 30 in Indianapolis (EDT, UTC-4).
  assert.strictEqual(engine.getIndianapolisMonth(new Date("2026-10-01T03:00:00Z")), 9);
  assert.strictEqual(engine.getIndianapolisMonth(new Date("2026-10-01T04:00:00Z")), 10);
  // Winter: EST, UTC-5.
  assert.strictEqual(engine.getIndianapolisMonth(new Date("2026-12-01T04:59:00Z")), 11);
  assert.strictEqual(engine.getIndianapolisMonth(new Date("2026-12-01T05:00:00Z")), 12);
  assert.strictEqual(engine.getIndianapolisMonth(new Date("2027-01-01T04:59:00Z")), 12);
  assert.strictEqual(engine.getIndianapolisMonth(new Date("2027-01-01T05:00:00Z")), 1);
});

test("each month selects its own theme", () => {
  assert.strictEqual(engine.SEASONS.length, 12);
  assert.strictEqual(new Set(engine.SEASONS.map((s) => s.name)).size, 12);
  for (let m = 1; m <= 12; m++) {
    const s = engine.getSeason(new Date(Date.UTC(2026, m - 1, 15, 17)), "");
    assert.strictEqual(s.id, engine.MONTH_NAMES[m - 1]);
  }
  assert.strictEqual(engine.getSeason(new Date("2026-10-15T12:00:00Z"), "").mood, "halloween");
  assert.strictEqual(engine.getSeason(new Date("2026-11-15T12:00:00Z"), "").mood, "thanksgiving");
  assert.strictEqual(engine.getSeason(new Date("2026-12-15T12:00:00Z"), "").mood, "christmas");
  assert.strictEqual(engine.getSeason(new Date("2026-10-15T12:00:00Z"), "?season=december").id, "december");
});

test("every page has the theme assets linked", () => {
  assert.ok(PAGES.length >= 7);
  for (const p of PAGES) {
    const src = fs.readFileSync(path.join(DOCS, p), "utf8");
    assert.match(src, /css\/seasonal\.css/, p);
    assert.match(src, /js\/seasonal-theme\.js/, p);
  }
});

test("stylesheet keeps overlays nonblocking and honors reduced motion", () => {
  const css = fs.readFileSync(path.join(DOCS, "css", "seasonal.css"), "utf8");
  assert.match(css, /\.sx-layer[^{]*\{[^}]*pointer-events:\s*none/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /overflow-x:\s*clip/);
  assert.doesNotMatch(css, /@import|url\(http/);
});

test("engine does not touch private or backend areas", () => {
  assert.doesNotMatch(SCRIPT, /fetch\(|XMLHttpRequest|api\.recoveryforward|control-center/);
});

test("CSS: floaters behind content, spider and reduced-motion rules", () => {
  const css = fs.readFileSync(path.join(DOCS, "css", "seasonal.css"), "utf8");
  const block = (sel) => { const m = css.match(new RegExp("(?:^|\\n)" + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{([^}]*)\\}")); return m ? m[1] : ""; };
  assert.match(block(".sx-back"), /z-index:\s*-1/);
  assert.match(css, /@keyframes sx-drop[^\n]*translateY\(-28px\)[^\n]*translateY\(52px\)/);
  const rm = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(rm, /animation:\s*none !important/);
  assert.match(rm, /\.sx-spiderin \{ transform/);
  assert.match(css, /@media \(max-width: 700px\)/);
});

test("animation behavior: every effect is CSS-keyframe driven", () => {
  const css = fs.readFileSync(path.join(DOCS, "css", "seasonal.css"), "utf8");
  for (const kf of ["sx-drop", "sx-flicker", "sx-ghost", "sx-witch", "sx-glow", "sx-fall", "sx-swing", "sx-blink"]) {
    assert.match(css, new RegExp("@keyframes " + kf + "\\b"), kf);
  }
});
