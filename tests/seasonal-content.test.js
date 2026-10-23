"use strict";
const test = require("node:test");
const { assert, fs, path, JSDOM, DOCS, SCRIPT, engine, PAGES, load, windows, MOBILE } = require("./helpers");

test("decorations never alter existing content, links or forms", () => {
  for (const p of PAGES) {
    const rawWin = new JSDOM(fs.readFileSync(path.join(DOCS, p), "utf8").replace(/<script[^>]*src=[^>]*><\/script>/g, "")).window;
    windows.push(rawWin);
    const raw = rawWin.document;
    const w = load(p);
    const d = w.document;
    const clean = d.documentElement.cloneNode(true);
    clean.querySelectorAll(".sx-deco, .sx-layer").forEach((n) => n.remove());
    assert.strictEqual(clean.querySelectorAll("a").length, raw.querySelectorAll("a").length, p);
    assert.strictEqual(clean.querySelectorAll("form, input, textarea, select, button").length,
      raw.querySelectorAll("form, input, textarea, select, button").length, p);
    assert.strictEqual(clean.querySelector("body").textContent.replace(/\s+/g, ""), raw.body.textContent.replace(/\s+/g, ""), p);
    assert.strictEqual(d.querySelectorAll("a .sx-deco, button .sx-deco").length, 0, p);
  }
});
