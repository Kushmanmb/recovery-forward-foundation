"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  RecoveryForwardDonationsAbi
} = require("@gitmyabi/recoveryforwarddonations");

if (!Array.isArray(RecoveryForwardDonationsAbi)) {
  throw new Error("GitMyABI did not export a valid ABI array");
}

const functions = RecoveryForwardDonationsAbi
  .filter(item => item.type === "function")
  .map(item => ({
    name: item.name,
    access: item.stateMutability
  }));

const output = path.join(
  __dirname,
  "..",
  "docs",
  "abi",
  "recoveryforwarddonations.json"
);

fs.mkdirSync(path.dirname(output), {
  recursive: true
});

fs.writeFileSync(
  output,
  JSON.stringify(RecoveryForwardDonationsAbi, null, 2) + "\n"
);

console.log("ABI exported successfully:", output);
console.table(functions);
