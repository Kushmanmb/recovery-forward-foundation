"use strict";
const test = require("node:test");
const { assert, fs, path, JSDOM, DOCS, SCRIPT, engine, PAGES, load, windows, MOBILE } = require("./helpers");

test("hero and sections carry only thin edge accents, never corner art or text", () => {
  for (const season of ["october", "december", "november"]) {
    const d = load("index.html", { search: "?season=" + season, width: MOBILE }).document;
    for (const sec of d.querySelectorAll(".sx-section-deco")) {
      assert.strictEqual(sec.querySelectorAll(".sx-m, .sx-pumpkin, .sx-ghost, .sx-spiderbox, .sx-orn").length, 0);
      assert.ok(sec.textContent.trim() === "" || /^[\s\S]{0,0}$/.test(sec.textContent.trim()));
    }
  }
});

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
