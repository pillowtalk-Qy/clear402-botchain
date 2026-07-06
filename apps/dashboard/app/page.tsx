export const dynamic = "force-dynamic";

import { headers } from "next/headers";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { DashboardShell } from "./dashboard-shell";
import {
  createInitialWorkspace,
  type BotChainSettlementState,
  type DashboardPreset,
  type HealthSnapshot
} from "./dashboard-data";

const runtimeHealthUrl =
  process.env.RUNTIME_HEALTH_URL ?? "http://127.0.0.1:4000/health";
const providerHealthUrl =
  process.env.PROVIDER_X402_HEALTH_URL ?? "http://127.0.0.1:4010/health";

async function fetchHealth(endpoint: string, service: string): Promise<HealthSnapshot> {
  try {
    const response = await fetch(endpoint, {
      cache: "no-store",
      signal: AbortSignal.timeout(1_500)
    });
    const payload = (await response.json()) as Partial<HealthSnapshot>;

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return {
      service: payload.service ?? service,
      status: payload.status === "ok" ? "ok" : "down",
      evidenceMode: (payload.evidenceMode ?? "live") as HealthSnapshot["evidenceMode"],
      timestamp: payload.timestamp ?? new Date().toISOString(),
      version: payload.version ?? "unknown",
      details: payload.details ?? {},
      endpoint
    };
  } catch (error) {
    return {
      service,
      status: "down",
      evidenceMode: "fallback",
      timestamp: new Date().toISOString(),
      version: "unavailable",
      details: { fallbackReason: "runtime API unavailable" },
      endpoint,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

function resolvePreset(value: string | undefined): DashboardPreset {
  if (value === "investigate" || value === "attack" || value === "evidence") {
    return value;
  }

  return "demo";
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeExplorerBase(value: string | undefined) {
  return value ?? process.env.BOTCHAIN_EXPLORER_BASE_URL ?? "https://scan.bohr.life";
}

async function readJsonFile(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

async function loadBotChainEvidence(): Promise<Partial<BotChainSettlementState> | undefined> {
  const evidenceDirs = [
    join(process.cwd(), "evidence", "botchain"),
    join(process.cwd(), "..", "..", "evidence", "botchain")
  ];
  let deploy: Record<string, unknown> | undefined;
  let fund: Record<string, unknown> | undefined;
  let deliver: Record<string, unknown> | undefined;
  let refund: Record<string, unknown> | undefined;

  for (const evidenceDir of evidenceDirs) {
    [deploy, fund, deliver, refund] = await Promise.all([
      readJsonFile(join(evidenceDir, "service-escrow-deploy.latest.json")),
      readJsonFile(join(evidenceDir, "service-escrow-fund.latest.json")),
      readJsonFile(join(evidenceDir, "service-escrow-deliver.latest.json")),
      readJsonFile(join(evidenceDir, "service-escrow-refund.latest.json"))
    ]);

    if (deploy || fund || deliver || refund) {
      break;
    }
  }

  const interaction = deliver ?? refund ?? fund;
  if (!deploy && !interaction) {
    return undefined;
  }

  const explorerBaseUrl = normalizeExplorerBase(stringValue(deploy?.explorerBaseUrl) ?? stringValue(interaction?.explorerBaseUrl));
  const contractAddress =
    stringValue(deploy?.contractAddress) ??
    stringValue(interaction?.contractAddress) ??
    process.env.BOTCHAIN_SERVICE_ESCROW_ADDRESS;
  const deployTxHash = stringValue(deploy?.txHash);
  const interactionTxHash = stringValue(interaction?.txHash);
  const action = stringValue(interaction?.action);
  const paymentContextHash =
    stringValue(interaction?.paymentContextHash) ?? process.env.BOTCHAIN_PAYMENT_CONTEXT_HASH;
  const blockNumber = stringValue(interaction?.blockNumber) ?? stringValue(deploy?.blockNumber);
  const chainId =
    typeof deploy?.chainId === "number"
      ? String(deploy.chainId)
      : stringValue(deploy?.chainId) ?? stringValue(interaction?.chainId);

  return {
    network: stringValue(deploy?.network) ?? stringValue(interaction?.network) ?? "BOT Chain Testnet",
    chainId: chainId ?? "968",
    rpcUrl: process.env.BOTCHAIN_RPC_URL ?? "https://rpc.bohr.life",
    explorerBaseUrl,
    contractName: "ServiceEscrow",
    ...(contractAddress ? { contractAddress } : {}),
    ...(deployTxHash ? { deployTxHash } : {}),
    ...(interactionTxHash ? { interactionTxHash } : {}),
    ...(paymentContextHash ? { paymentContextHash } : {}),
    escrowAction:
      action === "deliver" || action === "refund" || action === "fund"
        ? action
        : interactionTxHash
          ? "fund"
          : "pending",
    settlementStatus: interactionTxHash ? "confirmed" : contractAddress ? "deployed" : "not_deployed",
    ...(blockNumber ? { blockNumber } : {}),
    explorerLinks: {
      ...(contractAddress ? { contract: `${explorerBaseUrl.replace(/\/$/, "")}/address/${contractAddress}` } : {}),
      ...(deployTxHash ? { deployTx: `${explorerBaseUrl.replace(/\/$/, "")}/tx/${deployTxHash}` } : {}),
      ...(interactionTxHash ? { interactionTx: `${explorerBaseUrl.replace(/\/$/, "")}/tx/${interactionTxHash}` } : {})
    },
    evidenceMode: interactionTxHash ? "live" : "fallback",
    note: interactionTxHash
      ? "Live BOT Chain testnet escrow evidence was loaded from evidence/botchain."
      : "BOT Chain deployment evidence exists, but an escrow interaction tx is still required for live settlement claim."
  };
}

export default async function Page() {
  const requestHeaders = await headers();
  const preset = resolvePreset(requestHeaders.get("x-clear402-dashboard-preset") ?? undefined);
  const [runtime, provider, botChainEvidence] = await Promise.all([
    fetchHealth(runtimeHealthUrl, "runtime"),
    fetchHealth(providerHealthUrl, "provider-x402"),
    loadBotChainEvidence()
  ]);

  const initialWorkspace = createInitialWorkspace({
    runtime,
    provider,
    preset,
    ...(botChainEvidence ? { botChainEvidence } : {})
  });

  return <DashboardShell initialWorkspace={initialWorkspace} runtime={runtime} provider={provider} />;
}
