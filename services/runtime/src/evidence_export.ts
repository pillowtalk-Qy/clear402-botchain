import type { DatabaseSync } from "node:sqlite";

import type {
  EvidenceMode,
  GuardDecision,
  ReceiptStatus
} from "../../../packages/shared/src/index.mjs";
import { canonicalJson, hashObject } from "./guard/hash.ts";

export type EvidenceExportFormat = "json" | "md";
export type EvidenceExportSource = "runtime_db" | "demo_fixture";

export interface BuildEvidenceExportOptions {
  now?: number;
  capabilityReport?: unknown;
}

export interface EvidenceExportResult {
  found: boolean;
  export?: EvidenceExport;
}

export interface EvidenceExport {
  version: "clear402.evidence-export.v1";
  generatedAt: number;
  generatedAtIso: string;
  missionId: string;
  source: EvidenceExportSource;
  evidenceMode: EvidenceMode;
  evidenceModeSummary: {
    overall: EvidenceMode;
    counts: Record<EvidenceMode, number>;
    components: Array<{
      component: string;
      evidenceMode: EvidenceMode;
      note?: string;
    }>;
  };
  mission: MissionFacts;
  providerChallenge: ProviderChallengeFacts;
  erc8004Trust: ERC8004TrustFacts | MissingFacts;
  paymentContext: PaymentContextFacts | MissingFacts;
  guard: GuardFacts;
  botChainSettlement: BotChainSettlementFacts;
  cawCapabilitySummary: CawCapabilitySummary;
  serviceReceipt: ServiceReceiptFacts | MissingFacts;
  dualReceipt?: DualReceiptFacts | MissingFacts;
  attackLabSummary?: AttackLabSummary;
  limitations: {
    notes: string[];
    claimsAllowed: string[];
    claimsForbidden: string[];
  };
}

interface MissionFacts {
  id: string;
  status: string;
  budgetUsd?: string;
  userPromptSummary?: string;
  cawWalletAddressPresent: boolean;
  pactIdPresent: boolean;
  createdAt?: number;
  updatedAt?: number;
  evidenceMode: EvidenceMode;
}

interface ProviderChallengeFacts {
  provider: {
    providerId?: string;
    origin?: string;
    merchantAddress?: string;
    facilitatorUrlHash?: string;
    chainId?: string;
    tokenId?: string;
    publicKeyHash?: string;
    allowedResourceCount?: number;
    cawAllowlistStatus?: string;
    erc8004AgentId?: string;
    erc8004AgentUri?: string;
    reputationThreshold?: string;
    validationTags?: string[];
  };
  challenge: {
    quoteId?: string;
    resourceUrl?: string;
    amount?: string;
    status?: string;
    rawChallengeHash?: string;
    scheme?: string;
    network?: string;
    asset?: string;
    payTo?: string;
    facilitatorUrlHash?: string;
    descriptionPresent?: boolean;
    expiresAt?: number;
    evidenceMode: EvidenceMode;
  };
  evidenceMode: EvidenceMode;
}

interface ERC8004TrustFacts {
  status: "recorded";
  agentId: string;
  trustSource: "live_erc8004" | "demo_erc8004" | "unavailable";
  registrationStatus: "registered" | "needs_registration" | "unavailable";
  decision: string;
  identityVerified: boolean;
  endpointMatches: boolean;
  payToMatches: boolean;
  reputationScore: number;
  demoFallbackUsed: boolean;
  liveSource?: {
    source?: string;
    status?: string;
    reference?: string;
    checkedAt?: number;
  };
  reason?: string;
  evidenceMode: EvidenceMode;
}

interface PaymentContextFacts {
  status: "recorded";
  paymentContextHash: string;
  version?: string;
  missionId: string;
  providerId: string;
  quoteId: string;
  method: string;
  origin: string;
  resourcePath: string;
  canonicalUrlHash: string;
  bodyHash: string;
  sanitizedResourceHash: string;
  merchantAddress: string;
  facilitatorUrlHash?: string;
  chainId: string;
  tokenId: string;
  amount: string;
  amountDecimals: number;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  quoteTermsHash: string;
  piiPolicyHash: string;
  clearSignDigest?: string;
  cawPactId: string;
  serviceMode: string;
  evidenceMode: EvidenceMode;
}

interface GuardFacts {
  decision: GuardDecision | "not_recorded";
  guardEventId: string | null;
  layer?: string;
  reason?: string;
  createdAt?: number;
  evidenceMode: EvidenceMode;
  eventCount: number;
  events: Array<{
    id: string;
    layer: string;
    decision: GuardDecision;
    reason?: string;
    createdAt: number;
    evidenceMode: EvidenceMode;
  }>;
}

interface BotChainSettlementFacts {
  status: "not_recorded" | "deployed" | "recorded";
  network: string;
  chainId: string;
  rpcLabel: string;
  explorerBaseUrl: string;
  contractName: "ServiceEscrow";
  contractAddress?: string;
  deploymentTxHash?: string;
  interactionTxHash?: string;
  paymentContextHash?: string;
  escrowAction?: "fund" | "deliver" | "refund";
  blockNumber?: string;
  explorerLinks: {
    contract?: string;
    deployTx?: string;
    interactionTx?: string;
  };
  evidenceMode: EvidenceMode;
  note: string;
}

interface ServiceReceiptFacts {
  status: "recorded";
  receiptId?: string;
  paymentContextHash?: string;
  cawRequestId?: string;
  cawWalletAddress?: string;
  pactId?: string;
  providerAddress?: string;
  resource?: string;
  asset?: string;
  serviceResultHash?: string;
  cawEvidenceRef?: string;
  fallbackEvidenceRef?: string;
  facilitatorUrlHash?: string;
  txHash?: string;
  coboTransactionId?: string;
  chainId?: string;
  tokenId?: string;
  amount?: string;
  providerResponseHash?: string;
  providerSignaturePresent: boolean;
  responseSchemaHash?: string;
  deliveryTimestamp?: number;
  receiptStatus?: ReceiptStatus | string;
  clearsigDigest?: string;
  auditLogIds: string[];
  redactionSummaryHash?: string;
  evidenceMode: EvidenceMode;
}

interface DualReceiptFacts {
  status: "recorded";
  evidenceMode: EvidenceMode;
  dualReceiptHash?: string;
  paymentReceiptHash?: string;
  deliveryReceiptHash?: string;
  verificationDecision?: string;
  verificationResult?: Record<string, unknown>;
}

interface MissingFacts {
  status: "not_recorded";
  evidenceMode: EvidenceMode;
  reason: string;
}

interface CawCapabilitySummary {
  source: "injected_runtime_report" | "recorded_scope_summary";
  evidenceMode: EvidenceMode;
  liveReady: boolean;
  summary: {
    verified: number;
    needsManualStep: number;
    unavailable: number;
    fallbackRequired: number;
  };
  records: Array<{
    capability: string;
    status: string;
    evidenceMode: EvidenceMode;
    notes?: string;
  }>;
  recordedScope: {
    allowPathTransfer: string;
    policyDenial: string;
    docs: string[];
  };
  rawEvidenceRefsOmitted: true;
  notes: string[];
}

interface AttackLabSummary {
  source: "guard_event" | "known_attack_mission" | "demo_fixture";
  evidenceMode: EvidenceMode;
  missionId: string;
  totalScenarios?: number;
  attack?: string;
  paper?: string;
  blockedBy?: string;
  evidenceAnchor?: string;
  decision?: string;
  guardEventId?: string | null;
  examples?: Array<{
    attack: string;
    blockedBy: string;
    evidenceMode: EvidenceMode;
  }>;
}

interface MissionRow {
  id: string;
  userPrompt: string;
  budgetUsd: string;
  status: string;
  cawWalletAddress: string | null;
  pactId: string | null;
  createdAt: number;
  updatedAt: number;
}

interface ProviderContextRow {
  paymentContextHash: string;
  rawContextJson: string;
  missionId: string;
  providerId: string;
  quoteId: string;
  method: string;
  origin: string;
  resourcePath: string;
  canonicalUrlHash: string;
  bodyHash: string;
  sanitizedResourceHash: string;
  merchantAddress: string;
  facilitatorUrlHash: string | null;
  chainId: string;
  tokenId: string;
  amount: string;
  amountDecimals: number;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  quoteTermsHash: string;
  piiPolicyHash: string;
  clearSignDigest: string | null;
  cawPactId: string;
  serviceMode: string;
  quoteResourceUrl: string | null;
  quoteAmountUsd: string | null;
  quoteStatus: string | null;
  rawChallengeHash: string | null;
  quoteCreatedAt: number | null;
  quoteExpiresAt: number | null;
  providerOrigin: string | null;
  providerMerchantAddress: string | null;
  providerFacilitatorUrl: string | null;
  providerChainId: string | null;
  providerTokenId: string | null;
  providerPublicKey: string | null;
  allowedResources: string | null;
  cawAllowlistStatus: string | null;
  erc8004AgentId: string | null;
  erc8004AgentUri: string | null;
  reputationThreshold: string | null;
  validationTags: string | null;
}

interface GuardEventRow {
  id: string;
  missionId: string;
  layer: string;
  decision: GuardDecision;
  reason: string | null;
  evidenceJson: string;
  createdAt: number;
}

interface ReceiptRow {
  receiptId: string;
  missionId: string;
  paymentContextHash: string;
  cawRequestId: string | null;
  cawWalletAddress: string;
  pactId: string;
  providerAddress: string;
  resource: string | null;
  asset: string | null;
  serviceResultHash: string | null;
  cawEvidenceRef: string | null;
  fallbackEvidenceRef: string | null;
  facilitatorUrlHash: string | null;
  txHash: string | null;
  coboTransactionId: string | null;
  chainId: string;
  tokenId: string;
  amount: string;
  providerResponseHash: string;
  providerSignature: string;
  responseSchemaHash: string | null;
  deliveryTimestamp: number;
  status: ReceiptStatus;
  clearsigDigest: string | null;
  auditLogIds: string;
  redactionSummaryHash: string | null;
  evidenceMode: EvidenceMode;
  createdAt: number;
}

