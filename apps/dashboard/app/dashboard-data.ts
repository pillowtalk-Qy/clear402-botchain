export type EvidenceMode = "live" | "fallback" | "mock";

export type DashboardPreset = "demo" | "investigate" | "attack" | "evidence";

export type PanelState =
  | "idle"
  | "loading"
  | "live"
  | "fallback"
  | "mock"
  | "blocked"
  | "denied"
  | "pending_approval"
  | "success"
  | "empty"
  | "error";

export type ReasonCode =
  | "MARKET_DATA_REQUEST"
  | "RESEARCH_DATASET_ACCESS"
  | "MODEL_INFERENCE_PAYMENT"
  | "ESCROWED_SERVICE_DELIVERY";

export type ServiceMode =
  | "caw-fetch"
  | "direct-transfer"
  | "escrowed-delivery";

export type AttackResult = "blocked" | "fallback" | "mock" | "success" | "idle";

export interface HealthSnapshot {
  service: string;
  status: "ok" | "down";
  evidenceMode: EvidenceMode;
  timestamp: string;
  version: string;
  details?: Record<string, unknown>;
  endpoint: string;
  error?: string;
}

export interface MissionDraft {
  prompt: string;
  budgetUsd: string;
  resourceUrl: string;
}

export type MissionFlowSource = "runtime_api" | "frontend_fallback" | "demo_fixture";

export interface MissionState {
  id?: string;
  userPrompt: string;
  budgetUsd: string;
  resourceUrl: string;
  status: "draft" | "active" | "blocked" | "complete" | "failed";
  cawWalletUuid: string;
  cawWalletAddress: string;
  pactId?: string;
  createdAt?: number;
  evidenceMode: EvidenceMode;
}

export interface CawCapabilityRecord {
  capability: string;
  status: "verified" | "needs_manual_step" | "unavailable" | "fallback_required";
  evidenceMode: EvidenceMode;
  rawEvidenceRef?: string;
  notes?: string;
}

export interface CawAuditLog {
  id: string;
  outcome: "allow" | "deny" | "pending_approval" | "fallback";
  evidenceMode: EvidenceMode;
  note: string;
  timestamp: number;
}

export interface CawPanelState {
  environment: string;
  walletUuid: string;
  walletAddress: string;
  pactId: string;
  pactScopedApiKeyStatus: "allowed" | "pending" | "blocked" | "fallback_required";
  transactionStatus: "idle" | "prepared" | "submitted" | "denied" | "finalized";
  auditLogs: CawAuditLog[];
  capabilityReport: CawCapabilityRecord[];
  evidenceMode: EvidenceMode;
}

export interface BotChainSettlementState {
  network: string;
  chainId: string;
  rpcUrl: string;
  explorerBaseUrl: string;
  contractName: string;
  contractAddress: string;
  deployTxHash: string;
  interactionTxHash: string;
  paymentContextHash: string;
  escrowAction: "pending" | "fund" | "deliver" | "refund";
  settlementStatus: "not_deployed" | "deployed" | "guarded" | "submitted" | "confirmed" | "fallback_required";
  blockNumber?: string;
  explorerLinks: {
    contract?: string;
    deployTx?: string;
    interactionTx?: string;
  };
  evidenceMode: EvidenceMode;
  note: string;
}

export interface ChallengeInspectorState {
  rawChallenge: Record<string, unknown> | null;
  normalizedChallenge: Record<string, unknown> | null;
  providerRegistryResult: Record<string, unknown> | null;
  settlementPath: string;
  evidenceMode: EvidenceMode;
  state: PanelState;
}

export interface ProviderTrustState {
  providerId: string;
  registryEntry: Record<string, unknown>;
  trustResult: Record<string, unknown>;
  evidenceMode: EvidenceMode;
  state: PanelState;
}

export interface FirewallState {
  before: {
    resourceUrl: string;
    description: string;
    reason: string;
  };
  after: {
    resourceUrl: string;
    description: string;
    reason: string;
  };
  reasonCode: ReasonCode;
  findings: Array<{
    field: "resourceUrl" | "description" | "reason";
    entityType: string;
    action: string;
    confidence: number;
  }>;
  decision: "allow" | "redact" | "hash_only" | "require_approval" | "block";
  piiPolicyHash: string;
  latencyMs: number;
  evidenceMode: EvidenceMode;
}

export interface PaymentContextState {
  version: "clear402.payment.v1";
  missionId: string;
  providerId: string;
  quoteId: string;
  method: "GET" | "POST";
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
  clearSignDigest: string;
  cawPactId: string;
  serviceMode: ServiceMode;
  paymentContextHash: string;
  requestId: string;
  evidenceMode: EvidenceMode;
}

export interface ClearSignState {
  input: {
    chainId: string;
    to: string;
    calldata: string;
    value: string;
    typedData: Record<string, unknown>;
    expected: {
      merchantAddress: string;
      amount: string;
      tokenId: string;
      allowedSelectors: string[];
      paymentContextHash: string;
    };
  };
  result: {
    decision: "allow" | "require_approval" | "block";
    intent: string;
    functionSignature: string;
    selector: string;
    decodedParams: Record<string, unknown>;
    calldataDigest: string;
    typedDataDigest: string;
    riskTags: string[];
    reason: string;
  };
  evidenceMode: EvidenceMode;
}

export interface TimelineEvent {
  id: string;
  title: string;
  detail: string;
  evidenceMode: EvidenceMode;
  status: "allow" | "blocked" | "pending_approval" | "success" | "fallback" | "mock" | "live";
  timestamp: number;
  auditLogId?: string;
  source?: "runtime_sse" | "dashboard";
}

export interface RuntimeTimelineSsePayload {
  eventId?: string;
  eventType?: "mission" | "guard" | "receipt" | "attack";
  createdAt?: number;
  missionId?: string;
  payload?: Record<string, unknown>;
}

export interface ReceiptState {
  receiptId: string;
  paymentReceipt: {
    status: "paid" | "refundable" | "refunded";
    requestId: string;
    walletAddress: string;
    pactId: string;
    amount: string;
    txHash?: string;
    evidenceMode: EvidenceMode;
  };
  deliveryReceipt: {
    status: "empty" | "delivered" | "failed" | "paid_but_not_delivered";
    responseHash: string;
    providerSignature: string;
    schemaHash: string;
    redactionSummaryHash?: string;
    evidenceMode: EvidenceMode;
  };
  finalStatus:
    | "paid"
    | "delivered"
    | "failed"
    | "refundable"
    | "refunded"
    | "paid_but_not_delivered";
  auditLogIds: string[];
  evidenceMode: EvidenceMode;
}

export interface AttackScenario {
  id: string;
  title: string;
  paper: string;
  blockedLayer: string;
  summary: string;
  evidenceMode: EvidenceMode;
  resultState: AttackResult;
  resultDetail?: string;
  evidenceRef?: string;
  guardEventId?: string;
  runCount: number;
}

export interface EvidenceExportState {
  generatedAt: number;
  evidenceMode: EvidenceMode;
  source: "server_side" | "frontend_fallback";
  runtimeSource?: string;
  json: string;
  markdown: string;
  stale: boolean;
}

export interface DashboardWorkspace {
  preset: DashboardPreset;
  actionSource: MissionFlowSource;
  runtimeHealth: HealthSnapshot;
  providerHealth: HealthSnapshot;
  missionDraft: MissionDraft;
  mission: MissionState;
  caw: CawPanelState;
  botChain: BotChainSettlementState;
  challenge: ChallengeInspectorState;
  providerTrust: ProviderTrustState;
  firewall: FirewallState;
  paymentContext: PaymentContextState;
  clearSign: ClearSignState;
  timeline: TimelineEvent[];
  receipt: ReceiptState;
  attacks: AttackScenario[];
  evidence: EvidenceExportState | null;
  selectedAttackId: string;
}

export interface DashboardRuntimeSnapshot {
  runtime: HealthSnapshot;
  provider: HealthSnapshot;
}

