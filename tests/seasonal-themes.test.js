"use strict";
const test = require("node:test");
const { assert, fs, path, JSDOM, DOCS, SCRIPT, engine, PAGES, load, windows, MOBILE } = require("./helpers");

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

test("dynamically generated cards are decorated", async () => {
  const w = load("index.html", { fresh: true });
  const d = w.document;
  const card = d.createElement("article");
  card.className = "portal-card";
  card.textContent = "New";
  d.body.appendChild(card);
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(card.querySelector(":scope > .sx-deco .sx-glow"));
});

test("re-applying a season is idempotent and swaps decorations", () => {
  const w = load("about.html", { search: "?season=october", fresh: true });
  const d = w.document;
  const before = d.querySelectorAll(".sx-card-deco").length;
  const st = d.__rffSeasonalState;
  engine.applySeason(d, w, engine.SEASONS[11], st);
  assert.strictEqual(d.querySelectorAll(".sx-card-deco").length, before);
  assert.strictEqual(d.querySelectorAll(".sx-layer").length, 2);
  assert.strictEqual(d.documentElement.getAttribute("data-season"), "december");
  assert.strictEqual(d.querySelectorAll(".sx-witch").length, 0);
});

test("mobile: no side/bottom light rails", () => {
  const d = load("support.html", { search: "?season=december", width: MOBILE }).document;
  assert.strictEqual(d.querySelectorAll(".sx-edge-left, .sx-edge-right, .sx-edge-bottom").length, 0);
  assert.strictEqual(d.querySelectorAll(".sx-edge-top").length, 1);
  const wide = load("support.html", { search: "?season=december", width: 1280 }).document;
  assert.strictEqual(wide.querySelectorAll(".sx-edge-left, .sx-edge-right").length, 2);
});