interface DualReceiptRow {
  dualReceiptHash: string;
  receiptId: string;
  missionId: string;
  paymentContextHash: string;
  paymentReceiptHash: string;
  deliveryReceiptHash: string;
  serviceResultHash: string;
  resource: string;
  providerAddress: string;
  providerPublicKeyHash: string | null;
  finalStatus: string;
  verificationDecision: string;
  verificationResultJson: string;
  dualReceiptJson: string;
  evidenceMode: EvidenceMode;
  createdAt: number;
}

const DEMO_MISSION_IDS = new Set(["mission-demo-402", "demo", "demo-mission"]);

const KNOWN_ATTACK_MISSIONS: Record<string, Omit<AttackLabSummary, "source" | "evidenceMode" | "missionId" | "decision" | "guardEventId">> = {
  "mission-replay": {
    attack: "replay_same_proof",
    paper: "Five Attacks on x402 Agentic Payment Protocol",
    blockedBy: "Quote Reservation / Nonce Lock",
    evidenceAnchor: "replay_detected event"
  },
  "mission-cross-resource": {
    attack: "cross_resource_substitution",
    paper: "Five Attacks on x402 Agentic Payment Protocol",
    blockedBy: "PaymentContext Binder",
    evidenceAnchor: "context mismatch event"
  },
  "mission-pii": {
    attack: "pii_leakage",
    paper: "Hardening x402: PII-Safe Agentic Payments",
    blockedBy: "Metadata Firewall",
    evidenceAnchor: "redacted metadata payload"
  },
  "mission-dynamic-price": {
    attack: "dynamic_price_overspend",
    paper: "Free-Riding in the AI Economy",
    blockedBy: "CAW policy / Budget Ledger",
    evidenceAnchor: "CAW policy denial"
  },
  "mission-malicious-approve": {
    attack: "malicious_approve",
    paper: "Five Attacks on x402 Agentic Payment Protocol",
    blockedBy: "clearsig",
    evidenceAnchor: "decoded approve(max) block"
  },
  "mission-discovery-poisoning": {
    attack: "discovery_poisoning",
    paper: "Five Attacks on x402 Agentic Payment Protocol",
    blockedBy: "Provider Registry",
    evidenceAnchor: "registry miss / unregistered provider"
  },
  "mission-paid-but-denied": {
    attack: "paid_but_denied",
    paper: "A402: Binding Cryptocurrency Payments to Service Execution",
    blockedBy: "ServiceReceipt verifier",
    evidenceAnchor: "paid_but_not_delivered receipt"
  },
  "mission-erc8004-identity-mismatch": {
    attack: "erc8004_identity_mismatch",
    paper: "Five Attacks on x402 Agentic Payment Protocol",
    blockedBy: "ERC-8004 Trust Adapter",
    evidenceAnchor: "endpoint / payTo mismatch"
  },
  "mission-low-reputation": {
    attack: "low_reputation_provider",
    paper: "Free-Riding in the AI Economy",
    blockedBy: "ERC-8004 Trust Adapter",
    evidenceAnchor: "reputation threshold block"
  },
  "mission-header-confusion": {
    attack: "header_confusion_duplicate_x_payment",
    paper: "Five Attacks on x402 Agentic Payment Protocol",
    blockedBy: "HTTP canonicalizer",
    evidenceAnchor: "duplicate payment header rejection"
  },
  "mission-cache-confusion": {
    attack: "cache_confusion",
    paper: "Five Attacks on x402 Agentic Payment Protocol",
    blockedBy: "Response cache policy",
    evidenceAnchor: "cache policy rejection"
  },
  "mission-concurrent-free-riding": {
    attack: "concurrent_free_riding_20_requests",
    paper: "Free-Riding in the AI Economy",
    blockedBy: "Quote Reservation / DB lock",
    evidenceAnchor: "19 concurrent replays blocked"
  },
  "mission-settlement-path": {
    attack: "settlement_path_substitution",
    paper: "Five Attacks on x402 Agentic Payment Protocol",
    blockedBy: "Provider Registry",
    evidenceAnchor: "facilitator/payTo mismatch"
  },
  "mission-partial-payment": {
    attack: "partial_payment_decimals_confusion",
    paper: "A402: Binding Cryptocurrency Payments to Service Execution",
    blockedBy: "clearsig",
    evidenceAnchor: "amount mismatch"
  },
  "mission-malformed-delivery": {
    attack: "malformed_delivery",
    paper: "A402: Binding Cryptocurrency Payments to Service Execution",
    blockedBy: "ServiceReceipt verifier",
    evidenceAnchor: "malformed delivery rejected"
  },
  "mission-multicall-hidden-operation": {
    attack: "multicall_hidden_operation",
    paper: "Hardening x402: PII-Safe Agentic Payments",
    blockedBy: "clearsig",
    evidenceAnchor: "hidden selector block"
  }
};

export function buildEvidenceExport(
  database: DatabaseSync | undefined,
  missionId: string,
  options: BuildEvidenceExportOptions = {}
): EvidenceExportResult {
  const now = options.now ?? Date.now();
  if (!database) {
    if (DEMO_MISSION_IDS.has(missionId)) {
      return {
        found: true,
        export: sanitizeEvidenceExport(buildDemoEvidenceExport(missionId, now, options))
      };
    }

    return { found: false };
  }

  const mission = readMission(database, missionId);

  if (!mission) {
    if (DEMO_MISSION_IDS.has(missionId)) {
      return {
        found: true,
        export: sanitizeEvidenceExport(buildDemoEvidenceExport(missionId, now, options))
      };
    }

    return { found: false };
  }

  const providerContext = readLatestProviderContext(database, missionId);
  const guardEvents = readGuardEvents(database, missionId);
  const receipt = readLatestReceipt(database, missionId);
  const dualReceiptRow = readLatestDualReceipt(database, missionId);
  const parsedGuardEvents = guardEvents.map((event) => ({
    event,
    evidence: parseRecord(event.evidenceJson)
  }));
  const eventReceipt = latestReceiptFromEvents(parsedGuardEvents);
  const eventDualReceipt = latestDualReceiptFromEvents(parsedGuardEvents);
  const serviceReceipt = receipt
    ? serviceReceiptFromRow(receipt)
    : eventReceipt ?? missingFacts("No service receipt has been recorded for this mission.");
  const dualReceipt = dualReceiptRow
    ? dualReceiptFromRow(dualReceiptRow)
    : eventDualReceipt ?? missingFacts("No dual receipt has been recorded for this mission.");
  const providerChallenge = providerChallengeFromRows(providerContext, parsedGuardEvents);
  const erc8004Trust = erc8004TrustFromEvents(parsedGuardEvents);
  const paymentContext = providerContext
    ? paymentContextFromRow(providerContext)
    : paymentContextFromEvents(parsedGuardEvents) ??
      missingFacts("No PaymentContext has been recorded for this mission.");
  const guard = guardFactsFromEvents(parsedGuardEvents);
  const botChainSettlement = buildBotChainSettlementFacts(paymentContext, serviceReceipt);
  const cawCapabilitySummary = buildCawCapabilitySummary(options.capabilityReport);
  const attackLabSummary = buildAttackLabSummary(missionId, parsedGuardEvents);
  const components = [
    {
      component: "mission",
      evidenceMode: "live" as EvidenceMode,
      note: "Runtime database mission row."
    },
    {
      component: "providerChallenge",
      evidenceMode: providerChallenge.evidenceMode,
      note: providerContext ? "Runtime database plus guard evidence." : "Derived from guard evidence."
    },
    {
      component: "erc8004Trust",
      evidenceMode: erc8004Trust.evidenceMode,
      note:
        erc8004Trust.status === "recorded"
          ? `trustSource=${erc8004Trust.trustSource}; registrationStatus=${erc8004Trust.registrationStatus}`
          : erc8004Trust.reason
    },
    {
      component: "paymentContext",
      evidenceMode: paymentContext.evidenceMode,
      note: paymentContext.status === "recorded" ? "PaymentContext facts are recorded." : paymentContext.reason
    },
    {
      component: "guard",
      evidenceMode: guard.evidenceMode,
      note: guard.guardEventId ? "Guard event recorded." : "Guard event missing."
    },
    {
      component: "botChainSettlement",
      evidenceMode: botChainSettlement.evidenceMode,
      note: botChainSettlement.note
    },
    {
      component: "cawCapabilitySummary",
      evidenceMode: cawCapabilitySummary.evidenceMode,
      note: "Capability raw evidence refs are intentionally omitted."
    },
    {
      component: "serviceReceipt",
      evidenceMode: serviceReceipt.evidenceMode,
      note: serviceReceipt.status === "recorded" ? "Receipt facts are recorded." : serviceReceipt.reason
    },
    {
      component: "dualReceipt",
      evidenceMode: dualReceipt.evidenceMode,
      note: dualReceipt.status === "recorded" ? "Final dual receipt facts are recorded." : dualReceipt.reason
    },
    ...(attackLabSummary
      ? [
          {
            component: "attackLab",
            evidenceMode: attackLabSummary.evidenceMode,
            note: "Attack lab evidence is included for this mission."
          }
        ]
      : [])
  ];
  const evidenceModeSummary = summarizeEvidenceModes(components);
  const evidenceExport: EvidenceExport = {
    version: "clear402.evidence-export.v1",
    generatedAt: now,
    generatedAtIso: new Date(now).toISOString(),
    missionId,
    source: "runtime_db",
    evidenceMode: evidenceModeSummary.overall,
    evidenceModeSummary,
    mission: {
      id: mission.id,
      status: mission.status,
      budgetUsd: mission.budgetUsd,
      userPromptSummary: summarizeText(mission.userPrompt),
      cawWalletAddressPresent: mission.cawWalletAddress !== null,
      pactIdPresent: mission.pactId !== null,
      createdAt: mission.createdAt,
      updatedAt: mission.updatedAt,
      evidenceMode: "live"
    },
    providerChallenge,
    erc8004Trust,
    paymentContext,
    guard,
    botChainSettlement,
    cawCapabilitySummary,
    serviceReceipt,
    dualReceipt,
    ...(attackLabSummary ? { attackLabSummary } : {}),
    limitations: buildLimitations()
  };

  return {
    found: true,
    export: sanitizeEvidenceExport(evidenceExport)
  };
}

