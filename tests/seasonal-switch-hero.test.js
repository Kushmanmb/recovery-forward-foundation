"use strict";
const test = require("node:test");
const { assert, fs, path, JSDOM, DOCS, SCRIPT, engine, PAGES, load, windows, MOBILE } = require("./helpers");

test("animation switch is completely gone: no UI, no storage, no API, no CSS, no docs", () => {
  for (const p of PAGES) {
    for (const season of [p === "index.html" ? "?season=october" : ""]) {
      const w = load(p, { search: season });
      const d = w.document;
      assert.strictEqual(d.querySelectorAll(".sx-toggle, .sx-toggle-bar, .sx-state").length, 0, p);
      assert.ok(!/Seasonal animations/i.test(d.body.textContent), p);
      assert.strictEqual(d.documentElement.hasAttribute("data-sx-motion"), false);
      assert.strictEqual(w.localStorage.length, 0, "nothing is stored");
      // Changing theme must not bring it back.
      engine.applySeason(d, w, engine.SEASONS[11], d.__rffSeasonalState);
      assert.strictEqual(d.querySelectorAll(".sx-toggle, .sx-toggle-bar").length, 0);
    }
  }
  const css = fs.readFileSync(path.join(DOCS, "css", "seasonal.css"), "utf8");
  assert.doesNotMatch(css, /sx-toggle|sx-state|data-sx-motion/);
  assert.doesNotMatch(SCRIPT, /sx-toggle|localStorage|rff-seasonal-motion|setMotion|computeMotion|data-sx-motion|addEventListener\("change"/);
  assert.strictEqual(engine.STORAGE_KEY, undefined);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8"), /toggle/i);
});

test("seasonal effects stay active (no switch needed) and reduced motion is CSS-driven", () => {
  const d = load("index.html", { search: "?season=october", width: MOBILE }).document;
  assert.ok(d.querySelector(".sx-back .sx-witch") && d.querySelector(".sx-card-deco .sx-spiderbox"));
  const reduced = load("index.html", { reduced: true }).document;
  assert.ok(reduced.querySelectorAll(".sx-deco").length > 0, "static decorations remain when reduced");
  const css = fs.readFileSync(path.join(DOCS, "css", "seasonal.css"), "utf8");
  const rm = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(rm, /animation:\s*none !important/);
  // Animations are not disabled outside the media query.
  assert.doesNotMatch(css.slice(0, css.indexOf("@media (prefers-reduced-motion: reduce)")), /animation:\s*none !important/);
});

test("homepage hero: single real heading, no duplicate text from seasonal layers or pseudo-elements", () => {
  for (const season of ["", "?season=october", "?season=december"]) {
    const errors = [];
    const d = load("index.html", { search: season, width: MOBILE, errors }).document;
    const h1s = d.querySelectorAll("h1");
    assert.strictEqual(h1s.length, 1);
    assert.strictEqual(h1s[0].textContent.replace(/\s+/g, " ").replace(/\s*\d+\s*$/, "").trim().slice(0, 24), "YOUR NEXT STEP FORWARD");
    assert.strictEqual(h1s[0].querySelectorAll("span:not(.sx-deco)").length, 1);
    const layerText = [...d.querySelectorAll(".sx-layer")].map((n) => n.textContent).join("");
    assert.ok(!/NEXT STEP|FORWARD/i.test(layerText));
    for (const deco of d.querySelectorAll(".hero .sx-deco")) assert.ok(!/NEXT STEP|FORWARD/i.test(deco.textContent));
    assert.deepStrictEqual(errors, []);
  }
  const sheets = ["style.css", "seasonal.css", "lifeline.css"].map((f) => fs.readFileSync(path.join(DOCS, "css", f), "utf8")).join("\n");
  assert.doesNotMatch(sheets, /content:\s*["'][^"']*(NEXT STEP|FORWARD)/i);
  assert.doesNotMatch(SCRIPT, /NEXT STEP/i);
});

test("homepage hero: poster copy baked into the artwork is cropped/scrimmed on every width", () => {
  const css = fs.readFileSync(path.join(DOCS, "css", "style.css"), "utf8");
  const mobile = css.slice(css.indexOf("/* MOBILE HERO"));
  assert.match(mobile, /background-size:\s*auto max\(100%,\s*119vw\)/);
  assert.match(mobile, /background-position:\s*100% center/);
  const hero = css.slice(css.indexOf(".hero {"), css.indexOf(".hero-overlay {"));
  assert.match(hero, /rgba\(5,12,9,\.96\) 46%/);
  assert.match(hero, /recovery-forward-hero\.png/);
  const html = fs.readFileSync(path.join(DOCS, "index.html"), "utf8");
  assert.match(html, /<h1>\s*YOUR NEXT STEP\s*<span>FORWARD<\/span>\s*<\/h1>/);
  assert.strictEqual((html.match(/<h1/g) || []).length, 1);
});

test("all pages initialize Halloween and Christmas without JS errors", () => {
  for (const p of PAGES) {
    for (const season of [p === "index.html" ? "?season=october" : "?season=december"]) {
      const errors = [];
      const d = load(p, { search: season, width: MOBILE, errors }).document;
      assert.deepStrictEqual(errors, [], p);
    }
  }
});