export interface DashboardInitOptions extends DashboardRuntimeSnapshot {
  preset: DashboardPreset;
  botChainEvidence?: Partial<BotChainSettlementState>;
}

export interface PreferredEvidenceExportResult {
  evidence: EvidenceExportState;
  usedRuntime: boolean;
  fallbackReason?: string;
}

export interface PreferredEvidenceExportOptions {
  fetcher?: typeof fetch;
  basePath?: string;
  now?: number;
}

export interface RuntimeMissionFlowOptions {
  fetcher?: typeof fetch;
  basePath?: string;
  now?: number;
}

export interface RuntimeMissionFlowResult {
  workspace: DashboardWorkspace;
  usedRuntime: boolean;
  source: MissionFlowSource;
  fallbackReason?: string;
}

type MissionFlowActionType =
  | "create-mission"
  | "dry-run"
  | "prepare-guard"
  | "execute-payment"
  | "verify-receipt";

const sampleProviderId = "provider-markets-01";
const sampleWalletUuid = "wallet-demo-402";
const sampleWalletAddress = "0x7A11E4dA1A6D1F8B9Fb3C3C7d4C6A0eF1Faa2402";
const sampleBotChainProviderAddress = "0xA882b939c4Ca15c904760b8c240124Cb68cc2A88";
const sampleMissionId = "mission-demo-402";
const samplePactId = "pact-demo-402";
const sampleQuoteId = "quote-demo-402";
const sampleRequestId = "clear402:7ad4e2d9c1bf6a01";
const samplePaymentContextHash = "0x7ad4e2d9c1bf6a011d0b4a1c2fd31f92d4b73f9d8d1e8c8b3f0a1a2c3d4e5f60";
const sampleRawChallengeHash = "0x42a10f8a9d0c5f8f10c0f0a71e4c80b1f7b1e965d43de2b8e2a0a8c7d9e3f110";
const sampleCanonicalUrlHash = "0x8f1298e3d7c2a0f1d3e9c5b7a4f0b1c28d97aa3d1f2c4e6f8b0a1c2d3e4f5678";
const sampleBodyHash = "0x0d5c1a2b3e4f5061728394a5b6c7d8e9f102030405060708090a0b0c0d0e0f10";
const sampleSanitizedResourceHash = "0x91aa21b0d4c5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f";
const sampleQuoteTermsHash = "0x6b7fe4010a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef01234567";
const samplePiiPolicyHash = "0x4c0dd9a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e";
const sampleClearSignDigest = "0x9a11c33d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcde0";
const sampleProviderResponseHash = "0xbadf00d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef1";
const sampleResponseSchemaHash = "0x5d4c3b2a1908f7e6d5c4b3a29180706050403020100ffeeddccbbaa99887766";
const sampleRedactionSummaryHash = "0x22ab33cd44ef55aa66bb77cc88dd99ee00ff11aa22bb33cc44dd55ee66ff7788";
const samplePiiReason = "MODEL_INFERENCE_PAYMENT";
const botChainNetwork = "BOT Chain Testnet";
const botChainChainId = "968";
const botChainRpcUrl = "https://rpc.bohr.life";
const botChainExplorerBaseUrl = "https://scan.bohr.life";

const attackDefinitions: AttackScenario[] = [
  {
    id: "replay",
    title: "Replay same nonce",
    paper: "Five Attacks on x402",
    blockedLayer: "Quote reservation / nonce lock",
    summary: "Second attempt with the same request id is rejected and recorded.",
    evidenceMode: "mock",
    resultState: "idle",
    runCount: 0
  },
  {
    id: "substitution",
    title: "Cross-resource substitution",
    paper: "Five Attacks on x402",
    blockedLayer: "PaymentContext binding",
    summary: "The request path no longer matches the approved quote and is blocked.",
    evidenceMode: "mock",
    resultState: "idle",
    runCount: 0
  },
  {
    id: "pii",
    title: "PII metadata leak",
    paper: "Hardening x402",
    blockedLayer: "Metadata firewall",
    summary: "Email, token, and customer-id fragments are redacted before guard prepare.",
    evidenceMode: "mock",
    resultState: "idle",
    runCount: 0
  },
  {
    id: "price",
    title: "Dynamic price jump",
    paper: "Five Attacks on x402",
    blockedLayer: "Quote reservation / budget ledger",
    summary: "A higher amount than the reserved quote is denied before execution.",
    evidenceMode: "mock",
    resultState: "idle",
    runCount: 0
  },
  {
    id: "approve",
    title: "Malicious approve",
    paper: "Hardening x402",
    blockedLayer: "Clear signing",
    summary: "Unlimited approval to the wrong spender is blocked by semantic inspection.",
    evidenceMode: "mock",
    resultState: "idle",
    runCount: 0
  },
  {
    id: "poisoning",
    title: "Discovery poisoning",
    paper: "Free-Riding in the AI Economy",
    blockedLayer: "Provider registry",
    summary: "An unregistered provider origin fails the allowlist and trust checks.",
    evidenceMode: "mock",
    resultState: "idle",
    runCount: 0
  },
  {
    id: "denied",
    title: "Paid-but-denied",
    paper: "A402 / x402 papers",
    blockedLayer: "Service receipt",
    summary: "Payment lands, delivery does not. The final receipt stays non-successful.",
    evidenceMode: "mock",
    resultState: "idle",
    runCount: 0
  }
];

function cloneAttackDefinitions() {
  return attackDefinitions.map((attack) => ({ ...attack }));
}

function compactHash(value: string, head = 10, tail = 8) {
  if (value.length <= head + tail + 3) {
    return value;
  }

  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function modeFromHealth(snapshot: HealthSnapshot): EvidenceMode {
  if (snapshot.evidenceMode === "live") {
    return "live";
  }

  if (snapshot.evidenceMode === "fallback") {
    return "fallback";
  }

  return "mock";
}

function stableJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceEvidenceMode(value: unknown): EvidenceMode {
  if (value === "live" || value === "fallback" || value === "mock") {
    return value;
  }

  return "fallback";
}

function coerceTimelineStatus(
  value: unknown,
  eventType: RuntimeTimelineSsePayload["eventType"]
): TimelineEvent["status"] {
  if (
    value === "allow" ||
    value === "blocked" ||
    value === "pending_approval" ||
    value === "success" ||
    value === "fallback" ||
    value === "mock" ||
    value === "live"
  ) {
    return value;
  }

  if (eventType === "receipt") {
    return "fallback";
  }

  if (eventType === "attack") {
    return "blocked";
  }

  return "success";
}

function runtimeTimelineDefaultTitle(eventType: RuntimeTimelineSsePayload["eventType"]) {
  if (eventType === "guard") {
    return "Guard event";
  }

  if (eventType === "receipt") {
    return "Receipt recorded";
  }

  if (eventType === "attack") {
    return "Attack event";
  }

  return "Mission event";
}

function isSecretLikeKey(key: string) {
  return /(?:api[_-]?key|secret|password|authorization|bearer|private[_-]?key|session|cookie|providerSignature)$/i.test(
    key
  );
}

export function redactSecretLikeText(value: string) {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\bCUST-\d+\b/g, "[redacted-customer-id]")
    .replace(/\bCLEAR402_CAW_[A-Z0-9_]*=[^\s"',)]+/g, "[redacted-secret]")
    .replace(/\bsk-(?:live|test)-[A-Za-z0-9_-]+/g, "[redacted-secret]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[redacted-secret]")
    .replace(/\b(API\s+token\s+)[^\s.]+/gi, "$1[redacted-secret]")
    .replace(/\b(x-api-key\s*[:=]\s*)[^\s"',)]+/gi, "$1[redacted-secret]");
}

export function sanitizeEvidenceForDisplay(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSecretLikeText(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeEvidenceForDisplay(entry));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        isSecretLikeKey(key) ? "[redacted-secret]" : sanitizeEvidenceForDisplay(entry)
      ])
    );
  }

  return value;
}

