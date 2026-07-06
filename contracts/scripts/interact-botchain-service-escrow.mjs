#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(root, "..");
const abiPath = resolve(root, "abi/ServiceEscrow.json");

const action = process.argv[2] ?? "fund";
if (!["fund", "deliver", "refund", "read"].includes(action)) {
  console.error("Usage: pnpm botchain:escrow <fund|deliver|refund|read>");
  process.exit(1);
}

const required = ["BOTCHAIN_RPC_URL", "BOTCHAIN_DEPLOYER_PRIVATE_KEY", "BOTCHAIN_SERVICE_ESCROW_ADDRESS"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing required env: ${missing.join(", ")}`);
  process.exit(1);
}

const { createPublicClient, createWalletClient, defineChain, http, isAddress, isHex, parseEther } = await import("viem");
const { privateKeyToAccount } = await import("viem/accounts");

const abi = JSON.parse(await readFile(abiPath, "utf8"));
const rpcUrl = process.env.BOTCHAIN_RPC_URL;
const chainId = Number.parseInt(process.env.BOTCHAIN_CHAIN_ID ?? "968", 10);
const explorerBaseUrl = process.env.BOTCHAIN_EXPLORER_BASE_URL ?? "https://scan.bohr.life";
const chainName = process.env.BOTCHAIN_CHAIN_NAME ?? "BOT Chain Testnet";
const contractAddress = process.env.BOTCHAIN_SERVICE_ESCROW_ADDRESS;
const paymentContextHash = process.env.BOTCHAIN_PAYMENT_CONTEXT_HASH;
const providerAddress = process.env.BOTCHAIN_PROVIDER_ADDRESS;
const amountBot = process.env.BOTCHAIN_ESCROW_AMOUNT_BOT ?? "0.000001";
const evidenceDir = resolve(repoRoot, process.env.BOTCHAIN_EVIDENCE_DIR ?? "evidence/botchain");

if (!isAddress(contractAddress)) {
  console.error("BOTCHAIN_SERVICE_ESCROW_ADDRESS must be a valid EVM address.");
  process.exit(1);
}
if (!paymentContextHash || !isHex(paymentContextHash, { strict: true }) || paymentContextHash.length !== 66) {
  console.error("BOTCHAIN_PAYMENT_CONTEXT_HASH must be a 32-byte 0x-prefixed hex string.");
  process.exit(1);
}

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

async function writeEvidence(payload) {
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    resolve(evidenceDir, `service-escrow-${action}.latest.json`),
    `${JSON.stringify(payload, null, 2)}\n`
  );
}

if (action === "read") {
  const escrow = await publicClient.readContract({
    address: contractAddress,
    abi,
    functionName: "escrows",
    args: [paymentContextHash]
  });
  const result = {
    project: "clear402-botchain",
    contract: "ServiceEscrow",
    network: chainName,
    chainId,
    evidenceMode: "live",
    action,
    contractAddress,
    paymentContextHash,
    escrow: {
      payer: escrow[0],
      provider: escrow[1],
      amount: escrow[2].toString(),
      state: Number(escrow[3])
    },
    recordedAt: new Date().toISOString()
  };
  await writeEvidence(result);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

let txHash;
if (action === "fund") {
  const selectedProvider = providerAddress || account.address;
  if (!isAddress(selectedProvider)) {
    console.error("BOTCHAIN_PROVIDER_ADDRESS must be a valid EVM address when provided.");
    process.exit(1);
  }
  const amountWei = parseEther(amountBot);
  txHash = await walletClient.writeContract({
    address: contractAddress,
    abi,
    functionName: "fund",
    args: [paymentContextHash, selectedProvider, amountWei],
    value: amountWei
  });
} else {
  txHash = await walletClient.writeContract({
    address: contractAddress,
    abi,
    functionName: action,
    args: [paymentContextHash]
  });
}

const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
const result = {
  project: "clear402-botchain",
  contract: "ServiceEscrow",
  network: chainName,
  chainId,
  evidenceMode: "live",
  action,
  actor: account.address,
  contractAddress,
  paymentContextHash,
  amountBot: action === "fund" ? amountBot : undefined,
  txHash,
  blockNumber: receipt.blockNumber?.toString(),
  status: receipt.status,
  explorer: `${explorerBaseUrl.replace(/\/$/, "")}/tx/${txHash}`,
  recordedAt: new Date().toISOString()
};

await writeEvidence(result);
console.log(JSON.stringify(result, null, 2));
