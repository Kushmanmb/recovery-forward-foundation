"use strict";
const test = require("node:test");
const { assert, fs, path, DOCS, PAGES, load, MOBILE } = require("./helpers");

const TEXT = "Matthewbrace@RecoveryForwardFoundation.org";
const HREF = "mailto:matthewbrace@recoveryforwardfoundation.org";

for (const page of PAGES) {
  test(page + ": founder signature is last, exact, and survives every season", () => {
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
      const later = [...d.body.children].slice([...d.body.children].indexOf(sig) + 1);
      assert.ok(later.every((n) => /^(SCRIPT|DIV)$/.test(n.tagName) && (n.tagName === "SCRIPT" || n.classList.contains("sx-layer"))), "nothing visible after it");
      assert.ok(!sig.closest("[data-sx]"), "not decorated or covered by seasonal art");
    }
  });
}

test("signature CSS: clamp sizing, wrapping, cursive, flourish, reduced motion, no external fonts", () => {
  const css = fs.readFileSync(path.join(DOCS, "css", "style.css"), "utf8");
  assert.match(css, /\.signature-text \{[^}]*font-size: clamp\(/);
  assert.match(css, /\.signature-text \{[^}]*overflow-wrap: anywhere/);
  assert.match(css, /\.signature-text \{[^}]*cursive;/);
  assert.match(css, /\.signature-flourish \{/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.signature-text \{ animation: none; \}/);
  assert.ok(!/@import|fonts\.googleapis/.test(css));
});