function buildTimelineItem(
  id: string,
  title: string,
  detail: string,
  status: TimelineEvent["status"],
  evidenceMode: EvidenceMode,
  timestamp: number,
  auditLogId?: string
): TimelineEvent {
  const item: TimelineEvent = {
    id,
    title,
    detail,
    status,
    evidenceMode,
    timestamp
  };

  if (auditLogId) {
    item.auditLogId = auditLogId;
  }

  return item;
}

function buildExplorerLink(baseUrl: string, kind: "address" | "tx", value: string) {
  if (!value || value === "TODO_AFTER_DEPLOY" || value === "TODO_AFTER_INTERACTION" || value === "pending") {
    return undefined;
  }

  return `${baseUrl.replace(/\/$/, "")}/${kind}/${value}`;
}

function createBotChainSettlementState(
  paymentContextHash: string,
  evidence?: Partial<BotChainSettlementState>
): BotChainSettlementState {
  const explorerBaseUrl = evidence?.explorerBaseUrl ?? botChainExplorerBaseUrl;
  const contractAddress = evidence?.contractAddress ?? "TODO_AFTER_DEPLOY";
  const deployTxHash = evidence?.deployTxHash ?? "TODO_AFTER_DEPLOY";
  const interactionTxHash = evidence?.interactionTxHash ?? "TODO_AFTER_INTERACTION";
  const evidenceMode = evidence?.evidenceMode ?? "fallback";
  const settlementStatus =
    evidence?.settlementStatus ??
    (evidenceMode === "live" && interactionTxHash !== "TODO_AFTER_INTERACTION" ? "confirmed" : "not_deployed");
  const contractLink = evidence?.explorerLinks?.contract ?? buildExplorerLink(explorerBaseUrl, "address", contractAddress);
  const deployTxLink = evidence?.explorerLinks?.deployTx ?? buildExplorerLink(explorerBaseUrl, "tx", deployTxHash);
  const interactionTxLink =
    evidence?.explorerLinks?.interactionTx ?? buildExplorerLink(explorerBaseUrl, "tx", interactionTxHash);

  return {
    network: evidence?.network ?? botChainNetwork,
    chainId: evidence?.chainId ?? botChainChainId,
    rpcUrl: evidence?.rpcUrl ?? botChainRpcUrl,
    explorerBaseUrl,
    contractName: evidence?.contractName ?? "ServiceEscrow",
    contractAddress,
    deployTxHash,
    interactionTxHash,
    paymentContextHash: evidence?.paymentContextHash ?? paymentContextHash,
    escrowAction: evidence?.escrowAction ?? (interactionTxHash !== "TODO_AFTER_INTERACTION" ? "fund" : "pending"),
    settlementStatus,
    ...(evidence?.blockNumber ? { blockNumber: evidence.blockNumber } : {}),
    explorerLinks: {
      ...(contractLink ? { contract: contractLink } : {}),
      ...(deployTxLink ? { deployTx: deployTxLink } : {}),
      ...(interactionTxLink ? { interactionTx: interactionTxLink } : {})
    },
    evidenceMode,
    note:
      evidence?.note ??
      "BOT Chain testnet settlement is pending until ServiceEscrow deployment and interaction tx hashes are recorded."
  };
}

export function formatCompactHash(value: string) {
  return compactHash(value);
}

export function formatRequestId(paymentContextHash: string) {
  return `clear402:${paymentContextHash.replace(/^0x/, "").slice(0, 16)}`;
}

export function runtimeTimelineEventToDashboardItem(
  event: RuntimeTimelineSsePayload
): TimelineEvent | undefined {
  if (!event.eventId || !event.missionId || !event.eventType || !isRecord(event.payload)) {
    return undefined;
  }

  const payload = sanitizeEvidenceForDisplay(event.payload) as Record<string, unknown>;
  const status = coerceTimelineStatus(payload.status, event.eventType);
  const item: TimelineEvent = {
    id: event.eventId,
    title: typeof payload.title === "string" ? payload.title : runtimeTimelineDefaultTitle(event.eventType),
    detail:
      typeof payload.detail === "string"
        ? payload.detail
        : `${runtimeTimelineDefaultTitle(event.eventType)} recorded by runtime timeline.`,
    status,
    evidenceMode: coerceEvidenceMode(payload.evidenceMode),
    timestamp: typeof event.createdAt === "number" ? event.createdAt : Date.now(),
    source: "runtime_sse"
  };

  const auditLogId = payload.auditLogId ?? payload.guardEventId;
  if (typeof auditLogId === "string") {
    item.auditLogId = auditLogId;
  }

  return item;
}

export function mergeRuntimeTimelineItem(
  workspace: DashboardWorkspace,
  item: TimelineEvent
): DashboardWorkspace {
  const next = structuredClone(workspace) as DashboardWorkspace;
  const existingIndex = next.timeline.findIndex((candidate) => candidate.id === item.id);
  if (existingIndex >= 0) {
    next.timeline[existingIndex] = item;
  } else {
    next.timeline.unshift(item);
  }

  next.timeline.sort((left, right) => right.timestamp - left.timestamp || right.id.localeCompare(left.id));
  return next;
}

