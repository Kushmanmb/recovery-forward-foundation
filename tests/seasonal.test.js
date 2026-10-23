"use strict";
const test = require("node:test");
const { after } = test;
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const DOCS = path.join(__dirname, "..", "docs");
const SCRIPT = fs.readFileSync(path.join(DOCS, "js", "seasonal-theme.js"), "utf8");
const engine = require(path.join(DOCS, "js", "seasonal-theme.js"));
const PAGES = fs.readdirSync(DOCS).filter((f) => f.endsWith(".html"));

const windows = [];
after(() => windows.forEach((w) => w.close()));

function load(page, { search = "", reduced = false, stored = null, width = 1024 } = {}) {
  const html = fs.readFileSync(path.join(DOCS, page), "utf8").replace(/<script[^>]*src=[^>]*><\/script>/g, "");
  const dom = new JSDOM(html, { url: "https://example.org/" + page + search, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  windows.push(w);
  Object.defineProperty(w, "innerWidth", { value: width, configurable: true });
  w.matchMedia = (q) => ({ matches: reduced && /reduce/.test(q), addEventListener() {}, removeEventListener() {} });
  if (stored) w.localStorage.setItem(engine.STORAGE_KEY, stored);
  w.eval(SCRIPT);
  w.RFFSeasonal.init(w.document, w);
  return w;
}

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

test("initialization decorates every public page (cards, sections, headings, header, footer)", () => {
  for (const p of PAGES) {
    const w = load(p);
    const d = w.document;
    assert.ok(d.documentElement.getAttribute("data-season"), p + " season");
    assert.strictEqual(d.querySelectorAll(".sx-layer").length, 2, p);
    assert.ok(d.querySelector(".sx-toggle-bar > .sx-toggle"), p + " toggle");
    const cards = d.querySelectorAll(engine.CARD_SELECTOR);
    for (const c of cards) {
      assert.ok(c.querySelector(":scope > .sx-deco .sx-glow"), p + " card " + c.className);
    }
    for (const sel of [engine.SECTION_SELECTOR, engine.HEADING_SELECTOR, ".site-header", "footer"]) {
      for (const el of d.querySelectorAll(sel)) {
        assert.ok(el.querySelector(":scope > .sx-deco"), p + " " + sel);
      }
    }
    for (const el of d.querySelectorAll(".footer-social")) assert.ok(el.querySelector(".sx-deco"), p + " social");
    for (const el of d.querySelectorAll(".sx-deco, .sx-layer")) assert.strictEqual(el.getAttribute("aria-hidden"), "true");
  }
});

test("decorations never alter existing content, links or forms", () => {
  for (const p of PAGES) {
    const rawWin = new JSDOM(fs.readFileSync(path.join(DOCS, p), "utf8").replace(/<script[^>]*src=[^>]*><\/script>/g, "")).window;
    windows.push(rawWin);
    const raw = rawWin.document;
    const w = load(p);
    const d = w.document;
    const clean = d.documentElement.cloneNode(true);
    clean.querySelectorAll(".sx-deco, .sx-layer, .sx-toggle-bar").forEach((n) => n.remove());
    assert.strictEqual(clean.querySelectorAll("a").length, raw.querySelectorAll("a").length, p);
    assert.strictEqual(clean.querySelectorAll("form, input, textarea, select, button").length,
      raw.querySelectorAll("form, input, textarea, select, button").length, p);
    assert.strictEqual(clean.querySelector("body").textContent.replace(/\s+/g, ""), raw.body.textContent.replace(/\s+/g, ""), p);
    assert.strictEqual(d.querySelectorAll("a .sx-deco, button .sx-deco").length, 0, p);
  }
});

test("October: jack-o'-lanterns, cobwebs, spiders, ghosts, witch, varied card layouts", () => {
  const d = load("programs.html", { search: "?season=october" }).document;
  assert.strictEqual(d.documentElement.getAttribute("data-sx-mood"), "halloween");
  assert.ok(d.querySelectorAll(".sx-footer-deco .sx-pumpkin, .sx-header-deco .sx-pumpkin").length >= 3);
  assert.ok(d.querySelector(".sx-witch"));
  assert.ok(d.querySelectorAll(".sx-pghost").length >= 2);
  assert.ok(d.querySelectorAll(".sx-card-deco .sx-spiderbox .sx-thread").length >= 5);
  assert.ok(d.querySelectorAll(".sx-spiderbox svg").length >= 5);
  assert.ok(d.querySelectorAll(".sx-card-deco .sx-web").length > 3);
  assert.ok(d.querySelectorAll(".sx-card-deco .sx-pumpkin").length > 3);
  const layouts = new Set([...d.querySelectorAll(".sx-card-deco")].map((e) => [...e.querySelectorAll(".sx-m")].map((n) => n.className).join("|")));
  assert.ok(layouts.size >= 3, "card decorations vary");
  const colors = new Set([...d.querySelectorAll(".sx-glow")].map((e) => e.style.getPropertyValue("--sx-c")));
  assert.deepStrictEqual([...colors].sort(), ["#6bff3d", "#a64dff", "#ff8c1a"].sort());
});

test("November: leaves, acorns and amber glow", () => {
  const d = load("about.html", { search: "?season=november" }).document;
  assert.ok(d.querySelectorAll(".sx-leaf").length > 2);
  assert.ok(d.querySelectorAll(".sx-acorn").length > 0);
  assert.ok(d.querySelector(".sx-p.sx-fall"));
});

test("December: blinking bulbs on page edges and cards, ornaments, garlands, snow, tappable bulbs", () => {
  const w = load("programs.html", { search: "?season=december" });
  const d = w.document;
  assert.ok(d.querySelectorAll(".sx-front .sx-bulb").length >= 8);
  assert.ok(d.querySelectorAll(".sx-card-deco .sx-bulb").length >= 8);
  assert.ok(d.querySelectorAll(".sx-garland").length > 2);
  assert.ok(d.querySelectorAll(".sx-card-deco .sx-orn").length >= 2);
  assert.ok(d.querySelector(".sx-p.sx-fall"));
  assert.ok(d.querySelectorAll(".sx-header-deco .sx-bulb").length > 0);
  const delays = new Set([...d.querySelectorAll(".sx-bulb")].map((b) => b.style.getPropertyValue("--d")));
  assert.ok(delays.size > 5, "bulbs blink independently");
  const bulb = d.querySelector(".sx-bulb");
  bulb.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  assert.ok(bulb.classList.contains("sx-on"));
});

test("Jan-Sep themes each decorate every page", () => {
  for (let m = 1; m <= 9; m++) {
    const d = load("index.html", { search: "?season=" + m }).document;
    assert.strictEqual(d.documentElement.getAttribute("data-season"), engine.MONTH_NAMES[m - 1]);
    for (const c of d.querySelectorAll(engine.CARD_SELECTOR)) assert.ok(c.querySelector(":scope > .sx-deco .sx-m"), "month " + m);
    assert.ok(d.querySelector(".sx-particles .sx-p"));
  }
});

test("dynamically generated cards are decorated", async () => {
  const w = load("index.html");
  const d = w.document;
  const card = d.createElement("article");
  card.className = "portal-card";
  card.textContent = "New";
  d.body.appendChild(card);
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(card.querySelector(":scope > .sx-deco .sx-glow"));
});

test("re-applying a season is idempotent and swaps decorations", () => {
  const w = load("about.html", { search: "?season=october" });
  const d = w.document;
  const before = d.querySelectorAll(".sx-card-deco").length;
  const st = d.__rffSeasonalState;
  w.RFFSeasonal.applySeason(d, w, w.RFFSeasonal.SEASONS[11], st);
  assert.strictEqual(d.querySelectorAll(".sx-card-deco").length, before);
  assert.strictEqual(d.querySelectorAll(".sx-layer").length, 2);
  assert.strictEqual(d.documentElement.getAttribute("data-season"), "december");
  assert.strictEqual(d.querySelectorAll(".sx-witch").length, 0);
});

test("motion: on by default, toggle persists, reduced-motion forces off", () => {
  let w = load("index.html");
  let d = w.document;
  const btn = d.querySelector(".sx-toggle");
  assert.strictEqual(d.documentElement.getAttribute("data-sx-motion"), "on");
  assert.strictEqual(btn.querySelector(".sx-state").textContent, "On");
  assert.strictEqual(btn.getAttribute("aria-pressed"), "true");
  btn.click();
  assert.strictEqual(d.documentElement.getAttribute("data-sx-motion"), "off");
  assert.strictEqual(btn.getAttribute("aria-pressed"), "false");
  assert.strictEqual(btn.querySelector(".sx-state").textContent, "Off");
  assert.strictEqual(w.localStorage.getItem(engine.STORAGE_KEY), "off");
  btn.click();
  assert.strictEqual(d.documentElement.getAttribute("data-sx-motion"), "on");

  d = load("index.html", { stored: "off" }).document;
  assert.strictEqual(d.documentElement.getAttribute("data-sx-motion"), "off");

  w = load("index.html", { reduced: true, stored: "on" });
  d = w.document;
  assert.strictEqual(d.documentElement.getAttribute("data-sx-motion"), "off");
  assert.ok(d.querySelector(".sx-toggle").disabled);
  assert.match(d.querySelector(".sx-state").textContent, /reduced-motion/);
  assert.ok(d.querySelectorAll(".sx-deco").length > 0, "static decorations remain");
});

test("stylesheet keeps overlays nonblocking and honors reduced motion", () => {
  const css = fs.readFileSync(path.join(DOCS, "css", "seasonal.css"), "utf8");
  assert.match(css, /\.sx-layer[^{]*\{[^}]*pointer-events:\s*none/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /data-sx-motion="off"/);
  assert.match(css, /overflow-x:\s*clip/);
  assert.doesNotMatch(css, /@import|url\(http/);
});

test("engine does not touch private or backend areas", () => {
  assert.doesNotMatch(SCRIPT, /fetch\(|XMLHttpRequest|api\.recoveryforward|control-center/);
});

const MOBILE = 375;

test("placement: card motifs are corner/border anchored, floaters are behind content", () => {
  for (const p of PAGES) {
    for (const season of ["october", "december", "november"]) {
      const d = load(p, { search: "?season=" + season, width: MOBILE }).document;
      for (const m of d.querySelectorAll(".sx-card-deco .sx-m")) {
        assert.match(m.className, /\bsx-(tl|tr|bl|br)\b/, p + " " + m.className);
        assert.strictEqual(m.getAttribute("style"), null, "no free positioning");
      }
      for (const s of d.querySelectorAll(".sx-spiderbox")) assert.match(s.className, /\bsx-(left|right)\b/);
      const front = d.querySelector(".sx-front");
      assert.strictEqual(front.querySelectorAll(".sx-pumpkin, .sx-ghost, .sx-pghost, .sx-witch, .sx-p, .sx-spiderbox, .sx-orn").length, 0, p);
      assert.ok(d.querySelector(".sx-back"));
      assert.strictEqual(d.querySelectorAll(".sx-section-deco .sx-m").length, 0, "sections hold no corner art");
    }
  }
  const o = load("index.html", { search: "?season=october", width: MOBILE }).document;
  assert.ok(o.querySelector(".sx-back .sx-pghost") && o.querySelector(".sx-back .sx-witch"));
});

test("every Halloween card keeps its glowing border plus lantern, web and spider", () => {
  for (const p of PAGES) {
    const d = load(p, { search: "?season=october", width: MOBILE }).document;
    for (const c of d.querySelectorAll(engine.CARD_SELECTOR)) {
      const deco = c.querySelector(":scope > .sx-card-deco");
      assert.ok(deco.querySelector(".sx-glow"), p);
      assert.ok(deco.querySelectorAll(".sx-pumpkin").length >= 2, p + " lanterns");
      assert.ok(deco.querySelector(".sx-web svg path"), p + " web");
      assert.ok(deco.querySelector(".sx-spiderbox .sx-thread"), p + " spider");
    }
  }
});

test("mobile: no side/bottom light rails, toggle is in-flow after content", () => {
  const d = load("support.html", { search: "?season=december", width: MOBILE }).document;
  assert.strictEqual(d.querySelectorAll(".sx-edge-left, .sx-edge-right, .sx-edge-bottom").length, 0);
  assert.strictEqual(d.querySelectorAll(".sx-edge-top").length, 1);
  const wide = load("support.html", { search: "?season=december", width: 1280 }).document;
  assert.strictEqual(wide.querySelectorAll(".sx-edge-left, .sx-edge-right").length, 2);
  const bar = d.querySelector(".sx-toggle-bar");
  assert.strictEqual(bar.parentNode, d.body);
  const kids = [...d.body.children].filter((e) => !e.classList.contains("sx-layer") && e.tagName !== "SCRIPT");
  assert.strictEqual(kids[kids.length - 1], bar);
});

test("CSS: toggle never fixed, floaters behind content, spider and reduced-motion rules", () => {
  const css = fs.readFileSync(path.join(DOCS, "css", "seasonal.css"), "utf8");
  const block = (sel) => { const m = css.match(new RegExp("(?:^|\\n)" + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{([^}]*)\\}")); return m ? m[1] : ""; };
  assert.doesNotMatch(block(".sx-toggle"), /position:\s*fixed/);
  assert.doesNotMatch(block(".sx-toggle-bar"), /position:\s*(fixed|absolute|sticky)/);
  assert.match(block(".sx-back"), /z-index:\s*-1/);
  assert.match(css, /@keyframes sx-drop[^\n]*translateY\(-28px\)[^\n]*translateY\(52px\)/);
  const rm = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(rm, /animation:\s*none !important/);
  assert.match(rm, /\.sx-spiderin \{ transform/);
  assert.match(css, /@media \(max-width: 700px\)/);
});

test("animation behavior: toggling off marks motion off; all animated parts are CSS-driven", () => {
  const w = load("index.html", { search: "?season=october", width: MOBILE });
  const d = w.document;
  const css = fs.readFileSync(path.join(DOCS, "css", "seasonal.css"), "utf8");
  for (const kf of ["sx-drop", "sx-flicker", "sx-ghost", "sx-witch", "sx-glow", "sx-fall", "sx-swing", "sx-blink"]) {
    assert.match(css, new RegExp("@keyframes " + kf + "\\b"), kf);
  }
  assert.match(css, /html\[data-sx-motion="off"\] \.sx-layer \*[^{]*\{ animation: none !important/);
  d.querySelector(".sx-toggle").click();
  assert.strictEqual(d.documentElement.getAttribute("data-sx-motion"), "off");
  assert.ok(d.querySelectorAll(".sx-spiderbox").length > 0, "static spiders remain visible");
});