export function serializeEvidenceExportJson(evidenceExport: EvidenceExport): string {
  return `${canonicalJson(evidenceExport)}\n`;
}

export function renderEvidenceExportMarkdown(evidenceExport: EvidenceExport): string {
  const lines = [
    "# Clear402 Evidence Export",
    "",
    `Generated at: ${evidenceExport.generatedAtIso}`,
    `Mission ID: \`${evidenceExport.missionId}\``,
    `Source: \`${evidenceExport.source}\``,
    `Evidence mode: \`${evidenceExport.evidenceMode}\``,
    "",
    "## Live / Fallback / Mock Summary",
    "",
    `- Live: ${evidenceExport.evidenceModeSummary.counts.live}`,
    `- Fallback: ${evidenceExport.evidenceModeSummary.counts.fallback}`,
    `- Mock: ${evidenceExport.evidenceModeSummary.counts.mock}`,
    "",
    "| Component | Evidence Mode | Note |",
    "|---|---|---|",
    ...evidenceExport.evidenceModeSummary.components.map(
      (component) =>
        `| ${escapeTableCell(component.component)} | \`${component.evidenceMode}\` | ${escapeTableCell(component.note ?? "")} |`
    ),
    "",
    "## Mission",
    "",
    `- Status: \`${evidenceExport.mission.status}\``,
    `- Budget USD: \`${evidenceExport.mission.budgetUsd ?? "n/a"}\``,
    `- Prompt summary: ${evidenceExport.mission.userPromptSummary ?? "n/a"}`,
    `- Wallet address present: \`${String(evidenceExport.mission.cawWalletAddressPresent)}\``,
    `- Pact ID present: \`${String(evidenceExport.mission.pactIdPresent)}\``,
    "",
    "## Provider / Challenge",
    "",
    `- Provider ID: \`${evidenceExport.providerChallenge.provider.providerId ?? "n/a"}\``,
    `- Origin: \`${evidenceExport.providerChallenge.provider.origin ?? "n/a"}\``,
    `- Merchant address: \`${evidenceExport.providerChallenge.provider.merchantAddress ?? "n/a"}\``,
    `- CAW allowlist status: \`${evidenceExport.providerChallenge.provider.cawAllowlistStatus ?? "n/a"}\``,
    `- Quote ID: \`${evidenceExport.providerChallenge.challenge.quoteId ?? "n/a"}\``,
    `- Resource: \`${evidenceExport.providerChallenge.challenge.resourceUrl ?? "n/a"}\``,
    `- Amount: \`${evidenceExport.providerChallenge.challenge.amount ?? "n/a"}\``,
    `- Raw challenge hash: \`${evidenceExport.providerChallenge.challenge.rawChallengeHash ?? "n/a"}\``,
    "",
    "## ERC-8004 Trust",
    "",
    ...renderERC8004TrustMarkdown(evidenceExport.erc8004Trust),
    "",
    "## PaymentContext",
    "",
    ...renderPaymentContextMarkdown(evidenceExport.paymentContext),
    "",
    "## Guard",
    "",
    `- Decision: \`${evidenceExport.guard.decision}\``,
    `- Guard event ID: \`${evidenceExport.guard.guardEventId ?? "n/a"}\``,
    `- Layer: \`${evidenceExport.guard.layer ?? "n/a"}\``,
    `- Reason: ${evidenceExport.guard.reason ?? "n/a"}`,
    "",
    "## BOT Chain Settlement",
    "",
    `- Status: \`${evidenceExport.botChainSettlement.status}\``,
    `- Network: \`${evidenceExport.botChainSettlement.network}\``,
    `- Chain ID: \`${evidenceExport.botChainSettlement.chainId}\``,
    `- Contract: \`${evidenceExport.botChainSettlement.contractAddress ?? "n/a"}\``,
    `- Deploy tx: \`${evidenceExport.botChainSettlement.deploymentTxHash ?? "n/a"}\``,
    `- Interaction tx: \`${evidenceExport.botChainSettlement.interactionTxHash ?? "n/a"}\``,
    `- PaymentContext hash: \`${evidenceExport.botChainSettlement.paymentContextHash ?? "n/a"}\``,
    `- Explorer: ${evidenceExport.botChainSettlement.explorerLinks.interactionTx ?? evidenceExport.botChainSettlement.explorerLinks.deployTx ?? "n/a"}`,
    `- Evidence mode: \`${evidenceExport.botChainSettlement.evidenceMode}\``,
    `- Note: ${evidenceExport.botChainSettlement.note}`,
    "",
    "## Legacy Wallet Capability Summary",
    "",
    `- Source: \`${evidenceExport.cawCapabilitySummary.source}\``,
    `- Evidence mode: \`${evidenceExport.cawCapabilitySummary.evidenceMode}\``,
    `- Live ready: \`${String(evidenceExport.cawCapabilitySummary.liveReady)}\``,
    `- Raw evidence refs omitted: \`${String(evidenceExport.cawCapabilitySummary.rawEvidenceRefsOmitted)}\``,
    "",
    "| Capability | Status | Evidence Mode | Notes |",
    "|---|---|---|---|",
    ...evidenceExport.cawCapabilitySummary.records.map(
      (record) =>
        `| \`${escapeTableCell(record.capability)}\` | \`${escapeTableCell(record.status)}\` | \`${record.evidenceMode}\` | ${escapeTableCell(record.notes ?? "")} |`
    ),
    "",
    "## Service Receipt",
    "",
    ...renderReceiptMarkdown(evidenceExport.serviceReceipt),
    "",
    "## Dual Receipt",
    "",
    ...renderDualReceiptMarkdown(evidenceExport.dualReceipt),
    ...(evidenceExport.attackLabSummary
      ? [
          "",
          "## Attack Lab",
          "",
          `- Source: \`${evidenceExport.attackLabSummary.source}\``,
          `- Evidence mode: \`${evidenceExport.attackLabSummary.evidenceMode}\``,
          `- Attack: \`${evidenceExport.attackLabSummary.attack ?? "n/a"}\``,
          `- Blocked by: \`${evidenceExport.attackLabSummary.blockedBy ?? "n/a"}\``,
          `- Guard event ID: \`${evidenceExport.attackLabSummary.guardEventId ?? "n/a"}\``
        ]
      : []),
    "",
    "## Limitations",
    "",
    ...evidenceExport.limitations.notes.map((note) => `- ${note}`),
    "",
    "## Claims Allowed",
    "",
    ...evidenceExport.limitations.claimsAllowed.map((claim) => `- ${claim}`),
    "",
    "## Claims Forbidden",
    "",
    ...evidenceExport.limitations.claimsForbidden.map((claim) => `- ${claim}`)
  ];

  return `${lines.join("\n")}\n`;
}

export function parseEvidenceExportPath(pathname: string): {
  missionId: string;
  format: EvidenceExportFormat;
} | null {
  const match = pathname.match(/^\/api\/evidence\/([^/]+)\/export\.(json|md)$/);
  if (!match) {
    return null;
  }

  return {
    missionId: decodeURIComponent(match[1] ?? ""),
    format: match[2] as EvidenceExportFormat
  };
}

function readMission(database: DatabaseSync, missionId: string): MissionRow | undefined {
  return database
    .prepare(
      `select
        id,
        user_prompt as userPrompt,
        budget_usd as budgetUsd,
        status,
        caw_wallet_address as cawWalletAddress,
        pact_id as pactId,
        created_at as createdAt,
        updated_at as updatedAt
      from missions
      where id = ?`
    )
    .get(missionId) as MissionRow | undefined;
}

function readLatestProviderContext(
  database: DatabaseSync,
  missionId: string
): ProviderContextRow | undefined {
  return database
    .prepare(
      `select
        pc.payment_context_hash as paymentContextHash,
        pc.raw_context_json as rawContextJson,
        pc.mission_id as missionId,
        pc.provider_id as providerId,
        pc.quote_id as quoteId,
        pc.method,
        pc.origin,
        pc.resource_path as resourcePath,
        pc.canonical_url_hash as canonicalUrlHash,
        pc.body_hash as bodyHash,
        pc.sanitized_resource_hash as sanitizedResourceHash,
        pc.merchant_address as merchantAddress,
        pc.facilitator_url_hash as facilitatorUrlHash,
        pc.chain_id as chainId,
        pc.token_id as tokenId,
        pc.amount,
        pc.amount_decimals as amountDecimals,
        pc.nonce,
        pc.issued_at as issuedAt,
        pc.expires_at as expiresAt,
        pc.quote_terms_hash as quoteTermsHash,
        pc.pii_policy_hash as piiPolicyHash,
        pc.clear_sign_digest as clearSignDigest,
        pc.caw_pact_id as cawPactId,
        pc.service_mode as serviceMode,
        q.resource_url as quoteResourceUrl,
        q.amount_usd as quoteAmountUsd,
        q.status as quoteStatus,
        q.raw_challenge_hash as rawChallengeHash,
        q.created_at as quoteCreatedAt,
        q.expires_at as quoteExpiresAt,
        pr.origin as providerOrigin,
        pr.merchant_address as providerMerchantAddress,
        pr.facilitator_url as providerFacilitatorUrl,
        pr.chain_id as providerChainId,
        pr.token_id as providerTokenId,
        pr.public_key as providerPublicKey,
        pr.allowed_resources as allowedResources,
        pr.caw_allowlist_status as cawAllowlistStatus,
        pr.erc8004_agent_id as erc8004AgentId,
        pr.erc8004_agent_uri as erc8004AgentUri,
        pr.reputation_threshold as reputationThreshold,
        pr.validation_tags as validationTags
      from payment_contexts pc
      left join x402_quotes q on q.quote_id = pc.quote_id
      left join provider_registry pr on pr.provider_id = pc.provider_id
      where pc.mission_id = ?
      order by pc.issued_at desc, pc.payment_context_hash desc
      limit 1`
    )
    .get(missionId) as ProviderContextRow | undefined;
}

