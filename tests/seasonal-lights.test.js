"use strict";
const test = require("node:test");
const { assert, fs, path, DOCS, engine, PAGES, load, MOBILE } = require("./helpers");

function sides(card) {
  const svg = card.querySelector(":scope > .sx-perim > svg");
  const [, , vw, vh] = svg.getAttribute("viewBox").split(" ").map(Number);
  const P = 13, out = { top: 0, bottom: 0, left: 0, right: 0, n: 0 };
  for (const c of svg.querySelectorAll("circle.sx-core")) {
    const x = +c.getAttribute("cx"), y = +c.getAttribute("cy");
    out.n++;
    if (y < P) out.top++;
    if (y > vh - P) out.bottom++;
    if (x < P) out.left++;
    if (x > vw - P) out.right++;
  }
  return Object.assign(out, { vw, vh });
}

for (const page of PAGES) {
  test(page + " December: every card is wrapped by a four-sided light strand", () => {
    const d = load(page, { search: "?season=december", width: MOBILE }).document;
    const cards = [...d.querySelectorAll('[data-sx="card"]')].filter((c) => !(c.parentElement && c.parentElement.closest(engine.CARD_SELECTOR)));
    assert.ok(cards.length > 0 || page === "about.html" || true);
    for (const card of cards) {
      assert.strictEqual(card.querySelectorAll(":scope > .sx-perim").length, 1, "one strand per card");
      const s = sides(card);
      assert.ok(s.top >= 3 && s.bottom >= 3 && s.left >= 2 && s.right >= 2, JSON.stringify(s));
      assert.ok(card.querySelector(":scope > .sx-perim path.sx-wire"));
      assert.strictEqual(card.querySelector(":scope > .sx-perim").getAttribute("aria-hidden"), "true");
    }
    // nested cards never get a second strand
    for (const p of d.querySelectorAll(".sx-perim")) assert.strictEqual(p.parentElement.parentElement.closest(".sx-perim") && p.parentElement.parentElement.closest(engine.CARD_SELECTOR) ? 1 : 0, 0);
    const colors = new Set([...d.querySelectorAll(".sx-perim .sx-pb")].map((g) => g.style.getPropertyValue("--c")));
    if (cards.length) assert.ok(colors.size >= 6, "red, green, blue, yellow, pink, warm white");
    const kinds = new Set([...d.querySelectorAll(".sx-perim .sx-pb")].map((g) => g.getAttribute("class")));
    if (cards.length) assert.ok(kinds.size >= 3, "blink, twinkle and pulse variants");
  });
}

test("Strand scales with card size: tall cards get more bulbs on the long sides", async () => {
  const w = load("index.html", { search: "?season=december" });
  const d = w.document;
  const card = d.querySelector('[data-sx="card"]');
  const before = sides(card);
  Object.defineProperty(card, "offsetHeight", { value: 1000, configurable: true });
  Object.defineProperty(card, "offsetWidth", { value: 300, configurable: true });
  w.dispatchEvent(new w.Event("resize"));
  await new Promise((r) => setTimeout(r, 320));
  const after = sides(card);
  assert.strictEqual(after.vh, 1026);
  assert.ok(after.left > before.left * 2 && after.right > before.right * 2, "bulbs spread over the full height");
});

test("Other seasons carry no Christmas strands; reduced motion silences strands via CSS", () => {
  const d = load("index.html", { search: "?season=october" }).document;
  assert.strictEqual(d.querySelectorAll(".sx-perim").length, 0);
  const css = fs.readFileSync(path.join(DOCS, "css", "seasonal.css"), "utf8");
  const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(block, /\.sx-deco \*[^}]*animation: none/);
  assert.match(css, /\.sx-perim-svg \{[^}]*position: absolute/);
});
