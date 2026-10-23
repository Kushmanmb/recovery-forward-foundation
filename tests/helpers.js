"use strict";
const { afterEach, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const DOCS = path.join(__dirname, "..", "docs");
const SCRIPT = fs.readFileSync(path.join(DOCS, "js", "seasonal-theme.js"), "utf8");
const engine = require(path.join(DOCS, "js", "seasonal-theme.js"));
const ALL_PAGES = fs.readdirSync(DOCS).filter((f) => f.endsWith(".html"));
const PAGES = process.env.RFF_PAGE ? ALL_PAGES.filter((f) => f === process.env.RFF_PAGE) : ALL_PAGES;

const windows = [];
const cache = new Map();
afterEach(() => { while (windows.length) windows.pop().close(); });
after(() => { for (const w of cache.values()) w.close(); cache.clear(); });

function build(page, search, width, errors) {
  const html = fs.readFileSync(path.join(DOCS, page), "utf8").replace(/<script[^>]*src=[^>]*><\/script>/g, "");
  const dom = new JSDOM(html, { url: "https://example.org/" + page + search, pretendToBeVisual: true });
  const w = dom.window;
  Object.defineProperty(w, "innerWidth", { value: width, configurable: true });
  w.matchMedia = (q) => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  if (errors) w.addEventListener("error", (e) => errors.push(e.message));
  engine.init(w.document, w);
  return w;
}

/* The engine is required directly (no script eval) because evaluating it inside each
   JSDOM context leaks several MB per window. JSDOM windows are expensive, so only the current page is kept parsed and
   re-themed in place with the engine's own applySeason; pass fresh:true for a new window. */
function load(page, { search = "", width = 1024, errors = null, fresh = false } = {}) {
  if (fresh) {
    const w = build(page, search, width, errors);
    windows.push(w);
    return w;
  }
  let w = cache.get(page);
  if (!w) {
    for (const old of cache.values()) old.close();
    cache.clear();
    if (global.gc) global.gc();
    w = build(page, search, width, errors);
    cache.set(page, w);
    return w;
  }
  Object.defineProperty(w, "innerWidth", { value: width, configurable: true });
  if (errors) w.addEventListener("error", (e) => errors.push(e.message));
  const season = engine.getSeason(new Date(), search);
  engine.applySeason(w.document, w, season, w.document.__rffSeasonalState);
  return w;
}

module.exports = { assert: require("node:assert"), fs, path, JSDOM, DOCS, SCRIPT, engine, PAGES, ALL_PAGES, load, windows, MOBILE: 375 };