function readGuardEvents(database: DatabaseSync, missionId: string): GuardEventRow[] {
  return database
    .prepare(
      `select
        id,
        mission_id as missionId,
        layer,
        decision,
        reason,
        evidence_json as evidenceJson,
        created_at as createdAt
      from guard_events
      where mission_id = ?
      order by created_at asc, id asc`
    )
    .all(missionId) as unknown as GuardEventRow[];
}

function readLatestReceipt(database: DatabaseSync, missionId: string): ReceiptRow | undefined {
  return database
    .prepare(
      `select
        receipt_id as receiptId,
        mission_id as missionId,
        payment_context_hash as paymentContextHash,
        caw_request_id as cawRequestId,
        caw_wallet_address as cawWalletAddress,
        pact_id as pactId,
        provider_address as providerAddress,
        resource,
        asset,
        service_result_hash as serviceResultHash,
        caw_evidence_ref as cawEvidenceRef,
        fallback_evidence_ref as fallbackEvidenceRef,
        facilitator_url_hash as facilitatorUrlHash,
        tx_hash as txHash,
        cobo_transaction_id as coboTransactionId,
        chain_id as chainId,
        token_id as tokenId,
        amount,
        provider_response_hash as providerResponseHash,
        provider_signature as providerSignature,
        response_schema_hash as responseSchemaHash,
        delivery_timestamp as deliveryTimestamp,
        status,
        clearsig_digest as clearsigDigest,
        audit_log_ids as auditLogIds,
        redaction_summary_hash as redactionSummaryHash,
        evidence_mode as evidenceMode,
        created_at as createdAt
      from receipts
      where mission_id = ?
      order by created_at desc, receipt_id desc
      limit 1`
    )
    .get(missionId) as ReceiptRow | undefined;
}

function readLatestDualReceipt(database: DatabaseSync, missionId: string): DualReceiptRow | undefined {
  return database
    .prepare(
      `select
        dual_receipt_hash as dualReceiptHash,
        receipt_id as receiptId,
        mission_id as missionId,
        payment_context_hash as paymentContextHash,
        payment_receipt_hash as paymentReceiptHash,
        delivery_receipt_hash as deliveryReceiptHash,
        service_result_hash as serviceResultHash,
        resource,
        provider_address as providerAddress,
        provider_public_key_hash as providerPublicKeyHash,
        final_status as finalStatus,
        verification_decision as verificationDecision,
        verification_result_json as verificationResultJson,
        dual_receipt_json as dualReceiptJson,
        evidence_mode as evidenceMode,
        created_at as createdAt
      from dual_receipts
      where mission_id = ?
      order by created_at desc, dual_receipt_hash desc
      limit 1`
    )
    .get(missionId) as DualReceiptRow | undefined;
}

function providerChallengeFromRows(
  providerContext: ProviderContextRow | undefined,
  parsedGuardEvents: Array<{ event: GuardEventRow; evidence: Record<string, unknown> }>
): ProviderChallengeFacts {
  const challenge = latestNestedRecord(parsedGuardEvents, "challenge");
  const challengeMode = evidenceModeFromRecord(challenge) ?? "live";
  const facilitatorUrl =
    stringValue(challenge?.facilitatorUrl) ?? providerContext?.providerFacilitatorUrl ?? undefined;
  const providerPublicKey = providerContext?.providerPublicKey ?? undefined;
  const allowedResources = parseJsonArray(providerContext?.allowedResources);
  const validationTags = parseJsonArray(providerContext?.validationTags).filter(isString);
  const providerId = providerContext?.providerId ?? stringValue(challenge?.providerId);
  const origin = providerContext?.providerOrigin ?? providerContext?.origin ?? undefined;
  const merchantAddress =
    providerContext?.providerMerchantAddress ?? providerContext?.merchantAddress ?? undefined;
  const chainId = providerContext?.providerChainId ?? providerContext?.chainId ?? undefined;
  const tokenId = providerContext?.providerTokenId ?? providerContext?.tokenId ?? undefined;
  const resourceUrl = stringValue(challenge?.resource) ?? providerContext?.quoteResourceUrl ?? undefined;
  const amount =
    stringValue(challenge?.amount) ??
    providerContext?.quoteAmountUsd ??
    providerContext?.amount ??
    undefined;
  const status = providerContext?.quoteStatus ?? undefined;
  const rawChallengeHash =
    stringValue(challenge?.rawChallengeHash) ?? providerContext?.rawChallengeHash ?? undefined;
  const payTo = stringValue(challenge?.payTo) ?? providerContext?.merchantAddress ?? undefined;
  const expiresAt =
    numberValue(challenge?.expiresAt) ?? providerContext?.quoteExpiresAt ?? providerContext?.expiresAt;
  const scheme = stringValue(challenge?.scheme);
  const network = stringValue(challenge?.network);
  const asset = stringValue(challenge?.asset);

  return {
    provider: {
      ...(providerId ? { providerId } : {}),
      ...(origin ? { origin } : {}),
      ...(merchantAddress ? { merchantAddress } : {}),
      ...(facilitatorUrl ? { facilitatorUrlHash: hashObject(facilitatorUrl) } : {}),
      ...(chainId ? { chainId } : {}),
      ...(tokenId ? { tokenId } : {}),
      ...(providerPublicKey ? { publicKeyHash: hashObject(providerPublicKey) } : {}),
      ...(allowedResources.length > 0 ? { allowedResourceCount: allowedResources.length } : {}),
      ...(providerContext?.cawAllowlistStatus ? { cawAllowlistStatus: providerContext.cawAllowlistStatus } : {}),
      ...(providerContext?.erc8004AgentId ? { erc8004AgentId: providerContext.erc8004AgentId } : {}),
      ...(providerContext?.erc8004AgentUri ? { erc8004AgentUri: providerContext.erc8004AgentUri } : {}),
      ...(providerContext?.reputationThreshold ? { reputationThreshold: providerContext.reputationThreshold } : {}),
      ...(validationTags.length > 0 ? { validationTags } : {})
    },
    challenge: {
      ...(providerContext?.quoteId ? { quoteId: providerContext.quoteId } : {}),
      ...(resourceUrl ? { resourceUrl } : {}),
      ...(amount ? { amount } : {}),
      ...(status ? { status } : {}),
      ...(rawChallengeHash ? { rawChallengeHash } : {}),
      ...(scheme ? { scheme } : {}),
      ...(network ? { network } : {}),
      ...(asset ? { asset } : {}),
      ...(payTo ? { payTo } : {}),
      ...(facilitatorUrl ? { facilitatorUrlHash: hashObject(facilitatorUrl) } : {}),
      descriptionPresent: typeof challenge?.description === "string",
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      evidenceMode: challengeMode
    },
    evidenceMode: providerContext ? modeMax("live", challengeMode) : challengeMode
  };
}

function erc8004TrustFromEvents(
  parsedGuardEvents: Array<{ event: GuardEventRow; evidence: Record<string, unknown> }>
): ERC8004TrustFacts | MissingFacts {
  for (const { evidence } of [...parsedGuardEvents].reverse()) {
    const trustResult = nestedRecord(evidence, ["trustResult"]);
    if (!trustResult) {
      continue;
    }

    const liveSource = nestedRecord(trustResult, ["liveSource"]);
    const checkedAt = numberValue(liveSource?.checkedAt);
    const liveSourceName = stringValue(liveSource?.source);
    const liveSourceStatus = stringValue(liveSource?.status);
    const liveSourceReference = stringValue(liveSource?.reference);
    const parsedLiveSource =
      liveSource === undefined
        ? undefined
        : {
            ...(liveSourceName !== undefined ? { source: liveSourceName } : {}),
            ...(liveSourceStatus !== undefined ? { status: liveSourceStatus } : {}),
            ...(liveSourceReference !== undefined ? { reference: liveSourceReference } : {}),
            ...(checkedAt !== undefined ? { checkedAt } : {})
          };
    const trustSource = erc8004TrustSourceValue(trustResult.trustSource);
    const reason = stringValue(trustResult.reason);

    return {
      status: "recorded",
      agentId: stringValue(trustResult.agentId) ?? "unregistered",
      trustSource,
      registrationStatus: erc8004RegistrationStatusValue(trustResult.registrationStatus),
      decision: stringValue(trustResult.decision) ?? "fallback_required",
      identityVerified: booleanValue(trustResult.identityVerified) ?? false,
      endpointMatches: booleanValue(trustResult.endpointMatches) ?? false,
      payToMatches: booleanValue(trustResult.payToMatches) ?? false,
      reputationScore: numberValue(trustResult.reputationScore) ?? 0,
      demoFallbackUsed: booleanValue(trustResult.demoFallbackUsed) ?? trustSource === "demo_erc8004",
      ...(parsedLiveSource !== undefined ? { liveSource: parsedLiveSource } : {}),
      ...(reason !== undefined ? { reason } : {}),
      evidenceMode: evidenceModeFromRecord(trustResult) ?? "fallback"
    };
  }

  return missingFacts("No ERC-8004 trust result has been recorded; live ERC-8004 trust remains needs_registration.");
}

