"use strict";
const test = require("node:test");
const { assert, fs, path, JSDOM, DOCS, SCRIPT, engine, PAGES, load, windows, MOBILE } = require("./helpers");

test("Jan-Sep themes each decorate every page", () => {
  for (let m = 1; m <= 9; m++) {
    const d = load("index.html", { search: "?season=" + m }).document;
    assert.strictEqual(d.documentElement.getAttribute("data-season"), engine.MONTH_NAMES[m - 1]);
    for (const c of d.querySelectorAll(engine.CARD_SELECTOR)) assert.ok(c.querySelector(":scope > .sx-deco .sx-m"), "month " + m);
    assert.ok(d.querySelector(".sx-particles .sx-p"));
  }
});