export function createInitialWorkspace(options: DashboardInitOptions): DashboardWorkspace {
  const createdAt = Date.now();
  const missionDraft: MissionDraft = {
    prompt: "Request protected market data for the research desk.",
    budgetUsd: "1000000000000",
    resourceUrl: "https://127.0.0.1:4010/paid/report?topic=market-intel"
  };

  const mission: MissionState = {
    userPrompt: missionDraft.prompt,
    budgetUsd: missionDraft.budgetUsd,
    resourceUrl: missionDraft.resourceUrl,
    status: "draft",
    cawWalletUuid: sampleWalletUuid,
    cawWalletAddress: sampleWalletAddress,
    evidenceMode: "mock"
  };

  const caw: CawPanelState = {
    environment: "local-demo",
    walletUuid: sampleWalletUuid,
    walletAddress: sampleWalletAddress,
    pactId: samplePactId,
    pactScopedApiKeyStatus: "fallback_required",
    transactionStatus: "idle",
    evidenceMode: "fallback",
    capabilityReport: [
      {
        capability: "wallet_status",
        status: "verified",
        evidenceMode: options.runtime.evidenceMode,
        rawEvidenceRef: "runtime/health",
        notes: "Runtime health endpoint is live."
      },
      {
        capability: "pact_submit",
        status: "needs_manual_step",
        evidenceMode: "fallback",
        rawEvidenceRef: "contracts/BOTCHAIN_DEPLOYMENT.md",
        notes: "BOT Chain live settlement requires recorded ServiceEscrow deploy and interaction tx hashes."
      },
      {
        capability: "request_tracking",
        status: "fallback_required",
        evidenceMode: "mock",
        notes: "Initial dashboard state uses a deterministic demo request id until the runtime mission flow runs."
      }
    ],
    auditLogs: [
      {
        id: "audit-001",
        outcome: "allow",
        evidenceMode: options.runtime.evidenceMode,
        note: "Runtime service is live and reachable.",
        timestamp: createdAt - 60_000
      },
      {
        id: "audit-002",
        outcome: "fallback",
        evidenceMode: "fallback",
        note: "Runtime mission APIs are available; BOT Chain settlement stays fallback until tx hashes are recorded.",
        timestamp: createdAt - 30_000
      }
    ]
  };

  const botChain = createBotChainSettlementState(samplePaymentContextHash, options.botChainEvidence);

  const challenge: ChallengeInspectorState = {
    rawChallenge: null,
    normalizedChallenge: null,
    providerRegistryResult: null,
    settlementPath: "botchain_service_escrow_pending",
    evidenceMode: "mock",
    state: "empty"
  };

  const providerTrust: ProviderTrustState = {
    providerId: sampleProviderId,
    registryEntry: {
      providerId: sampleProviderId,
      origin: "http://127.0.0.1:4010",
      merchantAddress: sampleBotChainProviderAddress,
      facilitatorUrl: "https://facilitator.clear402.local/botchain",
      chainId: botChainChainId,
      tokenId: "BOT",
      publicKey: "0x04botchain_demo_public_key",
      allowedResources: ["/paid/report", "/v1/market-intel"],
      cawAllowlistStatus: "pending",
      erc8004AgentId: "erc8004:agent:clear402-demo",
      erc8004AgentUri: "https://erc8004.example/agents/clear402-demo",
      reputationThreshold: 72,
      validationTags: [
        "x402_endpoint_verified",
        "delivery_receipt_verified",
        "pii_safe_metadata"
      ]
    },
    trustResult: {
      agentId: "erc8004:agent:clear402-demo",
      trustSource: "demo_erc8004",
      registrationStatus: "needs_registration",
      identityVerified: true,
      endpointMatches: true,
      payToMatches: true,
      reputationScore: 84,
      deliverySuccessRate: 0.97,
      paidButDeniedReports: 0,
      validationAttestations: [
        { tag: "x402_endpoint_verified", issuer: "Clear402 demo registry" },
        { tag: "delivery_receipt_verified", issuer: "Clear402 receipt verifier" },
        { tag: "pii_safe_metadata", issuer: "Clear402 metadata firewall" }
      ],
      decision: "require_approval",
      reason: "ERC-8004 trust is demo-backed until a Clear402 provider is registered on live ERC-8004.",
      demoFallbackUsed: true,
      evidenceMode: "mock"
    },
    evidenceMode: "fallback",
    state: "empty"
  };

  const firewall: FirewallState = {
    before: {
      resourceUrl: missionDraft.resourceUrl,
      description: "Research access for alice@example.com using customer-id CUST-1442 and API token xyz.",
      reason: "Requesting market intel for the research desk with account context."
    },
    after: {
      resourceUrl: "https://127.0.0.1:4010/paid/report?topic=market-intel",
      description: "Research access for [redacted-email] using [redacted-customer-id] and [redacted-token].",
      reason: "MODEL_INFERENCE_PAYMENT"
    },
    reasonCode: samplePiiReason as ReasonCode,
    findings: [
      {
        field: "description",
        entityType: "email",
        action: "redact",
        confidence: 0.98
      },
      {
        field: "description",
        entityType: "customer-id",
        action: "redact",
        confidence: 0.95
      },
      {
        field: "reason",
        entityType: "free-text-risk",
        action: "hash_only",
        confidence: 0.86
      }
    ],
    decision: "redact",
    piiPolicyHash: samplePiiPolicyHash,
    latencyMs: 16,
    evidenceMode: "fallback"
  };

  const paymentContext: PaymentContextState = {
    version: "clear402.payment.v1",
    missionId: sampleMissionId,
    providerId: sampleProviderId,
    quoteId: sampleQuoteId,
    method: "POST",
    origin: "http://127.0.0.1:4010",
    resourcePath: "/paid/report",
    canonicalUrlHash: sampleCanonicalUrlHash,
    bodyHash: sampleBodyHash,
    sanitizedResourceHash: sampleSanitizedResourceHash,
    merchantAddress: sampleBotChainProviderAddress,
    facilitatorUrlHash: "0x98f04botchainfacilitatorhash",
    chainId: botChainChainId,
    tokenId: "BOT",
    amount: "1000000000000",
    amountDecimals: 18,
    nonce: "nonce-demo-402-0001",
    issuedAt: createdAt - 10_000,
    expiresAt: createdAt + 5 * 60_000,
    quoteTermsHash: sampleQuoteTermsHash,
    piiPolicyHash: samplePiiPolicyHash,
    clearSignDigest: sampleClearSignDigest,
    cawPactId: samplePactId,
    serviceMode: "escrowed-delivery",
    paymentContextHash: samplePaymentContextHash,
    requestId: sampleRequestId,
    evidenceMode: "fallback"
  };

  const clearSign: ClearSignState = {
    input: {
      chainId: botChainChainId,
      to: sampleBotChainProviderAddress,
      calldata:
        "0xa9059cbb0000000000000000000000007a11e4da1a6d1f8b9fb3c3c7d4c6a0ef1faa2402000000000000000000000000000000000000000000000000056bc75e2d63100000",
      value: "1000000000000",
      typedData: {
        domain: { name: "Clear402 for BOT Chain", version: "1", chainId: 968 },
        message: {
          amount: "0.000001 BOT",
          resource: "/paid/report",
          paymentContextHash: samplePaymentContextHash
        }
      },
      expected: {
        merchantAddress: sampleBotChainProviderAddress,
        amount: "1000000000000",
        tokenId: "BOT",
        allowedSelectors: ["0x9f3c6c55", "0x3f4ba83a", "0x590e1ae3"],
        paymentContextHash: samplePaymentContextHash
      }
    },
    result: {
      decision: "allow",
      intent: "Fund ServiceEscrow with 0.000001 BOT for /paid/report",
      functionSignature: "fund(bytes32,address,uint256)",
      selector: "0x9f3c6c55",
      decodedParams: {
        paymentContextHash: samplePaymentContextHash,
        provider: sampleBotChainProviderAddress,
        amount: "0.000001 BOT"
      },
      calldataDigest: "0x5d1f8d5ed1f8d5ed1f8d5ed1f8d5ed1f8d5ed1f8d5ed1f8d5ed1f8d5ed1f8d5e",
      typedDataDigest: sampleClearSignDigest,
      riskTags: ["selector_known", "provider_match", "amount_match", "chain_match"],
      reason: "Approved because the BOT Chain escrow intent matches PaymentContext."
    },
    evidenceMode: "fallback"
  };

  const receipt: ReceiptState = {
    receiptId: "receipt-demo-402",
    paymentReceipt: {
      status: "paid",
      requestId: sampleRequestId,
      walletAddress: sampleWalletAddress,
      pactId: samplePactId,
      amount: "0.000001 BOT",
      evidenceMode: options.runtime.evidenceMode
    },
    deliveryReceipt: {
      status: "empty",
      responseHash: sampleProviderResponseHash,
      providerSignature: "0xprovider_signature_demo",
      schemaHash: sampleResponseSchemaHash,
      redactionSummaryHash: sampleRedactionSummaryHash,
      evidenceMode: "mock"
    },
    finalStatus: "paid_but_not_delivered",
    auditLogIds: ["audit-001", "audit-002"],
    evidenceMode: "fallback"
  };

  const timeline: TimelineEvent[] = [
    buildTimelineItem(
      "timeline-001",
      "Runtime health reached",
      `Runtime endpoint ${options.runtime.endpoint} responded as ${options.runtime.evidenceMode}.`,
      "allow",
      options.runtime.evidenceMode,
      createdAt - 60_000,
      "audit-001"
    ),
    buildTimelineItem(
      "timeline-002",
      "Provider health reached",
      `Provider endpoint ${options.provider.endpoint} responded as ${options.provider.evidenceMode}.`,
      "allow",
      options.provider.evidenceMode,
      createdAt - 55_000
    ),
    buildTimelineItem(
      "timeline-003",
      "Guard pipeline staged",
      "Mission payload is ready for challenge inspection, firewall redaction, and clear signing.",
      "fallback",
      "fallback",
      createdAt - 30_000
    )
  ];

  return {
    preset: options.preset,
    actionSource: "demo_fixture",
    runtimeHealth: options.runtime,
    providerHealth: options.provider,
    missionDraft,
    mission,
    caw,
    botChain,
    challenge,
    providerTrust,
    firewall,
    paymentContext,
    clearSign,
    timeline,
    receipt,
    attacks: cloneAttackDefinitions(),
    evidence: null,
    selectedAttackId: "replay"
  };
}

