"use strict";
const test = require("node:test");
const { assert, fs, path, DOCS, PAGES, load, MOBILE } = require("./helpers");

const TEXT = "Matthewbrace@RecoveryForwardFoundation.org";
const HREF = "mailto:matthewbrace@recoveryforwardfoundation.org";

for (const page of PAGES) {
  test(page + ": founder signature stays exact and footer logo follows every season", () => {
    for (const search of ["", "?season=october", "?season=november", "?season=december"]) {
      const d = load(page, { search, width: MOBILE }).document;
      const sigs = d.querySelectorAll(".founder-signature");
      assert.strictEqual(sigs.length, 1);
      const sig = sigs[0];
      assert.strictEqual(sig.querySelector(".signature-text").textContent, TEXT);
      assert.strictEqual(sig.querySelector(".signature-text a").getAttribute("href"), HREF);
      assert.strictEqual(sig.parentNode, d.body);
      const footer = d.querySelector("footer");
      if (footer) assert.ok(footer.compareDocumentPosition(sig) & 4, "after the footer");
      const logos = d.querySelectorAll(".footer-logo");
      assert.strictEqual(logos.length, 1);
      const logo = logos[0];
      assert.strictEqual(logo.parentNode, d.body);
      assert.strictEqual(sig.nextElementSibling, logo, "logo immediately after signature");
      const image = logo.querySelector("img");
      assert.strictEqual(image.getAttribute("src"), "/assets/logo/rff-footer-logo.png");
      assert.strictEqual(image.getAttribute("alt"), "Recovery Forward Foundation logo");
      const later = [...d.body.children].slice([...d.body.children].indexOf(logo) + 1);
      assert.ok(later.every((n) => /^(SCRIPT|DIV)$/.test(n.tagName) && (n.tagName === "SCRIPT" || n.classList.contains("sx-layer"))), "nothing visible after logo");
      assert.ok(!sig.closest("[data-sx]"), "not decorated or covered by seasonal art");
    }
  });
}

test("footer logo CSS: responsive sizing and no decoration", () => {
  const css = fs.readFileSync(path.join(DOCS, "css", "style.css"), "utf8");
  assert.match(css, /\.footer-logo img \{[^}]*width: 75px;[^}]*height: auto;/);
  assert.match(css, /@media \(max-width: 700px\) \{[^}]*\.footer-logo img \{\s*width: 60px;/);
  assert.ok(!/\.footer-logo(?: img)? \{[^}]*(?:background|border|filter|animation):/.test(css));
});

test("signature CSS: clamp sizing, wrapping, cursive, flourish, reduced motion, no external fonts", () => {
  const css = fs.readFileSync(path.join(DOCS, "css", "style.css"), "utf8");
  assert.match(css, /\.signature-text \{[^}]*font-size: clamp\(/);
  assert.match(css, /\.signature-text \{[^}]*overflow-wrap: anywhere/);
  assert.match(css, /\.signature-text \{[^}]*cursive;/);
  assert.match(css, /\.signature-flourish \{/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.signature-text \{ animation: none; \}/);
  assert.ok(!/@import|fonts\.googleapis/.test(css));
});
