"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "docs/js/donation-contract-status.js"),
  "utf8"
);

const owner = "0x0540e1dA908D032D2F74D50C06397cB5f2cbfDdB";

function createPage({ rpcFailure = false, currentOwner = owner } = {}) {
  const dom = new JSDOM(
    '<article class="crypto-card"></article>',
    {
      url: "https://recoveryforwardfoundation.org/support.html",
      runScripts: "outside-only"
    }
  );

  dom.window.fetch = async (url, options) => {
    if (String(url).includes(".json")) {
      return {
        ok: true,
        json: async () => [
          { type: "function", name: "owner" },
          { type: "function", name: "donateETH" }
        ]
      };
    }

    if (rpcFailure) throw new Error("RPC unavailable");

    const request = JSON.parse(options.body);

    let result;

    if (request.method === "eth_chainId") {
      result = "0x1";
    } else if (request.method === "eth_getCode") {
      result = "0x6000";
    } else if (request.method === "eth_call") {
      result = "0x" + currentOwner.slice(2).padStart(64, "0");
    } else {
      throw new Error("Unexpected RPC method");
    }

    return {
      ok: true,
      json: async () => ({ result })
    };
  };

  dom.window.eval(source);
  return dom;
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test("donation pages load contract verification", () => {
  for (const page of ["index.html", "support.html"]) {
    const html = fs.readFileSync(
      path.join(root, "docs", page),
      "utf8"
    );

    assert.match(html, /donation-contract-status\.js/);
    assert.match(html, /crypto-card/);
  }
});

test("correct owner displays verification status", async () => {
  const dom = createPage();
  await settle();

  const status = dom.window.document.querySelector(
    '.crypto-card [role="status"]'
  );

  assert.match(status.textContent, /confirmed on-chain/);
  dom.window.close();
});

test("changed owner produces a warning", async () => {
  const dom = createPage({
    currentOwner: "0x1111111111111111111111111111111111111111"
  });

  await settle();

  const status = dom.window.document.querySelector(
    '.crypto-card [role="status"]'
  );

  assert.match(status.textContent, /ownership has changed/);
  dom.window.close();
});

test("RPC failure never claims verification", async () => {
  const dom = createPage({ rpcFailure: true });
  await settle();

  const status = dom.window.document.querySelector(
    '.crypto-card [role="status"]'
  );

  assert.match(status.textContent, /verification unavailable/);
  dom.window.close();
});