export function countModes(items: Array<{ evidenceMode: EvidenceMode }>) {
  return items.reduce(
    (counts, item) => {
      counts[item.evidenceMode] += 1;
      return counts;
    },
    { live: 0, fallback: 0, mock: 0 } satisfies Record<EvidenceMode, number>
  );
}

export function applyDashboardAction(
  workspace: DashboardWorkspace,
  action:
    | { type: "create-mission" }
    | { type: "dry-run" }
    | { type: "prepare-guard" }
    | { type: "execute-payment" }
    | { type: "verify-receipt" }
    | { type: "run-attack"; attackId: string }
    | { type: "export-evidence" }
    | { type: "set-preset"; preset: DashboardPreset },
  now = Date.now()
): DashboardWorkspace {
  const next = structuredClone(workspace) as DashboardWorkspace;

  if (action.type === "set-preset") {
    next.preset = action.preset;
    return next;
  }

  next.actionSource = "frontend_fallback";

  if (action.type === "create-mission") {
    next.mission = {
      ...next.mission,
      id: sampleMissionId,
      userPrompt: next.missionDraft.prompt,
      budgetUsd: next.missionDraft.budgetUsd,
      resourceUrl: next.missionDraft.resourceUrl,
      status: "active",
      pactId: samplePactId,
      createdAt: now,
      evidenceMode: "mock"
    };
    next.caw.transactionStatus = "prepared";
    next.timeline.unshift(
      buildTimelineItem(
        "timeline-create",
        "Mission created",
        `Mission ${sampleMissionId} is staged for a BOT Chain escrow settlement demo.`,
        "mock",
        "mock",
        now
      )
    );
    return next;
  }

  if (action.type === "dry-run") {
    next.challenge = {
      rawChallenge: {
        status: 402,
        headers: {
          "www-authenticate": 'X402 realm="clear402"',
          "x-provider-id": sampleProviderId
        },
        body: {
          resource: next.missionDraft.resourceUrl,
          payTo: sampleBotChainProviderAddress,
          amount: "1000000000000",
          asset: "BOT",
          network: "botchain-testnet",
          chainId: botChainChainId,
          facilitatorUrl: "https://facilitator.clear402.local/botchain",
          expiresAt: now + 300_000
        }
      },
      normalizedChallenge: {
        providerId: sampleProviderId,
        scheme: "x402",
        network: "botchain-testnet",
        asset: "BOT",
        amount: "1000000000000",
        chainId: botChainChainId,
        payTo: sampleBotChainProviderAddress,
        resource: next.missionDraft.resourceUrl,
        facilitatorUrl: "https://facilitator.clear402.local/botchain",
        description: "Protected market intel",
        expiresAt: now + 300_000,
        rawChallengeHash: sampleRawChallengeHash,
        evidenceMode: "mock"
      },
      providerRegistryResult: {
        providerId: sampleProviderId,
        origin: "http://127.0.0.1:4010",
        allowed: true,
        cawAllowlistStatus: "pending",
        chainId: botChainChainId,
        network: "botchain-testnet",
        settlementPath: "botchain_service_escrow"
      },
      settlementPath: "botchain_service_escrow",
      evidenceMode: "mock",
      state: "success"
    };
    next.providerTrust = {
      ...next.providerTrust,
      state: "fallback",
      evidenceMode: "fallback"
    };
    next.firewall = {
      ...next.firewall,
      evidenceMode: "fallback"
    };
    next.timeline.unshift(
      buildTimelineItem(
        "timeline-dryrun",
        "402 challenge normalized",
        "The provider challenge, registry check, and settlement path are now visible in the inspector.",
        "success",
        "mock",
        now
      )
    );
    return next;
  }

  if (action.type === "prepare-guard") {
    next.paymentContext = {
      ...next.paymentContext,
      missionId: next.mission.id ?? sampleMissionId,
      quoteId: sampleQuoteId,
      cawPactId: next.caw.pactId,
      evidenceMode: "fallback",
      requestId: formatRequestId(samplePaymentContextHash)
    };
    next.botChain = {
      ...next.botChain,
      paymentContextHash: next.paymentContext.paymentContextHash,
      settlementStatus: next.botChain.evidenceMode === "live" ? next.botChain.settlementStatus : "guarded",
      note:
        next.botChain.evidenceMode === "live"
          ? "BOT Chain evidence is loaded from recorded deployment artifacts."
          : "PaymentContext is guarded; deploy and interact with BOT Chain ServiceEscrow to turn this panel live."
    };
    next.clearSign = {
      ...next.clearSign,
      evidenceMode: "fallback"
    };
    next.caw.transactionStatus = "prepared";
    next.timeline.unshift(
      buildTimelineItem(
        "timeline-prepare",
        "Guard prepare",
        "PaymentContext, quote lock, and BOT Chain escrow intent are staged for settlement evidence.",
        "pending_approval",
        "fallback",
        now
      )
    );
    return next;
  }

  if (action.type === "execute-payment") {
    next.caw.transactionStatus = "submitted";
    next.botChain = {
      ...next.botChain,
      paymentContextHash: next.paymentContext.paymentContextHash,
      settlementStatus: next.botChain.evidenceMode === "live" ? "confirmed" : "fallback_required",
      note:
        next.botChain.evidenceMode === "live"
          ? "Recorded BOT Chain explorer evidence is attached to this payment context."
          : "BOT Chain settlement evidence is not recorded yet; run the deploy and interaction scripts to make this live."
    };
    next.caw.auditLogs.unshift({
      id: "botchain-submit",
      outcome: "allow",
      evidenceMode: next.botChain.evidenceMode,
      note: next.botChain.note,
      timestamp: now
    });
    const txHash =
      next.botChain.interactionTxHash !== "TODO_AFTER_INTERACTION" ? next.botChain.interactionTxHash : undefined;
    next.receipt = {
      ...next.receipt,
      paymentReceipt: {
        ...next.receipt.paymentReceipt,
        status: "paid",
        ...(txHash ? { txHash } : {}),
        evidenceMode: next.botChain.evidenceMode
      },
      finalStatus: "paid",
      evidenceMode: next.botChain.evidenceMode
    };
    if (next.botChain.interactionTxHash === "TODO_AFTER_INTERACTION") {
      delete next.receipt.paymentReceipt.txHash;
    }
    next.timeline.unshift(
      buildTimelineItem(
        "timeline-execute",
        "BOT Chain evidence recorded",
        next.botChain.note,
        next.botChain.evidenceMode === "live" ? "success" : "fallback",
        next.botChain.evidenceMode,
        now,
        "botchain-submit"
      )
    );
    return next;
  }

  if (action.type === "verify-receipt") {
    next.receipt = {
      ...next.receipt,
      deliveryReceipt: {
        ...next.receipt.deliveryReceipt,
        status: "delivered",
        evidenceMode: "fallback"
      },
      finalStatus: "delivered",
      evidenceMode: "fallback"
    };
    next.mission = {
      ...next.mission,
      status: "complete",
      evidenceMode: "fallback"
    };
    next.caw.transactionStatus = "finalized";
    next.botChain = {
      ...next.botChain,
      settlementStatus: next.botChain.evidenceMode === "live" ? "confirmed" : next.botChain.settlementStatus
    };
    next.timeline.unshift(
      buildTimelineItem(
        "timeline-receipt",
        "Delivery verified",
        "Receipt verification closes the loop and marks the mission complete.",
        "success",
        "fallback",
        now
      )
    );
    return next;
  }

  if (action.type === "run-attack") {
    const attack = next.attacks.find((candidate) => candidate.id === action.attackId);
    if (!attack) {
      return next;
    }

    attack.runCount += 1;
    attack.resultState = "blocked";
    attack.resultDetail = `Blocked by ${attack.blockedLayer.toLowerCase()}.`;
    attack.evidenceRef = `attack/${attack.id}/run-${attack.runCount}`;
    attack.guardEventId = `guard-${attack.id}-${attack.runCount}`;

    next.timeline.unshift(
      buildTimelineItem(
        attack.guardEventId,
        `${attack.title} blocked`,
        attack.resultDetail,
        "blocked",
        "mock",
        now,
        attack.guardEventId
      )
    );
    next.receipt = {
      ...next.receipt,
      finalStatus: next.receipt.finalStatus === "delivered" ? "delivered" : "paid_but_not_delivered",
      evidenceMode: "fallback"
    };
    return next;
  }

  if (action.type === "export-evidence") {
    return recordEvidenceExport(next, buildEvidenceExport(next, now), now);
  }

  return next;
}

