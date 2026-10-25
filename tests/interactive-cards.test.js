"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const DOCS = path.join(__dirname, "..", "docs");
const cards = require(path.join(DOCS, "js", "interactive-cards.js"));
const css = fs.readFileSync(path.join(DOCS, "css", "interactive.css"), "utf8");
const PAGES = ["index", "about", "mission", "programs", "apply", "support", "transparency"].map((n) => n + ".html");

function open(page, hash) {
  const html = fs.readFileSync(path.join(DOCS, page), "utf8").replace(/<script[^>]*src=[^>]*><\/script>/g, "");
  const dom = new JSDOM(html, { url: "https://example.org/" + page + (hash || ""), pretendToBeVisual: true });
  dom.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  cards.init(dom.window.document, dom.window);
  return dom.window;
}

for (const page of PAGES) {
  test(page + ": assets, real buttons, valid aria wiring, no hotspots", () => {
    const raw = fs.readFileSync(path.join(DOCS, page), "utf8");
    assert.match(raw, /css\/interactive\.css/);
    assert.match(raw, /js\/interactive-cards\.js/);
    const w = open(page);
    const d = w.document;
    assert.ok(d.querySelector("[data-rff-explorer]"), "has an explorer");
    const triggers = d.querySelectorAll(".rff-trigger");
    assert.ok(triggers.length >= 4);
    triggers.forEach((t) => {
      assert.strictEqual(t.tagName, "BUTTON");
      assert.strictEqual(t.getAttribute("aria-expanded"), "false");
      const panel = d.getElementById(t.getAttribute("aria-controls"));
      assert.ok(panel, "panel exists for " + t.textContent.trim());
      assert.ok(panel.hidden);
      assert.ok(t.querySelector("svg"), "icon injected");
    });
    assert.strictEqual(d.querySelectorAll(".hotspot, map, area, [data-hotspot]").length, 0);
    d.querySelectorAll(".rff-panel a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      if (/^(mailto:|https?:|#)/.test(href)) return;
      assert.ok(fs.existsSync(path.join(DOCS, href.split("#")[0])), "link target " + href);
    });
  });

  test(page + ": click opens one panel, close and Escape restore focus", () => {
    const w = open(page);
    const d = w.document;
    const ex = d.querySelector("[data-rff-explorer]");
    const [a, b] = ex.querySelectorAll(".rff-trigger");
    a.click();
    assert.strictEqual(a.getAttribute("aria-expanded"), "true");
    assert.ok(!d.getElementById(a.getAttribute("aria-controls")).hidden);
    b.click();
    assert.strictEqual(a.getAttribute("aria-expanded"), "false");
    assert.strictEqual(b.getAttribute("aria-expanded"), "true");
    assert.strictEqual(ex.querySelectorAll(".rff-panel:not([hidden])").length, 1);
    d.getElementById(b.getAttribute("aria-controls")).querySelector(".rff-close").click();
    assert.strictEqual(b.getAttribute("aria-expanded"), "false");
    assert.strictEqual(d.activeElement, b);
    a.click();
    a.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.strictEqual(a.getAttribute("aria-expanded"), "false");
  });

  test(page + ": preserved signature, footer logo and forms", () => {
    const d = open(page).document;
    assert.ok(d.querySelector(".footer-logo, [class*='footer-logo']"), "footer logo");
    assert.ok(d.querySelector("nav, .site-nav, header"));
  });
}

test("hash opens the matching card", () => {
  const w = open("index.html");
  const first = w.document.querySelectorAll(".rff-card")[2];
  const id = first.id;
  assert.ok(id);
  const w2 = open("index.html", "#" + id);
  assert.strictEqual(w2.document.getElementById(id).querySelector(".rff-trigger").getAttribute("aria-expanded"), "true");
});

test("preserved workflow elements remain", () => {
  const home = fs.readFileSync(path.join(DOCS, "index.html"), "utf8");
  assert.match(home, /id="status-form"|id="status"/);
  assert.match(fs.readFileSync(path.join(DOCS, "apply.html"), "utf8"), /id="application-form"|<form/);
  for (const p of PAGES) {
    const raw = fs.readFileSync(path.join(DOCS, p), "utf8");
    assert.match(raw, /founder-signature/, p);
    assert.match(raw, /footer-logo/, p);
  }
});

test("CSS: focus, reduced motion, full-perimeter glow, tap targets", () => {
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /\.rff-trigger:focus-visible/);
  assert.match(css, /\.rff-close:focus-visible/);
  assert.match(css, /box-shadow:[^;]*0 0 \d+px/);
  assert.doesNotMatch(/\.rff-(explorer|grid)\s*\{[^}]*overflow\s*:\s*hidden/.exec(css) ? "x" : "", /x/);
  assert.match(css, /min-height:\s*(4[4-9]|[5-9]\d|\d{3})px/);
  assert.match(css, /--rff-ar/);
});