function paymentContextFromRow(row: ProviderContextRow): PaymentContextFacts {
  const rawContext = parseRecord(row.rawContextJson);
  const version = stringValue(rawContext.version);
  return {
    status: "recorded",
    paymentContextHash: row.paymentContextHash,
    ...(version ? { version } : {}),
    missionId: row.missionId,
    providerId: row.providerId,
    quoteId: row.quoteId,
    method: row.method,
    origin: row.origin,
    resourcePath: row.resourcePath,
    canonicalUrlHash: row.canonicalUrlHash,
    bodyHash: row.bodyHash,
    sanitizedResourceHash: row.sanitizedResourceHash,
    merchantAddress: row.merchantAddress,
    ...(row.facilitatorUrlHash ? { facilitatorUrlHash: row.facilitatorUrlHash } : {}),
    chainId: row.chainId,
    tokenId: row.tokenId,
    amount: row.amount,
    amountDecimals: row.amountDecimals,
    nonce: row.nonce,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    quoteTermsHash: row.quoteTermsHash,
    piiPolicyHash: row.piiPolicyHash,
    ...(row.clearSignDigest ? { clearSignDigest: row.clearSignDigest } : {}),
    cawPactId: row.cawPactId,
    serviceMode: row.serviceMode,
    evidenceMode: "live"
  };
}

function paymentContextFromEvents(
  parsedGuardEvents: Array<{ event: GuardEventRow; evidence: Record<string, unknown> }>
): PaymentContextFacts | undefined {
  const paymentContext = latestNestedRecord(parsedGuardEvents, "paymentContext");
  if (!paymentContext) {
    return undefined;
  }

  const version = stringValue(paymentContext.version);
  return {
    status: "recorded",
    paymentContextHash: stringValue(paymentContext.paymentContextHash) ?? hashObject(paymentContext),
    ...(version ? { version } : {}),
    missionId: requireString(paymentContext.missionId, "unknown"),
    providerId: requireString(paymentContext.providerId, "unknown"),
    quoteId: requireString(paymentContext.quoteId, "unknown"),
    method: requireString(paymentContext.method, "unknown"),
    origin: requireString(paymentContext.origin, "unknown"),
    resourcePath: requireString(paymentContext.resourcePath, "unknown"),
    canonicalUrlHash: requireString(paymentContext.canonicalUrlHash, "unknown"),
    bodyHash: requireString(paymentContext.bodyHash, "unknown"),
    sanitizedResourceHash: requireString(paymentContext.sanitizedResourceHash, "unknown"),
    merchantAddress: requireString(paymentContext.merchantAddress, "unknown"),
    ...(typeof paymentContext.facilitatorUrlHash === "string"
      ? { facilitatorUrlHash: paymentContext.facilitatorUrlHash }
      : {}),
    chainId: requireString(paymentContext.chainId, "unknown"),
    tokenId: requireString(paymentContext.tokenId, "unknown"),
    amount: requireString(paymentContext.amount, "unknown"),
    amountDecimals: numberValue(paymentContext.amountDecimals) ?? 0,
    nonce: requireString(paymentContext.nonce, "unknown"),
    issuedAt: numberValue(paymentContext.issuedAt) ?? 0,
    expiresAt: numberValue(paymentContext.expiresAt) ?? 0,
    quoteTermsHash: requireString(paymentContext.quoteTermsHash, "unknown"),
    piiPolicyHash: requireString(paymentContext.piiPolicyHash, "unknown"),
    ...(typeof paymentContext.clearSignDigest === "string"
      ? { clearSignDigest: paymentContext.clearSignDigest }
      : {}),
    cawPactId: requireString(paymentContext.cawPactId, "unknown"),
    serviceMode: requireString(paymentContext.serviceMode, "unknown"),
    evidenceMode: evidenceModeFromRecord(paymentContext) ?? "fallback"
  };
}

function guardFactsFromEvents(
  parsedGuardEvents: Array<{ event: GuardEventRow; evidence: Record<string, unknown> }>
): GuardFacts {
  const eventSummaries = parsedGuardEvents.map(({ event, evidence }) => ({
    id: event.id,
    layer: event.layer,
    decision: event.decision,
    ...(event.reason !== null ? { reason: event.reason } : {}),
    createdAt: event.createdAt,
    evidenceMode: inferEventEvidenceMode(evidence, event.decision)
  }));
  const latest = parsedGuardEvents.at(-1);
  if (!latest) {
    return {
      decision: "not_recorded",
      guardEventId: null,
      evidenceMode: "fallback",
      eventCount: 0,
      events: []
    };
  }

  return {
    decision: latest.event.decision,
    guardEventId: latest.event.id,
    layer: latest.event.layer,
    ...(latest.event.reason !== null ? { reason: latest.event.reason } : {}),
    createdAt: latest.event.createdAt,
    evidenceMode: inferEventEvidenceMode(latest.evidence, latest.event.decision),
    eventCount: eventSummaries.length,
    events: eventSummaries
  };
}

function serviceReceiptFromRow(row: ReceiptRow): ServiceReceiptFacts {
  return {
    status: "recorded",
    receiptId: row.receiptId,
    paymentContextHash: row.paymentContextHash,
    ...(row.cawRequestId ? { cawRequestId: row.cawRequestId } : {}),
    cawWalletAddress: row.cawWalletAddress,
    pactId: row.pactId,
    providerAddress: row.providerAddress,
    ...(row.resource ? { resource: row.resource } : {}),
    ...(row.asset ? { asset: row.asset } : {}),
    ...(row.serviceResultHash ? { serviceResultHash: row.serviceResultHash } : {}),
    ...(row.cawEvidenceRef ? { cawEvidenceRef: row.cawEvidenceRef } : {}),
    ...(row.fallbackEvidenceRef ? { fallbackEvidenceRef: row.fallbackEvidenceRef } : {}),
    ...(row.facilitatorUrlHash ? { facilitatorUrlHash: row.facilitatorUrlHash } : {}),
    ...(row.txHash ? { txHash: row.txHash } : {}),
    ...(row.coboTransactionId ? { coboTransactionId: row.coboTransactionId } : {}),
    chainId: row.chainId,
    tokenId: row.tokenId,
    amount: row.amount,
    providerResponseHash: row.providerResponseHash,
    providerSignaturePresent: row.providerSignature.length > 0,
    ...(row.responseSchemaHash ? { responseSchemaHash: row.responseSchemaHash } : {}),
    deliveryTimestamp: row.deliveryTimestamp,
    receiptStatus: row.status,
    ...(row.clearsigDigest ? { clearsigDigest: row.clearsigDigest } : {}),
    auditLogIds: parseJsonArray(row.auditLogIds).filter(isString),
    ...(row.redactionSummaryHash ? { redactionSummaryHash: row.redactionSummaryHash } : {}),
    evidenceMode: row.evidenceMode
  };
}

function latestReceiptFromEvents(
  parsedGuardEvents: Array<{ event: GuardEventRow; evidence: Record<string, unknown> }>
): ServiceReceiptFacts | undefined {
  for (const { evidence } of [...parsedGuardEvents].reverse()) {
    const receipt = nestedRecord(evidence, ["receipt"]) ?? nestedRecord(evidence, ["receiptResult", "receipt"]);
    if (!receipt) {
      continue;
    }

    const receiptId = stringValue(receipt.receiptId);
    const paymentContextHash = stringValue(receipt.paymentContextHash);
    const cawRequestId = stringValue(receipt.cawRequestId);
    const cawWalletAddress = stringValue(receipt.cawWalletAddress);
    const pactId = stringValue(receipt.pactId);
    const providerAddress = stringValue(receipt.providerAddress);
    const facilitatorUrlHash = stringValue(receipt.facilitatorUrlHash);
    const txHash = stringValue(receipt.txHash);
    const chainId = stringValue(receipt.chainId);
    const tokenId = stringValue(receipt.tokenId);
    const amount = stringValue(receipt.amount);
    const providerResponseHash = stringValue(receipt.providerResponseHash);
    const responseSchemaHash = stringValue(receipt.responseSchemaHash);
    const deliveryTimestamp = numberValue(receipt.deliveryTimestamp);
    const receiptStatus = stringValue(receipt.status);
    const clearsigDigest = stringValue(receipt.clearsigDigest);
    const redactionSummaryHash = stringValue(receipt.redactionSummaryHash);
    return {
      status: "recorded",
      ...(receiptId ? { receiptId } : {}),
      ...(paymentContextHash ? { paymentContextHash } : {}),
      ...(cawRequestId ? { cawRequestId } : {}),
      ...(cawWalletAddress ? { cawWalletAddress } : {}),
      ...(pactId ? { pactId } : {}),
      ...(providerAddress ? { providerAddress } : {}),
      ...(facilitatorUrlHash ? { facilitatorUrlHash } : {}),
      ...(txHash ? { txHash } : {}),
      ...(chainId ? { chainId } : {}),
      ...(tokenId ? { tokenId } : {}),
      ...(amount ? { amount } : {}),
      ...(providerResponseHash ? { providerResponseHash } : {}),
      providerSignaturePresent: typeof receipt.providerSignature === "string" && receipt.providerSignature.length > 0,
      ...(responseSchemaHash ? { responseSchemaHash } : {}),
      ...(deliveryTimestamp !== undefined ? { deliveryTimestamp } : {}),
      ...(receiptStatus ? { receiptStatus } : {}),
      ...(clearsigDigest ? { clearsigDigest } : {}),
      auditLogIds: Array.isArray(receipt.auditLogIds) ? receipt.auditLogIds.filter(isString) : [],
      ...(redactionSummaryHash ? { redactionSummaryHash } : {}),
      evidenceMode: evidenceModeFromRecord(receipt) ?? "fallback"
    };
  }

  return undefined;
}