export function resolveEvidenceMissionId(workspace: DashboardWorkspace) {
  return workspace.mission.id ?? workspace.paymentContext.missionId;
}

export async function runPreferredMissionFlowAction(
  workspace: DashboardWorkspace,
  actionType: MissionFlowActionType,
  options: RuntimeMissionFlowOptions = {}
): Promise<RuntimeMissionFlowResult> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now();
  const basePath = options.basePath ?? "";

  if (actionType === "execute-payment") {
    return {
      workspace: {
        ...applyDashboardAction(workspace, { type: actionType }, now),
        actionSource: "frontend_fallback"
      },
      usedRuntime: false,
      source: "frontend_fallback",
      fallbackReason: "Dashboard BOT Chain evidence recording is fallback until deployment and interaction tx hashes are recorded."
    };
  }

  try {
    const response =
      actionType === "create-mission"
        ? await fetcher(`${basePath}/api/missions`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            cache: "no-store",
            body: JSON.stringify({
              userPrompt: workspace.missionDraft.prompt,
              budgetUsd: workspace.missionDraft.budgetUsd,
              resourceUrl: workspace.missionDraft.resourceUrl
            })
          })
        : await fetcher(`${basePath}/api/missions/${encodeURIComponent(resolveEvidenceMissionId(workspace))}/${runtimeActionPath(actionType)}`, {
            method: "POST",
            cache: "no-store"
          });

    if (!response.ok) {
      throw new Error(`Runtime mission flow unavailable: HTTP ${response.status}`);
    }

    const payload = sanitizeEvidenceForDisplay(await response.json()) as RuntimeMissionFlowPayload;
    return {
      workspace: applyRuntimeMissionFlowPayload(workspace, actionType, payload, now),
      usedRuntime: true,
      source: "runtime_api"
    };
  } catch (error) {
    return {
      workspace: {
        ...applyDashboardAction(workspace, { type: actionType } as Parameters<typeof applyDashboardAction>[1], now),
        actionSource: "frontend_fallback"
      },
      usedRuntime: false,
      source: "frontend_fallback",
      fallbackReason: error instanceof Error ? error.message : "Runtime mission flow unavailable"
    };
  }
}

interface RuntimeMissionFlowPayload {
  source?: MissionFlowSource;
  evidenceMode?: EvidenceMode;
  mission?: Partial<MissionState> & {
    userPrompt?: string;
    cawWalletUuid?: string;
    cawWalletAddress?: string;
    pactId?: string;
    source?: MissionFlowSource;
  };
  rawChallenge?: Record<string, unknown>;
  normalizedChallenge?: Record<string, unknown>;
  providerRegistryResult?: Record<string, unknown>;
  trustResult?: Record<string, unknown>;
  settlementPath?: string;
  metadataFirewall?: Partial<FirewallState> & Record<string, unknown>;
  paymentContext?: Partial<PaymentContextState> & Record<string, unknown>;
  paymentContextHash?: string;
  cawRequestId?: string;
  guard?: {
    decision?: string;
    status?: string;
    guardEventId?: string;
    layer?: string;
    reason?: string;
    evidenceMode?: EvidenceMode;
  };
  clearSign?: Partial<ClearSignState["result"]> & Record<string, unknown>;
  cawEvidence?: Record<string, unknown>;
  receipt?: Partial<ReceiptState>;
}

function runtimeActionPath(actionType: MissionFlowActionType) {
  if (actionType === "prepare-guard" || actionType === "execute-payment") {
    return "guard";
  }

  if (actionType === "verify-receipt") {
    return "verify";
  }

  return "dry-run";
}

function applyRuntimeMissionFlowPayload(
  workspace: DashboardWorkspace,
  actionType: MissionFlowActionType,
  payload: RuntimeMissionFlowPayload,
  now: number
): DashboardWorkspace {
  const next = structuredClone(workspace) as DashboardWorkspace;
  const payloadMode = coerceEvidenceMode(payload.evidenceMode);
  next.actionSource = "runtime_api";

  if (payload.mission) {
    const missionPatch: MissionState = {
      ...next.mission,
      ...(typeof payload.mission.id === "string" ? { id: payload.mission.id } : {}),
      userPrompt: payload.mission.userPrompt ?? next.mission.userPrompt,
      budgetUsd: payload.mission.budgetUsd ?? next.mission.budgetUsd,
      resourceUrl: payload.mission.resourceUrl ?? next.mission.resourceUrl,
      status: coerceMissionStatus(payload.mission.status, next.mission.status),
      cawWalletUuid: payload.mission.cawWalletUuid ?? next.mission.cawWalletUuid,
      cawWalletAddress: payload.mission.cawWalletAddress ?? next.mission.cawWalletAddress,
      createdAt: payload.mission.createdAt ?? next.mission.createdAt ?? now,
      evidenceMode: payloadMode
    };
    const pactId = payload.mission.pactId ?? next.mission.pactId;
    if (pactId !== undefined) {
      missionPatch.pactId = pactId;
    }
    next.mission = missionPatch;
    next.caw.walletUuid = next.mission.cawWalletUuid;
    next.caw.walletAddress = next.mission.cawWalletAddress;
    next.caw.pactId = next.mission.pactId ?? next.caw.pactId;
  }

  if (payload.rawChallenge || payload.normalizedChallenge || payload.providerRegistryResult) {
    next.challenge = {
      rawChallenge: payload.rawChallenge ?? next.challenge.rawChallenge,
      normalizedChallenge: payload.normalizedChallenge ?? next.challenge.normalizedChallenge,
      providerRegistryResult: payload.providerRegistryResult ?? next.challenge.providerRegistryResult,
      settlementPath: payload.settlementPath ?? next.challenge.settlementPath,
      evidenceMode: payloadMode,
      state: "success"
    };
  }

  if (payload.providerRegistryResult || payload.trustResult) {
    next.providerTrust = {
      ...next.providerTrust,
      providerId:
        typeof payload.providerRegistryResult?.providerId === "string"
          ? payload.providerRegistryResult.providerId
          : next.providerTrust.providerId,
      registryEntry: payload.providerRegistryResult ?? next.providerTrust.registryEntry,
      trustResult: payload.trustResult ?? next.providerTrust.trustResult,
      evidenceMode: payloadMode,
      state: payload.guard?.decision === "fallback_required" ? "fallback" : "success"
    };
  }

  if (payload.metadataFirewall) {
    next.firewall = {
      ...next.firewall,
      ...coerceFirewallPayload(payload.metadataFirewall, next.firewall),
      evidenceMode: payloadMode
    };
  }

  if (payload.paymentContext) {
    next.paymentContext = {
      ...next.paymentContext,
      ...coercePaymentContextPayload(payload.paymentContext, next.paymentContext),
      paymentContextHash:
        payload.paymentContextHash ??
        payload.paymentContext.paymentContextHash ??
        next.paymentContext.paymentContextHash,
      requestId: payload.cawRequestId ?? payload.paymentContext.requestId ?? next.paymentContext.requestId,
      evidenceMode: payloadMode
    };
    next.botChain = {
      ...next.botChain,
      paymentContextHash: next.paymentContext.paymentContextHash,
      settlementStatus: next.botChain.evidenceMode === "live" ? next.botChain.settlementStatus : "guarded"
    };
  }

  if (payload.clearSign) {
    next.clearSign = {
      ...next.clearSign,
      result: {
        ...next.clearSign.result,
        ...payload.clearSign
      },
      evidenceMode: payloadMode
    };
  }

  if (payload.guard || payload.cawEvidence) {
    next.caw.transactionStatus = "prepared";
    next.caw.pactScopedApiKeyStatus = "fallback_required";
    next.caw.evidenceMode = payloadMode;
    next.caw.auditLogs.unshift({
      id: payload.guard?.guardEventId ?? `runtime-${actionType}-${now}`,
      outcome: "fallback",
      evidenceMode: payloadMode,
      note: payload.guard?.reason ?? "Runtime API prepared guard evidence; BOT Chain settlement evidence remains separately recorded.",
      timestamp: now
    });
  }

  if (payload.receipt) {
    const receiptPaymentPatch = payload.receipt.paymentReceipt ?? {};
    const paymentReceipt = {
      ...next.receipt.paymentReceipt,
      ...receiptPaymentPatch,
      evidenceMode: payloadMode
    };
    if (!("txHash" in receiptPaymentPatch)) {
      delete paymentReceipt.txHash;
    }

    next.receipt = {
      ...next.receipt,
      ...payload.receipt,
      paymentReceipt,
      deliveryReceipt: {
        ...next.receipt.deliveryReceipt,
        ...(payload.receipt.deliveryReceipt ?? {}),
        evidenceMode: payloadMode
      },
      finalStatus: coerceReceiptFinalStatus(payload.receipt.finalStatus, next.receipt.finalStatus),
      auditLogIds: payload.receipt.auditLogIds ?? next.receipt.auditLogIds,
      evidenceMode: payloadMode
    };
    next.caw.transactionStatus = "denied";
  }

  next.timeline.unshift(
    buildTimelineItem(
      `timeline-runtime-${actionType}-${now}`,
      runtimeActionTitle(actionType),
      runtimeActionDetail(actionType, payload),
      payload.guard?.decision === "fallback_required" ? "fallback" : actionType === "verify-receipt" ? "blocked" : "success",
      payloadMode,
      now,
      payload.guard?.guardEventId
    )
  );

  return next;
}

