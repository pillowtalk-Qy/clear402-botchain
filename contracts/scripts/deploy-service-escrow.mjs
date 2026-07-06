#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactPath = resolve(root, "artifacts/ServiceEscrow.json");

const required = ["SEPOLIA_RPC_URL", "DEPLOYER_PRIVATE_KEY"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing required env: ${missing.join(", ")}`);
  console.error("Compile contracts/ServiceEscrow.sol first, then set SEPOLIA_RPC_URL and DEPLOYER_PRIVATE_KEY.");
  process.exit(1);
}

let artifact;
try {
  artifact = JSON.parse(await readFile(artifactPath, "utf8"));
} catch {
  console.error(`Missing artifact: ${artifactPath}`);
  console.error("Expected JSON with a bytecode field, for example from solc or Foundry output.");
  process.exit(1);
}

const bytecode = artifact.bytecode?.object ?? artifact.bytecode;
if (typeof bytecode !== "string" || !/^0x[0-9a-fA-F]+$/.test(bytecode)) {
  console.error("Artifact bytecode must be a 0x-prefixed hex string.");
  process.exit(1);
}

const { createWalletClient, http } = await import("viem");
const { privateKeyToAccount } = await import("viem/accounts");
const { sepolia } = await import("viem/chains");

const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);
const client = createWalletClient({
  account,
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL)
});

const hash = await client.deployContract({
  abi: JSON.parse(await readFile(resolve(root, "abi/ServiceEscrow.json"), "utf8")),
  bytecode
});

console.log(JSON.stringify({
  contract: "ServiceEscrow",
  chain: "sepolia",
  deployer: account.address,
  txHash: hash
}, null, 2));