function dualReceiptFromRow(row: DualReceiptRow): DualReceiptFacts {
  const verificationResult = parseRecord(row.verificationResultJson);
  return {
    status: "recorded",
    evidenceMode: row.evidenceMode,
    dualReceiptHash: row.dualReceiptHash,
    paymentReceiptHash: row.paymentReceiptHash,
    deliveryReceiptHash: row.deliveryReceiptHash,
    verificationDecision: row.verificationDecision,
    verificationResult
  };
}

function latestDualReceiptFromEvents(
  parsedGuardEvents: Array<{ event: GuardEventRow; evidence: Record<string, unknown> }>
): DualReceiptFacts | undefined {
  for (const { evidence } of [...parsedGuardEvents].reverse()) {
    const dualReceipt = nestedRecord(evidence, ["dualReceipt"]) ?? nestedRecord(evidence, ["receipt", "dualReceipt"]);
    if (!dualReceipt) {
      continue;
    }

    const paymentReceipt = nestedRecord(dualReceipt, ["paymentReceipt"]);
    const deliveryReceipt = nestedRecord(dualReceipt, ["deliveryReceipt"]);
    const verificationResult = nestedRecord(dualReceipt, ["verificationResult"]);
    const dualReceiptHash = stringValue(dualReceipt.dualReceiptHash);
    const paymentReceiptHash = stringValue(paymentReceipt?.paymentReceiptHash);
    const deliveryReceiptHash = stringValue(deliveryReceipt?.deliveryReceiptHash);
    const verificationDecision = stringValue(verificationResult?.decision);
    return {
      status: "recorded",
      evidenceMode: evidenceModeFromRecord(dualReceipt) ?? "fallback",
      ...(dualReceiptHash ? { dualReceiptHash } : {}),
      ...(paymentReceiptHash ? { paymentReceiptHash } : {}),
      ...(deliveryReceiptHash ? { deliveryReceiptHash } : {}),
      ...(verificationDecision ? { verificationDecision } : {}),
      ...(verificationResult ? { verificationResult } : {})
    };
  }

  return undefined;
}

function buildCawCapabilitySummary(report: unknown): CawCapabilitySummary {
  const records = recordsFromCapabilityReport(report);
  if (records.length > 0) {
    const summary = summarizeCapabilityRecords(records);
    return {
      source: "injected_runtime_report",
      evidenceMode: modeFromRecords(records),
      liveReady: booleanFromRecord(report, "liveReady") ?? false,
      summary,
      records,
      recordedScope: recordedScope(),
      rawEvidenceRefsOmitted: true,
      notes: [
        "The export endpoint never includes raw CAW evidence refs, API keys, pairing tokens, wallet secrets, or environment values.",
        "Runtime capability reports are summarized only; raw evidence should be inspected through the recorded operator documents."
      ]
    };
  }

  const recordedRecords = [
    {
      capability: "caw_cli",
      status: "verified_recorded_scope",
      evidenceMode: "live" as EvidenceMode,
      notes: "Recorded CAW CLI evidence exists in docs/caw_capability_report.md."
    },
    {
      capability: "wallet_identity",
      status: "verified_recorded_scope",
      evidenceMode: "live" as EvidenceMode,
      notes: "Recorded wallet identity was present for the Sepolia evidence runs; raw identifiers are omitted here."
    },
    {
      capability: "policy_enforcement",
      status: "verified_recorded_scope",
      evidenceMode: "live" as EvidenceMode,
      notes: "Recorded pact enforced Sepolia token, merchant allowlist, amount cap, and policy denial scope."
    },
    {
      capability: "payment_execution",
      status: "verified_recorded_scope",
      evidenceMode: "live" as EvidenceMode,
      notes: "One recorded Sepolia testnet tiny transfer succeeded."
    },
    {
      capability: "audit_lookup",
      status: "verified_recorded_scope",
      evidenceMode: "live" as EvidenceMode,
      notes: "Recorded pact events and transaction lookup evidence exist in docs."
    },
    {
      capability: "policy_denial_evidence",
      status: "verified_recorded_scope",
      evidenceMode: "live" as EvidenceMode,
      notes: "One recorded destination-allowlist policy denial rejected before a transaction hash."
    }
  ];

  return {
    source: "recorded_scope_summary",
    evidenceMode: "fallback",
    liveReady: false,
    summary: {
      verified: recordedRecords.length,
      needsManualStep: 0,
      unavailable: 0,
      fallbackRequired: 0
    },
    records: recordedRecords,
    recordedScope: recordedScope(),
    rawEvidenceRefsOmitted: true,
    notes: [
      "This endpoint does not probe CAW or read local CAW environment variables while exporting evidence.",
      "Recorded live CAW claims remain limited to the Sepolia testnet allow-path transfer and destination-allowlist denial documented in the repo."
    ]
  };
}

function buildBotChainSettlementFacts(
  paymentContext: PaymentContextFacts | MissingFacts,
  serviceReceipt: ServiceReceiptFacts | MissingFacts
): BotChainSettlementFacts {
  const explorerBaseUrl = process.env.BOTCHAIN_EXPLORER_BASE_URL ?? "https://scan.bohr.life";
  const contractAddress = process.env.BOTCHAIN_SERVICE_ESCROW_ADDRESS;
  const deploymentTxHash = process.env.BOTCHAIN_DEPLOY_TX_HASH;
  const envInteractionTxHash = process.env.BOTCHAIN_INTERACTION_TX_HASH;
  const receiptTxHash = serviceReceipt.status === "recorded" ? serviceReceipt.txHash : undefined;
  const interactionTxHash = envInteractionTxHash ?? receiptTxHash;
  const paymentContextHash =
    paymentContext.status === "recorded" ? paymentContext.paymentContextHash : undefined;
  const chainId =
    process.env.BOTCHAIN_CHAIN_ID ??
    (paymentContext.status === "recorded" && paymentContext.chainId === "968" ? paymentContext.chainId : "968");
  const escrowAction = process.env.BOTCHAIN_ESCROW_ACTION;
  const status = interactionTxHash ? "recorded" : contractAddress ? "deployed" : "not_recorded";

  return {
    status,
    network: process.env.BOTCHAIN_CHAIN_NAME ?? "BOT Chain Testnet",
    chainId,
    rpcLabel: process.env.BOTCHAIN_RPC_URL ?? "https://rpc.bohr.life",
    explorerBaseUrl,
    contractName: "ServiceEscrow",
    ...(contractAddress ? { contractAddress } : {}),
    ...(deploymentTxHash ? { deploymentTxHash } : {}),
    ...(interactionTxHash ? { interactionTxHash } : {}),
    ...(paymentContextHash ? { paymentContextHash } : {}),
    ...(escrowAction === "fund" || escrowAction === "deliver" || escrowAction === "refund"
      ? { escrowAction }
      : {}),
    explorerLinks: {
      ...(contractAddress ? { contract: `${explorerBaseUrl.replace(/\/$/, "")}/address/${contractAddress}` } : {}),
      ...(deploymentTxHash ? { deployTx: `${explorerBaseUrl.replace(/\/$/, "")}/tx/${deploymentTxHash}` } : {}),
      ...(interactionTxHash ? { interactionTx: `${explorerBaseUrl.replace(/\/$/, "")}/tx/${interactionTxHash}` } : {})
    },
    evidenceMode: status === "recorded" ? "live" : "fallback",
    note:
      status === "recorded"
        ? "BOT Chain testnet ServiceEscrow interaction evidence is recorded through tx hash and PaymentContext binding."
        : status === "deployed"
          ? "BOT Chain ServiceEscrow deployment is configured, but an interaction tx is required before claiming live settlement."
          : "BOT Chain settlement is pending; deploy ServiceEscrow and record an interaction tx before claiming live evidence."
  };
}

function buildAttackLabSummary(
  missionId: string,
  parsedGuardEvents: Array<{ event: GuardEventRow; evidence: Record<string, unknown> }>
): AttackLabSummary | undefined {
  const latest = parsedGuardEvents.at(-1);
  const fromEvidence = latestNestedRecord(parsedGuardEvents, "attackLabSummary");
  if (fromEvidence) {
    const attack = stringValue(fromEvidence.attack);
    const paper = stringValue(fromEvidence.paper);
    const blockedBy = stringValue(fromEvidence.blockedBy);
    const evidenceAnchor = stringValue(fromEvidence.evidenceAnchor);
    const decision = stringValue(fromEvidence.decision);
    return {
      source: "guard_event",
      evidenceMode: evidenceModeFromRecord(fromEvidence) ?? "mock",
      missionId,
      ...(attack ? { attack } : {}),
      ...(paper ? { paper } : {}),
      ...(blockedBy ? { blockedBy } : {}),
      ...(evidenceAnchor ? { evidenceAnchor } : {}),
      ...(decision ? { decision } : {}),
      guardEventId: latest?.event.id ?? null
    };
  }

  const known = KNOWN_ATTACK_MISSIONS[missionId];
  if (!known) {
    return undefined;
  }

  return {
    source: "known_attack_mission",
    evidenceMode: "mock",
    missionId,
    ...known,
    ...(latest?.event.decision ? { decision: latest.event.decision } : {}),
    guardEventId: latest?.event.id ?? null
  };
}