function runtimeActionTitle(actionType: MissionFlowActionType) {
  if (actionType === "create-mission") {
    return "Mission created by runtime API";
  }

  if (actionType === "dry-run") {
    return "Runtime dry-run completed";
  }

  if (actionType === "verify-receipt") {
    return "Runtime receipt verified as fallback";
  }

  return "Runtime guard prepared settlement";
}

function runtimeActionDetail(actionType: MissionFlowActionType, payload: RuntimeMissionFlowPayload) {
  if (actionType === "create-mission") {
    return `Runtime API created ${payload.mission?.id ?? "the mission"} in fallback/demo mode.`;
  }

  if (actionType === "dry-run") {
    return "Runtime API returned a fallback x402 challenge, provider check, and settlement path.";
  }

  if (actionType === "verify-receipt") {
    return "Runtime API wrote fallback receipt evidence without a tx hash or live payment claim.";
  }

  return payload.guard?.reason ?? "Runtime guard prepared PaymentContext evidence before BOT Chain settlement recording.";
}

function coerceMissionStatus(
  value: unknown,
  fallback: MissionState["status"]
): MissionState["status"] {
  return value === "draft" ||
    value === "active" ||
    value === "blocked" ||
    value === "complete" ||
    value === "failed"
    ? value
    : fallback;
}

function coerceFirewallPayload(
  value: Partial<FirewallState> & Record<string, unknown>,
  fallback: FirewallState
): Partial<FirewallState> {
  return {
    decision:
      value.decision === "allow" ||
      value.decision === "redact" ||
      value.decision === "hash_only" ||
      value.decision === "require_approval" ||
      value.decision === "block"
        ? value.decision
        : fallback.decision,
    findings: Array.isArray(value.findings) ? value.findings as FirewallState["findings"] : fallback.findings,
    piiPolicyHash: typeof value.piiPolicyHash === "string" ? value.piiPolicyHash : fallback.piiPolicyHash,
    latencyMs: typeof value.latencyMs === "number" ? value.latencyMs : fallback.latencyMs,
    after: isRecord(value.sanitized)
      ? {
          resourceUrl:
            typeof value.sanitized.resourceUrl === "string"
              ? value.sanitized.resourceUrl
              : fallback.after.resourceUrl,
          description:
            typeof value.sanitized.description === "string"
              ? value.sanitized.description
              : fallback.after.description,
          reason:
            typeof value.sanitized.reason === "string"
              ? value.sanitized.reason
              : fallback.after.reason
        }
      : fallback.after
  };
}

function coercePaymentContextPayload(
  value: Partial<PaymentContextState> & Record<string, unknown>,
  fallback: PaymentContextState
): Partial<PaymentContextState> {
  return {
    ...fallback,
    ...value,
    method: value.method === "GET" || value.method === "POST" ? value.method : fallback.method,
    serviceMode:
      value.serviceMode === "caw-fetch" ||
      value.serviceMode === "direct-transfer" ||
      value.serviceMode === "escrowed-delivery"
        ? value.serviceMode
        : fallback.serviceMode
  };
}

function coerceReceiptFinalStatus(
  value: unknown,
  fallback: ReceiptState["finalStatus"]
): ReceiptState["finalStatus"] {
  return value === "paid" ||
    value === "delivered" ||
    value === "failed" ||
    value === "refundable" ||
    value === "refunded" ||
    value === "paid_but_not_delivered"
    ? value
    : fallback;
}

export function recordEvidenceExport(
  workspace: DashboardWorkspace,
  evidence: EvidenceExportState,
  now = Date.now(),
  detail?: string
): DashboardWorkspace {
  const next = structuredClone(workspace) as DashboardWorkspace;
  next.evidence = evidence;
  next.timeline.unshift(
    buildTimelineItem(
      `timeline-export-${now}`,
      "Evidence exported",
      detail ??
        (evidence.source === "server_side"
          ? `Server-side evidence export (${evidence.runtimeSource ?? "runtime"}) captured the current live / fallback / mock split.`
          : "Frontend fallback export captured the current live / fallback / mock split."),
      "success",
      evidence.evidenceMode,
      now
    )
  );

  return next;
}

export async function loadPreferredEvidenceExport(
  workspace: DashboardWorkspace,
  options: PreferredEvidenceExportOptions = {}
): Promise<PreferredEvidenceExportResult> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now();
  const basePath = options.basePath ?? "";
  const missionId = encodeURIComponent(resolveEvidenceMissionId(workspace));
  const exportBasePath = `${basePath}/api/evidence/${missionId}`;

  try {
    const [jsonResponse, markdownResponse] = await Promise.all([
      fetcher(`${exportBasePath}/export.json`, { cache: "no-store" }),
      fetcher(`${exportBasePath}/export.md`, { cache: "no-store" })
    ]);

    if (!jsonResponse.ok || !markdownResponse.ok) {
      const status = !jsonResponse.ok ? jsonResponse.status : markdownResponse.status;
      throw new Error(`Runtime evidence export unavailable: HTTP ${status}`);
    }

    const [json, markdown] = await Promise.all([
      jsonResponse.text(),
      markdownResponse.text()
    ]);

    return {
      evidence: buildServerSideEvidenceExport({ json, markdown, now }),
      usedRuntime: true
    };
  } catch (error) {
    return {
      evidence: buildEvidenceExport(workspace, now),
      usedRuntime: false,
      fallbackReason: error instanceof Error ? error.message : "Runtime evidence export unavailable"
    };
  }
}

