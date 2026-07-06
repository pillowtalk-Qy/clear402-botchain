#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(root, "..");
const artifactPath = resolve(root, "artifacts/ServiceEscrow.json");

const required = ["BOTCHAIN_RPC_URL", "BOTCHAIN_DEPLOYER_PRIVATE_KEY"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing required env: ${missing.join(", ")}`);
  console.error("Run pnpm contracts:compile, then export BOTCHAIN_RPC_URL and BOTCHAIN_DEPLOYER_PRIVATE_KEY.");
  process.exit(1);
}

let artifact;
try {
  artifact = JSON.parse(await readFile(artifactPath, "utf8"));
} catch {
  console.error(`Missing artifact: ${artifactPath}`);
  console.error("Run pnpm contracts:compile before deploying.");
  process.exit(1);
}

const bytecode = artifact.bytecode?.object ?? artifact.bytecode;
if (typeof bytecode !== "string" || !/^0x[0-9a-fA-F]+$/.test(bytecode)) {
  console.error("Artifact bytecode must be a 0x-prefixed hex string.");
  process.exit(1);
}

const { createPublicClient, createWalletClient, defineChain, http } = await import("viem");
const { privateKeyToAccount } = await import("viem/accounts");

const rpcUrl = process.env.BOTCHAIN_RPC_URL;
const chainId = Number.parseInt(process.env.BOTCHAIN_CHAIN_ID ?? "968", 10);
const explorerBaseUrl = process.env.BOTCHAIN_EXPLORER_BASE_URL ?? "https://scan.bohr.life";
const chainName = process.env.BOTCHAIN_CHAIN_NAME ?? "BOT Chain Testnet";
const evidenceDir = resolve(repoRoot, process.env.BOTCHAIN_EVIDENCE_DIR ?? "evidence/botchain");

const botChain = defineChain({
  id: chainId,
  name: chainName,
  nativeCurrency: {
    decimals: 18,
    name: "BOT",
    symbol: "BOT"
  },
  rpcUrls: {
    default: {
      http: [rpcUrl]
    }
  },
  blockExplorers: {
    default: {
      name: "BOT Chain Explorer",
      url: explorerBaseUrl
    }
  }
});

const account = privateKeyToAccount(process.env.BOTCHAIN_DEPLOYER_PRIVATE_KEY);
const publicClient = createPublicClient({
  chain: botChain,
  transport: http(rpcUrl)
});
const walletClient = createWalletClient({
  account,
  chain: botChain,
  transport: http(rpcUrl)
});

const txHash = await walletClient.deployContract({
  abi: artifact.abi,
  bytecode
});
const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

const result = {
  project: "clear402-botchain",
  contract: "ServiceEscrow",
  network: chainName,
  chainId,
  evidenceMode: "live",
  deployer: account.address,
  txHash,
  contractAddress: receipt.contractAddress,
  blockNumber: receipt.blockNumber?.toString(),
  status: receipt.status,
  explorer: `${explorerBaseUrl.replace(/\/$/, "")}/tx/${txHash}`,
  recordedAt: new Date().toISOString()
};

await mkdir(evidenceDir, { recursive: true });
await writeFile(
  resolve(evidenceDir, "service-escrow-deploy.latest.json"),
  `${JSON.stringify(result, null, 2)}\n`
);

console.log(JSON.stringify(result, null, 2));
