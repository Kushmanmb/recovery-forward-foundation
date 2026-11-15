(async function () {
  "use strict";

  const address = "0xFFb9CB3011C63d09b5a4901d54f8bfAAB2C02abe";
  const owner = "0x0540e1dA908D032D2F74D50C06397cB5f2cbfDdB";

  const cards = document.querySelectorAll(".crypto-card");
  if (!cards.length) return;

  const indicators = Array.from(cards, card => {
    const status = document.createElement("p");
    status.className = "crypto-note";
    status.setAttribute("role", "status");
    status.textContent = "Checking Ethereum contract...";
    card.appendChild(status);

    const link = document.createElement("a");
    link.href = "https://etherscan.io/address/" + address + "#code";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "View contract on Etherscan";
    card.appendChild(link);

    return status;
  });

  function report(message) {
    indicators.forEach(el => {
      el.textContent = message;
    });
  }

  async function rpc(method, params) {
    const response = await fetch(
      "https://ethereum-rpc.publicnode.com",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params
        })
      }
    );

    if (!response.ok) throw new Error("RPC unavailable");

    const result = await response.json();
    if (result.error || typeof result.result !== "string") {
      throw new Error("Invalid RPC result");
    }

    return result.result;
  }

  try {
    const response = await fetch(
      "abi/recoveryforwarddonations.json"
    );

    if (!response.ok) throw new Error("ABI unavailable");

    const abi = await response.json();

    if (!Array.isArray(abi) ||
        !abi.some(x => x.type === "function" && x.name === "owner") ||
        !abi.some(x => x.type === "function" && x.name === "donateETH")) {
      throw new Error("Unexpected contract interface");
    }

    const [chainId, code, encodedOwner] = await Promise.all([
      rpc("eth_chainId", []),
      rpc("eth_getCode", [address, "latest"]),
      rpc("eth_call", [
        { to: address, data: "0x8da5cb5b" },
        "latest"
      ])
    ]);

    if (chainId !== "0x1" ||
        !code || code === "0x" ||
        !/^0x[0-9a-fA-F]{64}$/.test(encodedOwner)) {
      throw new Error("Contract verification failed");
    }

    const currentOwner = "0x" + encodedOwner.slice(-40);

    if (currentOwner.toLowerCase() !== owner.toLowerCase()) {
      report("Contract ownership has changed. Verify on Etherscan.");
      return;
    }

    report(
      "Ethereum contract code and current owner confirmed on-chain. " +
      "This does not constitute a security audit."
    );
  } catch {
    report(
      "Automatic verification unavailable. " +
      "Review the contract on Etherscan before donating."
    );
  }
})();