export function buildEvidenceExport(workspace: DashboardWorkspace, now = Date.now()): EvidenceExportState {
  const attackSummaries = workspace.attacks.map((attack) => ({
    id: attack.id,
    title: attack.title,
    blockedLayer: attack.blockedLayer,
    resultState: attack.resultState,
    evidenceRef: attack.evidenceRef ?? null,
    evidenceMode: attack.evidenceMode
  }));

  const bundle = {
    mission: workspace.mission,
    userTaskSanitized: {
      prompt: workspace.missionDraft.prompt,
      resourceUrl: workspace.missionDraft.resourceUrl
    },
    budget: workspace.missionDraft.budgetUsd,
    botChainSettlement: workspace.botChain,
    legacyWalletEnvironment: workspace.caw.environment,
    agentWalletAddress: workspace.caw.walletAddress,
    settlementContract: workspace.botChain.contractName,
    settlementStatus: workspace.botChain.settlementStatus,
    requestId: workspace.paymentContext.requestId,
    txHash: workspace.receipt.paymentReceipt.txHash ?? null,
    auditLogIds: workspace.receipt.auditLogIds,
    rawSettlementEvidenceRefs: [
      "evidence/botchain/service-escrow-deploy.latest.json",
      "evidence/botchain/service-escrow-fund.latest.json",
      "evidence/botchain/service-escrow-deliver.latest.json"
    ],
    x402RawChallenge: workspace.challenge.rawChallenge,
    normalizedChallenge: workspace.challenge.normalizedChallenge,
    providerRegistryResult: workspace.challenge.providerRegistryResult,
    erc8004TrustResult: workspace.providerTrust.trustResult,
    metadataFirewall: {
      before: workspace.firewall.before,
      after: workspace.firewall.after,
      reasonCode: workspace.firewall.reasonCode,
      findings: workspace.firewall.findings
    },
    paymentContext: workspace.paymentContext,
    paymentContextHash: workspace.paymentContext.paymentContextHash,
    clearsigResult: workspace.clearSign.result,
    receipt: workspace.receipt,
    attackLabResults: attackSummaries,
    paperMapping: attackSummaries.map((attack) => ({
      attackId: attack.id,
      paper: workspace.attacks.find((candidate) => candidate.id === attack.id)?.paper ?? "Unknown paper",
      blockedLayer: attack.blockedLayer
    })),
    liveFallbackMockLabels: {
      runtime: workspace.runtimeHealth.evidenceMode,
      provider: workspace.providerHealth.evidenceMode,
      mission: workspace.mission.evidenceMode,
      guard: workspace.firewall.evidenceMode,
      receipt: workspace.receipt.evidenceMode,
      attackLab: "mock" as EvidenceMode
    },
    limitations: [
      "BOT Chain settlement is live only after ServiceEscrow deployment and interaction tx hashes are recorded.",
      "Before deployment, the BOT Chain panel is fallback evidence and must not be claimed as live settlement.",
      "Default dashboard demos and attack lab runs use fallback/mock evidence unless explicitly backed by explorer tx links.",
      "Do not claim mainnet, production-ready custody, or unrestricted AI-agent spending."
    ]
  };

  const sanitizedBundle = sanitizeEvidenceForDisplay({
    ...bundle,
    generatedAt: now
  });
  const json = stableJson(sanitizedBundle);

  const markdown = [
    "# Clear402 Evidence Pack",
    "",
    `Generated at: ${new Date(now).toISOString()}`,
    "",
    "## Mission",
    `- Prompt: ${workspace.missionDraft.prompt}`,
    `- Budget: ${workspace.missionDraft.budgetUsd} BOT wei cap`,
    `- Mode: ${workspace.mission.evidenceMode}`,
    "",
    "## Live / Fallback / Mock",
    `- Runtime: ${workspace.runtimeHealth.evidenceMode}`,
    `- Provider: ${workspace.providerHealth.evidenceMode}`,
    `- Mission: ${workspace.mission.evidenceMode}`,
    `- Guard: ${workspace.firewall.evidenceMode}`,
    `- Receipt: ${workspace.receipt.evidenceMode}`,
    `- Attack Lab: mock`,
    "",
    "## BOT Chain Settlement",
    `- Network: ${workspace.botChain.network}`,
    `- Chain ID: ${workspace.botChain.chainId}`,
    `- Contract: ${workspace.botChain.contractAddress}`,
    `- Deploy Tx: ${workspace.botChain.deployTxHash}`,
    `- Interaction Tx: ${workspace.botChain.interactionTxHash}`,
    `- Settlement Status: ${workspace.botChain.settlementStatus}`,
    `- Evidence Mode: ${workspace.botChain.evidenceMode}`,
    `- Explorer: ${workspace.botChain.explorerLinks.interactionTx ?? "n/a"}`,
    "",
    "## Core Evidence",
    `- Agent Wallet: ${workspace.caw.walletAddress}`,
    `- Settlement Contract: ${workspace.botChain.contractName}`,
    `- Request ID: ${workspace.paymentContext.requestId}`,
    `- Tx Hash: ${workspace.botChain.interactionTxHash !== "TODO_AFTER_INTERACTION" ? workspace.botChain.interactionTxHash : "n/a"}`,
    `- PaymentContext Hash: ${workspace.paymentContext.paymentContextHash}`,
    "",
    "## Attack Results",
    ...attackSummaries.map(
      (attack) => `- ${attack.title}: ${attack.resultState} (${attack.blockedLayer})`
    ),
    "",
    "## Limitations",
    ...bundle.limitations.map((line) => `- ${line}`),
    "",
    "## Raw JSON",
    "```json",
    json,
    "```"
  ].join("\n");

  return {
    generatedAt: now,
    evidenceMode: "fallback",
    source: "frontend_fallback",
    json,
    markdown: redactSecretLikeText(markdown),
    stale: false
  };
}

export function buildServerSideEvidenceExport({
  json,
  markdown,
  now = Date.now()
}: {
  json: string;
  markdown: string;
  now?: number;
}): EvidenceExportState {
  const sanitizedJsonText = redactSecretLikeText(json);
  let payload: unknown;

  try {
    payload = JSON.parse(sanitizedJsonText);
  } catch {
    payload = null;
  }

  const payloadRecord = isRecord(payload) ? payload : {};
  const generatedAt =
    typeof payloadRecord.generatedAt === "number" ? payloadRecord.generatedAt : now;
  const evidenceMode = coerceEvidenceMode(payloadRecord.evidenceMode);
  const source =
    typeof payloadRecord.source === "string" && payloadRecord.source.length > 0
      ? payloadRecord.source
      : "runtime";
  const sanitizedPayload = sanitizeEvidenceForDisplay(payload);
  const renderedJson = payload ? stableJson(sanitizedPayload) : sanitizedJsonText;

  return {
    generatedAt,
    evidenceMode,
    source: "server_side",
    runtimeSource: source,
    json: renderedJson,
    markdown: redactSecretLikeText(markdown),
    stale: false
  };
}

export function describeWorkspaceModes(workspace: DashboardWorkspace) {
  return countModes([
    workspace.runtimeHealth,
    workspace.providerHealth,
    workspace.mission,
    workspace.caw,
    workspace.botChain,
    workspace.challenge,
    workspace.providerTrust,
    workspace.firewall,
    workspace.paymentContext,
    workspace.clearSign,
    workspace.receipt,
    workspace.evidence ?? { evidenceMode: "fallback" as EvidenceMode }
  ]);
}

export function formatIsoTimestamp(value?: number) {
  if (!value) {
    return "n/a";
  }

  return new Date(value).toISOString();
}

export function formatJson(value: unknown) {
  if (value === null || value === undefined) {
    return "n/a";
  }

  return stableJson(value);
}

export function toCompactModeLabel(mode: string) {
  if (mode === "live" || mode === "fallback" || mode === "mock") {
    return mode;
  }

  if (mode === "blocked") {
    return "blocked";
  }

  if (mode === "denied") {
    return "denied";
  }

  if (mode === "pending_approval") {
    return "pending approval";
  }

  if (mode === "success") {
    return "success";
  }

  return mode;
}

export function getAttackById(workspace: DashboardWorkspace, attackId: string) {
  return workspace.attacks.find((attack) => attack.id === attackId) ?? workspace.attacks[0];
}
