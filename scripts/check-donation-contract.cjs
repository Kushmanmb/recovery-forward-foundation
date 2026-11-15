"use strict";

const { createPublicClient, http } = require("viem");
const { mainnet } = require("viem/chains");
const {
  RecoveryForwardDonationsAbi: abi
} = require("@gitmyabi/recoveryforwarddonations");

const address = "0xFFb9CB3011C63d09b5a4901d54f8bfAAB2C02abe";
const expectedOwner = "0x0540e1dA908D032D2F74D50C06397cB5f2cbfDdB";

const client = createPublicClient({
  chain: mainnet,
  transport: http("https://ethereum-rpc.publicnode.com")
});

async function main() {
  const code = await client.getBytecode({ address });

  if (!code || code === "0x") {
    throw new Error("No deployed contract code found");
  }

  const owner = await client.readContract({
    address,
    abi,
    functionName: "owner"
  });

  const pendingOwner = await client.readContract({
    address,
    abi,
    functionName: "pendingOwner"
  });

  const acceptsDirectETH = abi.some(
    item => item.type === "receive"
  );

  console.log("Network: Ethereum Mainnet");
  console.log("Contract code: PRESENT");
  console.log("Current owner:", owner);
  console.log("Expected owner matches:",
    owner.toLowerCase() === expectedOwner.toLowerCase()
  );
  console.log("Pending owner:", pendingOwner);
  console.log("ABI declares receive():", acceptsDirectETH);
  console.log("Contract read-only checks: PASSED");
}

main().catch(error => {
  console.error("Contract check failed:", error.message);
  process.exitCode = 1;
});
