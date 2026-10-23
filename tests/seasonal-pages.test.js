"use strict";
const test = require("node:test");
const { assert, fs, path, JSDOM, DOCS, SCRIPT, engine, PAGES, load, windows, MOBILE } = require("./helpers");

test("initialization decorates every public page (cards, sections, headings, header, footer)", () => {
  for (const p of PAGES) {
    const w = load(p);
    const d = w.document;
    assert.ok(d.documentElement.getAttribute("data-season"), p + " season");
    assert.strictEqual(d.querySelectorAll(".sx-layer").length, 2, p);
    assert.strictEqual(d.querySelectorAll("button.sx-toggle, .sx-toggle-bar").length, 0, p + " no switch");
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