function buildDemoEvidenceExport(
  missionId: string,
  now: number,
  options: BuildEvidenceExportOptions
): EvidenceExport {
  const cawCapabilitySummary = buildCawCapabilitySummary(options.capabilityReport);
  const demoPaymentContextHash = `0x${hashObject(`payment-context:${missionId}`).slice(2)}`;
  const botChainSettlement = buildBotChainSettlementFacts(
    {
      status: "recorded",
      paymentContextHash: demoPaymentContextHash,
      version: "clear402.payment.v1",
      missionId,
      providerId: "provider-demo-402",
      quoteId: "quote-demo-402",
      method: "GET",
      origin: "https://provider.example",
      resourcePath: "/paid/report",
      canonicalUrlHash: hashObject("https://provider.example/paid/report"),
      bodyHash: hashObject(""),
      sanitizedResourceHash: hashObject("https://provider.example/paid/report"),
      merchantAddress: "0xA882b939c4Ca15c904760b8c240124Cb68cc2A88",
      facilitatorUrlHash: hashObject("https://facilitator.example/x402"),
      chainId: "968",
      tokenId: "BOT",
      amount: "1000000000000",
      amountDecimals: 18,
      nonce: "nonce-demo-402-0001",
      issuedAt: now,
      expiresAt: now + 600_000,
      quoteTermsHash: hashObject("demo-quote-terms"),
      piiPolicyHash: hashObject("demo-pii-policy"),
      clearSignDigest: hashObject("demo-clearsig"),
      cawPactId: "botchain-service-escrow",
      serviceMode: "escrowed-delivery",
      evidenceMode: "fallback"
    },
    missingFacts("No BOT Chain interaction tx has been recorded for the demo fixture.")
  );
  const attackLabSummary: AttackLabSummary = {
    source: "demo_fixture",
    evidenceMode: "mock",
    missionId,
    totalScenarios: 16,
    examples: [
      {
        attack: "replay_same_proof",
        blockedBy: "Quote Reservation / Nonce Lock",
        evidenceMode: "mock"
      },
      {
        attack: "cross_resource_substitution",
        blockedBy: "PaymentContext Binder",
        evidenceMode: "mock"
      },
      {
        attack: "paid_but_denied",
        blockedBy: "ServiceReceipt verifier",
        evidenceMode: "mock"
      }
    ]
  };
  const components = [
    {
      component: "mission",
      evidenceMode: "fallback" as EvidenceMode,
      note: "Demo mission fixture."
    },
    {
      component: "providerChallenge",
      evidenceMode: "fallback" as EvidenceMode,
      note: "Demo provider and challenge facts."
    },
    {
      component: "erc8004Trust",
      evidenceMode: "mock" as EvidenceMode,
      note: "Demo ERC-8004 trust fixture; live trust requires registration."
    },
    {
      component: "paymentContext",
      evidenceMode: "fallback" as EvidenceMode,
      note: "Demo PaymentContext fixture."
    },
    {
      component: "guard",
      evidenceMode: "fallback" as EvidenceMode,
      note: "Demo guard decision fixture."
    },
    {
      component: "botChainSettlement",
      evidenceMode: botChainSettlement.evidenceMode,
      note: botChainSettlement.note
    },
    {
      component: "cawCapabilitySummary",
      evidenceMode: cawCapabilitySummary.evidenceMode,
      note: "Recorded scope summary; no CAW probe performed by export."
    },
    {
      component: "serviceReceipt",
      evidenceMode: "fallback" as EvidenceMode,
      note: "Demo receipt fixture."
    },
    {
      component: "attackLab",
      evidenceMode: "mock" as EvidenceMode,
      note: "Attack lab fixture summary."
    }
  ];
  const evidenceModeSummary = summarizeEvidenceModes(components);

  return {
    version: "clear402.evidence-export.v1",
    generatedAt: now,
    generatedAtIso: new Date(now).toISOString(),
    missionId,
    source: "demo_fixture",
    evidenceMode: evidenceModeSummary.overall,
    evidenceModeSummary,
    mission: {
      id: missionId,
      status: "active",
      budgetUsd: "25",
      userPromptSummary: "Demo mission fixture for server-side evidence export.",
      cawWalletAddressPresent: true,
      pactIdPresent: true,
      createdAt: now,
      updatedAt: now,
      evidenceMode: "fallback"
    },
    providerChallenge: {
      provider: {
        providerId: "provider-demo-402",
        origin: "https://provider.example",
        merchantAddress: "0xA882b939c4Ca15c904760b8c240124Cb68cc2A88",
        facilitatorUrlHash: hashObject("https://facilitator.example/x402"),
        chainId: "968",
        tokenId: "BOT",
        publicKeyHash: hashObject("0x04botchain_demo_public_key"),
        allowedResourceCount: 1,
        cawAllowlistStatus: "allowed",
        erc8004AgentId: "erc8004:agent:clear402-demo",
        erc8004AgentUri: "https://erc8004.example/agents/clear402-demo",
        reputationThreshold: "80",
        validationTags: ["x402_endpoint_verified", "delivery_receipt_verified"]
      },
      challenge: {
        quoteId: "quote-demo-402",
        resourceUrl: "https://provider.example/paid/report",
        amount: "5",
        status: "reserved",
        rawChallengeHash: hashObject("demo-x402-challenge"),
        scheme: "exact",
        network: "botchain-testnet",
        asset: "BOT",
        payTo: "0xA882b939c4Ca15c904760b8c240124Cb68cc2A88",
        facilitatorUrlHash: hashObject("https://facilitator.example/x402"),
        descriptionPresent: true,
        expiresAt: now + 600_000,
        evidenceMode: "fallback"
      },
      evidenceMode: "fallback"
    },
    erc8004Trust: {
      status: "recorded",
      agentId: "erc8004:agent:clear402-demo",
      trustSource: "demo_erc8004",
      registrationStatus: "needs_registration",
      decision: "require_approval",
      identityVerified: true,
      endpointMatches: true,
      payToMatches: true,
      reputationScore: 84,
      demoFallbackUsed: true,
      reason: "Demo ERC-8004 trust fixture; live trust remains needs_registration.",
      evidenceMode: "mock"
    },
    paymentContext: {
      status: "recorded",
      paymentContextHash: demoPaymentContextHash,
      version: "clear402.payment.v1",
      missionId,
      providerId: "provider-demo-402",
      quoteId: "quote-demo-402",
      method: "GET",
      origin: "https://provider.example",
      resourcePath: "/paid/report",
      canonicalUrlHash: hashObject("https://provider.example/paid/report"),
      bodyHash: hashObject(""),
      sanitizedResourceHash: hashObject("https://provider.example/paid/report"),
      merchantAddress: "0xA882b939c4Ca15c904760b8c240124Cb68cc2A88",
      facilitatorUrlHash: hashObject("https://facilitator.example/x402"),
      chainId: "968",
      tokenId: "BOT",
      amount: "1000000000000",
      amountDecimals: 18,
      nonce: "nonce-demo-402-0001",
      issuedAt: now,
      expiresAt: now + 600_000,
      quoteTermsHash: hashObject("demo-quote-terms"),
      piiPolicyHash: hashObject("demo-pii-policy"),
      clearSignDigest: hashObject("demo-clearsig"),
      cawPactId: "botchain-service-escrow",
      serviceMode: "escrowed-delivery",
      evidenceMode: "fallback"
    },
    guard: {
      decision: "allow",
      guardEventId: "guard-demo-402",
      layer: "guard_pipeline",
      reason: "Demo fixture guard decision; BOT Chain tx evidence is recorded separately.",
      createdAt: now,
      evidenceMode: "fallback",
      eventCount: 1,
      events: [
        {
          id: "guard-demo-402",
          layer: "guard_pipeline",
          decision: "allow",
          reason: "Demo fixture guard decision; BOT Chain tx evidence is recorded separately.",
          createdAt: now,
          evidenceMode: "fallback"
        }
      ]
    },
    botChainSettlement,
    cawCapabilitySummary,
    serviceReceipt: {
      status: "recorded",
      receiptId: "receipt-demo-402",
      paymentContextHash: `0x${hashObject(`payment-context:${missionId}`).slice(2)}`,
      cawRequestId: "clear402:demo-request",
      cawWalletAddress: "0x7A11E4dA1A6D1F8B9Fb3C3C7d4C6A0eF1Faa2402",
      pactId: "botchain-service-escrow",
      providerAddress: "0xA882b939c4Ca15c904760b8c240124Cb68cc2A88",
      chainId: "968",
      tokenId: "BOT",
      amount: "1000000000000",
      providerResponseHash: hashObject("demo-provider-response"),
      providerSignaturePresent: true,
      responseSchemaHash: hashObject("clear402.provider.report.v1"),
      deliveryTimestamp: now,
      receiptStatus: "delivered",
      clearsigDigest: hashObject("demo-clearsig"),
      auditLogIds: ["audit-demo-402"],
      redactionSummaryHash: hashObject("demo-redaction-summary"),
      evidenceMode: "fallback"
    },
    attackLabSummary,
    limitations: buildLimitations()
  };
}

function buildLimitations() {
  return {
    notes: [
      "The export endpoint is read-only and does not execute BOT Chain transactions.",
      "Demo and attack lab evidence is explicitly labeled fallback or mock.",
      "ERC-8004 demo trust is mock unless a live source verifies registration, reputation, and validation records.",
      "Private keys, RPC secrets, wallet secrets, and environment values are omitted from exports."
    ],
    claimsAllowed: [
      "Clear402 may claim the mission facts in this export only with their displayed evidenceMode labels.",
      "Clear402 may claim BOT Chain testnet settlement only when botChainSettlement.evidenceMode is live and a transaction hash is present.",
      "Clear402 may claim ServiceEscrow deployment only after a BOT Chain explorer-linked contract address and deploy tx are recorded.",
      "Clear402 may claim ERC-8004 trust as live only when the trustSource is live_erc8004 and the registrationStatus is registered.",
      "Clear402 may claim default dashboard demos and attack lab runs do not trigger real BOT Chain transactions."
    ],
    claimsForbidden: [
      "Do not claim mainnet BOT Chain execution.",
      "Do not claim production readiness.",
      "Do not claim production custody or unrestricted AI-agent spending.",
      "Do not claim successful live BOT Chain settlement without explorer-linked tx evidence.",
      "Do not claim demo ERC-8004 trust as live trust.",
      "Do not claim a universal x402 settlement network; this is a challenge demo path."
    ]
  };
}

function recordedScope() {
  return {
    allowPathTransfer: "one recorded Sepolia testnet tiny transfer only",
    policyDenial: "one recorded Sepolia destination-allowlist denial only",
    docs: [
      "docs/caw_capability_report.md",
      "docs/live_caw_testnet_smoke_report.md",
      "docs/live_caw_policy_denial_report.md"
    ]
  };
}

function summarizeEvidenceModes(
  components: Array<{ component: string; evidenceMode: EvidenceMode; note?: string }>
) {
  const counts: Record<EvidenceMode, number> = {
    live: 0,
    fallback: 0,
    mock: 0
  };
  for (const component of components) {
    counts[component.evidenceMode] += 1;
  }

  return {
    overall: components.reduce<EvidenceMode>(
      (current, component) => modeMax(current, component.evidenceMode),
      "live"
    ),
    counts,
    components
  };
}

function modeMax(left: EvidenceMode, right: EvidenceMode): EvidenceMode {
  const rank: Record<EvidenceMode, number> = {
    live: 0,
    fallback: 1,
    mock: 2
  };
  return rank[right] > rank[left] ? right : left;
}

function inferEventEvidenceMode(evidence: Record<string, unknown>, decision: GuardDecision): EvidenceMode {
  const nestedModes = [
    evidenceModeFromRecord(evidence),
    evidenceModeFromRecord(nestedRecord(evidence, ["cawEvidence"])),
    evidenceModeFromRecord(nestedRecord(evidence, ["receipt"])),
    evidenceModeFromRecord(nestedRecord(evidence, ["receiptResult", "receipt"])),
    evidenceModeFromRecord(nestedRecord(evidence, ["trustResult"])),
    evidenceModeFromRecord(nestedRecord(evidence, ["metadataFirewall"])),
    evidenceModeFromRecord(nestedRecord(evidence, ["challenge"]))
  ].filter((mode): mode is EvidenceMode => mode !== undefined);

  if (nestedModes.length > 0) {
    return nestedModes.reduce(modeMax, "live");
  }

  if (decision === "fallback_required" || decision === "require_approval") {
    return "fallback";
  }

  return "live";
}

function evidenceModeFromRecord(record: Record<string, unknown> | undefined): EvidenceMode | undefined {
  const value = record?.evidenceMode;
  return value === "live" || value === "fallback" || value === "mock" ? value : undefined;
}

function recordsFromCapabilityReport(report: unknown): CawCapabilitySummary["records"] {
  if (!isRecord(report) || !Array.isArray(report.records)) {
    return [];
  }

  return report.records
    .filter(isRecord)
    .map((record) => {
      const capability = stringValue(record.capability);
      const status = stringValue(record.status);
      const evidenceMode = evidenceModeFromRecord(record);
      if (!capability || !status || !evidenceMode) {
        return undefined;
      }

      return {
        capability,
        status,
        evidenceMode,
        ...(stringValue(record.notes) ? { notes: stringValue(record.notes) } : {})
      };
    })
    .filter((record): record is CawCapabilitySummary["records"][number] => record !== undefined);
}

function summarizeCapabilityRecords(records: CawCapabilitySummary["records"]) {
  return {
    verified: records.filter((record) => record.status === "verified").length,
    needsManualStep: records.filter((record) => record.status === "needs_manual_step").length,
    unavailable: records.filter((record) => record.status === "unavailable").length,
    fallbackRequired: records.filter((record) => record.status === "fallback_required").length
  };
}

function modeFromRecords(records: CawCapabilitySummary["records"]): EvidenceMode {
  return records.map((record) => record.evidenceMode).reduce(modeMax, "live");
}

function booleanFromRecord(record: unknown, key: string): boolean | undefined {
  if (!isRecord(record)) {
    return undefined;
  }

  return typeof record[key] === "boolean" ? record[key] : undefined;
}

function latestNestedRecord(
  parsedGuardEvents: Array<{ event: GuardEventRow; evidence: Record<string, unknown> }>,
  key: string
) {
  for (const { evidence } of [...parsedGuardEvents].reverse()) {
    const nested = nestedRecord(evidence, [key]);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function nestedRecord(record: Record<string, unknown> | undefined, path: string[]) {
  let current: unknown = record;
  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }

  return isRecord(current) ? current : undefined;
}

function parseRecord(value: string | unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: string | null | undefined): unknown[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function missingFacts(reason: string): MissingFacts {
  return {
    status: "not_recorded",
    evidenceMode: "fallback",
    reason
  };
}

function sanitizeEvidenceExport(evidenceExport: EvidenceExport): EvidenceExport {
  return redactSecrets(evidenceExport) as EvidenceExport;
}

function redactSecrets(value: unknown, key = ""): unknown {
  if (isSensitiveKey(key)) {
    return "[redacted]";
  }

  if (typeof value === "string") {
    return isSecretLike(value) ? "[redacted]" : value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactSecrets(entry));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactSecrets(entryValue, entryKey)
      ])
    );
  }

  return value;
}

function isSensitiveKey(key: string) {
  return /(^|[_-])(api[_-]?key|secret|private[_-]?key|mnemonic|password|authorization|cookie|pairing[_-]?token|access[_-]?token|refresh[_-]?token|env[_-]?value)([_-]|$)/i.test(
    key
  );
}

function isSecretLike(value: string) {
  return (
    /sk-[A-Za-z0-9_-]{8,}/.test(value) ||
    /CLEAR402_CAW_[A-Z0-9_]*=/.test(value) ||
    /BEGIN [A-Z ]*PRIVATE KEY/.test(value)
  );
}

function renderPaymentContextMarkdown(paymentContext: PaymentContextFacts | MissingFacts) {
  if (paymentContext.status === "not_recorded") {
    return [`- Status: \`not_recorded\``, `- Reason: ${paymentContext.reason}`];
  }

  return [
    `- PaymentContext hash: \`${paymentContext.paymentContextHash}\``,
    `- Provider ID: \`${paymentContext.providerId}\``,
    `- Quote ID: \`${paymentContext.quoteId}\``,
    `- Method: \`${paymentContext.method}\``,
    `- Origin: \`${paymentContext.origin}\``,
    `- Resource path: \`${paymentContext.resourcePath}\``,
    `- Amount: \`${paymentContext.amount}\``,
    `- Chain / token: \`${paymentContext.chainId}/${paymentContext.tokenId}\``,
    `- Service mode: \`${paymentContext.serviceMode}\``
  ];
}

function renderERC8004TrustMarkdown(erc8004Trust: ERC8004TrustFacts | MissingFacts) {
  if (erc8004Trust.status === "not_recorded") {
    return [`- Status: \`not_recorded\``, `- Reason: ${erc8004Trust.reason}`];
  }

  return [
    `- Agent ID: \`${erc8004Trust.agentId}\``,
    `- Trust source: \`${erc8004Trust.trustSource}\``,
    `- Registration status: \`${erc8004Trust.registrationStatus}\``,
    `- Decision: \`${erc8004Trust.decision}\``,
    `- Endpoint matches: \`${String(erc8004Trust.endpointMatches)}\``,
    `- payTo matches: \`${String(erc8004Trust.payToMatches)}\``,
    `- Demo fallback used: \`${String(erc8004Trust.demoFallbackUsed)}\``,
    `- Live source: \`${erc8004Trust.liveSource?.source ?? "n/a"}:${erc8004Trust.liveSource?.status ?? "n/a"}\``,
    `- Evidence mode: \`${erc8004Trust.evidenceMode}\``,
    `- Reason: ${erc8004Trust.reason ?? "n/a"}`
  ];
}

function renderReceiptMarkdown(serviceReceipt: ServiceReceiptFacts | MissingFacts) {
  if (serviceReceipt.status === "not_recorded") {
    return [`- Status: \`not_recorded\``, `- Reason: ${serviceReceipt.reason}`];
  }

  return [
    `- Receipt ID: \`${serviceReceipt.receiptId ?? "n/a"}\``,
    `- Status: \`${serviceReceipt.receiptStatus ?? "n/a"}\``,
    `- PaymentContext hash: \`${serviceReceipt.paymentContextHash ?? "n/a"}\``,
    `- CAW request ID: \`${serviceReceipt.cawRequestId ?? "n/a"}\``,
    `- TX hash: \`${serviceReceipt.txHash ?? "n/a"}\``,
    `- Provider response hash: \`${serviceReceipt.providerResponseHash ?? "n/a"}\``,
    `- Provider signature present: \`${String(serviceReceipt.providerSignaturePresent)}\``,
    `- Evidence mode: \`${serviceReceipt.evidenceMode}\``
  ];
}

function renderDualReceiptMarkdown(dualReceipt: DualReceiptFacts | MissingFacts | undefined) {
  if (!dualReceipt || dualReceipt.status === "not_recorded") {
    return [`- Status: \`not_recorded\``, `- Reason: ${dualReceipt?.reason ?? "n/a"}`];
  }

  return [
    `- Dual receipt hash: \`${dualReceipt.dualReceiptHash ?? "n/a"}\``,
    `- Payment receipt hash: \`${dualReceipt.paymentReceiptHash ?? "n/a"}\``,
    `- Delivery receipt hash: \`${dualReceipt.deliveryReceiptHash ?? "n/a"}\``,
    `- Verification decision: \`${dualReceipt.verificationDecision ?? "n/a"}\``,
    `- Verification result present: \`${String(dualReceipt.verificationResult !== undefined)}\``
  ];
}

function summarizeText(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}

function escapeTableCell(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function erc8004TrustSourceValue(value: unknown): ERC8004TrustFacts["trustSource"] {
  return value === "live_erc8004" || value === "demo_erc8004" || value === "unavailable"
    ? value
    : "unavailable";
}

function erc8004RegistrationStatusValue(
  value: unknown
): ERC8004TrustFacts["registrationStatus"] {
  return value === "registered" || value === "needs_registration" || value === "unavailable"
    ? value
    : "unavailable";
}

function requireString(value: unknown, fallback: string) {
  return stringValue(value) ?? fallback;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
