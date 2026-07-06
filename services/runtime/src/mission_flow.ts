import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type {
  EvidenceMode,
  GuardDecision,
  MetadataFirewallResult,
  MissionStatus,
  PaymentContext,
  ProviderRegistryEntry,
  ServiceReceipt
} from "../../../packages/shared/src/index.mjs";
import { validateERC8004Trust, type ERC8004TrustRecord } from "./x402/erc8004_trust_adapter.ts";
import { normalizeX402Challenge, type NormalizedX402Challenge } from "./x402/challenge_normalizer.ts";
import { validateProviderRegistry, type ProviderRegistryValidationResult } from "./x402/provider_registry.ts";
import { buildPaymentContext } from "./guard/payment_context.ts";
import { scanMetadata, type MetadataTriple } from "./guard/metadata_firewall.ts";
import { ensureMission, ensureProvider } from "./guard/quote_lock.ts";
import { listGuardEvents, recordGuardEvent } from "./guard/events.ts";
import { runGuardPipeline, type GuardPipelineResult } from "./guard/pipeline.ts";
import { canonicalJson, hashObject, sha256Hex } from "./guard/hash.ts";
import {
  createDualReceipt,
  verifyDualReceipt,
  type DualReceipt,
  type DualReceiptVerificationResult
} from "./receipt/dual_receipt.ts";
import { buildServiceResultHash, signReceiptForDemo } from "./receipt/receipt_verifier.ts";
import {
  buildMissionTimelineEventFromReceipt,
  recordMissionTimelineEvent
} from "./mission_timeline.ts";

export type MissionFlowSource = "runtime_api";

export interface MissionFlowCreateRequest {
  missionId?: string;
  userPrompt?: string;
  prompt?: string;
  budgetUsd?: string;
  resourceUrl?: string;
}

export interface MissionFlowResponse {
  source: MissionFlowSource;
  action: "create_mission" | "dry_run" | "guard" | "verify" | "get_mission";
  evidenceMode: EvidenceMode;
  mission: MissionFlowMission;
  rawChallenge?: unknown;
  normalizedChallenge?: NormalizedX402Challenge;
  providerRegistryResult?: ProviderRegistryValidationResult;
  trustResult?: ReturnType<typeof validateERC8004Trust>;
  settlementPath?: "botchain_service_escrow" | "botchain_settlement_pending" | "runtime_fallback_required";
  metadataFirewall?: MetadataFirewallResult;
  paymentContext?: PaymentContext;
  paymentContextHash?: string;
  cawRequestId?: string;
  guard?: MissionFlowGuardSummary;
  clearSign?: GuardPipelineResult["clearsig"];
  cawEvidence?: GuardPipelineResult["cawEvidence"];
  receipt?: MissionFlowReceiptSummary;
  evidenceBundle?: GuardPipelineResult["evidenceBundle"];
}

export interface MissionFlowMission {
  id: string;
  userPrompt: string;
  budgetUsd: string;
  resourceUrl: string;
  status: MissionStatus;
  cawWalletUuid: string;
  cawWalletAddress: string;
  pactId: string;
  createdAt: number;
  updatedAt: number;
  evidenceMode: EvidenceMode;
  source: MissionFlowSource;
}

export interface MissionFlowGuardSummary {
  decision: GuardPipelineResult["decision"] | "not_recorded";
  status: GuardPipelineResult["status"] | "not_recorded";
  guardEventId?: string;
  layer?: string;
  reason?: string;
  evidenceMode: EvidenceMode;
}

export interface MissionFlowReceiptSummary {
  receiptId: string;
  dualReceiptHash?: string;
  paymentReceiptHash?: string;
  deliveryReceiptHash?: string;
  serviceResultHash?: string;
  cawEvidenceRef?: string;
  fallbackEvidenceRef?: string;
  coboTransactionId?: string;
  deliveryTimestamp?: number;
  dualReceipt?: DualReceipt;
  verificationResult?: DualReceiptVerificationResult;
  paymentReceipt: {
    status: "failed" | "paid";
    requestId: string;
    walletAddress: string;
    pactId: string;
    amount: string;
    asset?: string;
    txHash?: string;
    evidenceMode: EvidenceMode;
  };
  deliveryReceipt: {
    status: "failed" | "delivered" | "paid_but_not_delivered";
    responseHash: string;
    resource?: string;
    providerSignature: string;
    schemaHash: string;
    redactionSummaryHash?: string;
    evidenceMode: EvidenceMode;
  };
  finalStatus: ServiceReceipt["status"];
  auditLogIds: string[];
  evidenceMode: EvidenceMode;
}

interface MissionRow {
  id: string;
  userPrompt: string;
  budgetUsd: string;
  status: MissionStatus;
  cawWalletUuid: string;
  cawWalletAddress: string | null;
  pactId: string | null;
  createdAt: number;
  updatedAt: number;
}

interface PaymentContextRow {
  paymentContextHash: string;
  rawContextJson: string;
  missionId: string;
  providerId: string;
  quoteId: string;
  cawRequestId: string | null;
}

interface ProviderContextRow {
  providerId: string;
  merchantAddress: string;
  providerPublicKey: string;
}

interface ReceiptRow {
  receiptId: string;
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
  txHash: string | null;
  coboTransactionId: string | null;
  chainId: string;
  tokenId: string;
  amount: string;
  providerResponseHash: string;
  providerSignature: string;
  responseSchemaHash: string | null;
  deliveryTimestamp: number;
  status: ServiceReceipt["status"];
  auditLogIds: string;
  redactionSummaryHash: string | null;
  evidenceMode: EvidenceMode;
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
  finalStatus: DualReceipt["finalStatus"];
  verificationDecision: DualReceiptVerificationResult["decision"];
  verificationResultJson: string;
  dualReceiptJson: string;
  evidenceMode: EvidenceMode;
  createdAt: number;
}

const evidenceMode: EvidenceMode = "fallback";
const defaultMissionPrompt = "Request protected market data for the research desk.";
const defaultBudgetUsd = "1000000000000";
const defaultResourceUrl = "https://127.0.0.1:4010/paid/report?topic=market-intel";
const demoWalletUuid = "runtime-demo-wallet";
const demoWalletAddress = "0x7A11E4dA1A6D1F8B9Fb3C3C7d4C6A0eF1Faa2402";
const demoPactId = "botchain-service-escrow";
const demoProviderPublicKey = "runtime-demo-provider-public-key";
const demoProvider: ProviderRegistryEntry = {
  providerId: "provider-runtime-demo",
  origin: "https://127.0.0.1:4010",
  merchantAddress: "0xA882b939c4Ca15c904760b8c240124Cb68cc2A88",
  facilitatorUrl: "https://facilitator.clear402.local/botchain",
  chainId: "968",
  tokenId: "BOT",
  publicKey: demoProviderPublicKey,
  allowedResources: ["/paid/report", "/paid/report*"],
  cawAllowlistStatus: "allowed",
  erc8004AgentId: "erc8004:agent:runtime-demo",
  erc8004AgentUri: "https://127.0.0.1:4010/paid/report",
  reputationThreshold: 60,
  validationTags: ["x402_endpoint_verified", "delivery_receipt_verified", "pii_safe_metadata"]
};

const demoTrustRecords: ERC8004TrustRecord[] = [
  {
    agentId: "erc8004:agent:runtime-demo",
    agentUri: "https://127.0.0.1:4010/paid/report",
    payTo: demoProvider.merchantAddress,
    reputationScore: 84,
    deliverySuccessRate: 0.97,
    paidButDeniedReports: 0,
    identityVerified: true,
    validationAttestations: [
      {
        tag: "x402_endpoint_verified",
        issuer: "Clear402 runtime demo registry"
      },
      {
        tag: "delivery_receipt_verified",
        issuer: "Clear402 runtime demo receipt verifier"
      },
      {
        tag: "pii_safe_metadata",
        issuer: "Clear402 runtime metadata firewall"
      }
    ]
  }
];

export function createMission(database: DatabaseSync, body: MissionFlowCreateRequest = {}): MissionFlowResponse {
  const now = Date.now();
  const missionId = normalizeId(body.missionId, "mission");
  const userPrompt = stringOrDefault(body.userPrompt ?? body.prompt, defaultMissionPrompt);
  const budgetUsd = decimalOrDefault(body.budgetUsd, defaultBudgetUsd);
  const resourceUrl = urlOrDefault(body.resourceUrl, defaultResourceUrl);

  ensureRuntimeMission(database, {
    missionId,
    userPrompt,
    budgetUsd,
    resourceUrl,
    now
  });

  return {
    source: "runtime_api",
    action: "create_mission",
    evidenceMode,
    mission: missionFromRow(requireMission(database, missionId), resourceUrl)
  };
}

export function dryRunMission(database: DatabaseSync, missionId: string): MissionFlowResponse {
  const mission = requireMission(database, missionId);
  const now = Date.now();
  const resourceUrl = missionResourceUrl(database, mission);
  const rawChallenge = buildRawChallenge(resourceUrl, now);
  const normalizedChallenge = normalizeX402Challenge({
    providerId: demoProvider.providerId,
    rawChallenge,
    now,
    evidenceMode
  });
  ensureProvider(database, ensureProviderInput(now));
  const requestUrl = new URL(resourceUrl);
  const providerRegistryResult = validateProviderRegistry({
    entries: [demoProvider],
    providerId: demoProvider.providerId,
    origin: requestUrl.origin,
    resourcePath: `${requestUrl.pathname}${requestUrl.search}`,
    payTo: normalizedChallenge.payTo,
    chainId: demoProvider.chainId,
    tokenId: demoProvider.tokenId,
    cawAllowedMerchantAddresses: [demoProvider.merchantAddress],
    ...(normalizedChallenge.facilitatorUrl !== undefined
      ? { facilitatorUrl: normalizedChallenge.facilitatorUrl }
      : {})
  });
  const trustResult = validateERC8004Trust({
    entry: demoProvider,
    records: demoTrustRecords,
    endpoint: normalizedChallenge.resource,
    payTo: normalizedChallenge.payTo,
    amount: normalizedChallenge.amount
  });

  recordGuardEvent(database, {
    id: `dry_${hashObject({ missionId, now }).slice(2, 18)}`,
    missionId,
    layer: "dry_run",
    decision: "fallback_required",
    reason: "Dry-run generated a runtime x402-style challenge bound to BOT Chain ServiceEscrow; no chain transaction was attempted.",
    evidenceJson: {
      source: "runtime_api",
      evidenceMode,
      rawChallenge,
      challenge: normalizedChallenge,
      providerRegistryResult: withEvidenceMode(providerRegistryResult, evidenceMode),
      trustResult,
      settlementPath: "botchain_service_escrow"
    },
    createdAt: now
  });

  return {
    source: "runtime_api",
    action: "dry_run",
    evidenceMode,
    mission: missionFromRow(requireMission(database, missionId), resourceUrl),
    rawChallenge,
    normalizedChallenge,
    providerRegistryResult: withEvidenceMode(providerRegistryResult, evidenceMode),
    trustResult,
    settlementPath: "botchain_service_escrow",
    guard: latestGuardSummary(database, missionId)
  };
}

export async function guardMission(database: DatabaseSync, missionId: string): Promise<MissionFlowResponse> {
  const mission = requireMission(database, missionId);
  const now = Date.now();
  const resourceUrl = missionResourceUrl(database, mission);
  const input = buildGuardInput(database, mission, resourceUrl, now);
  const result = await runGuardPipeline(database, input);
  const nextStatus: MissionStatus = result.decision === "fallback_required" ? "blocked" : "active";
  updateMissionStatus(database, missionId, nextStatus, now);

  const response: MissionFlowResponse = {
    source: "runtime_api",
    action: "guard",
    evidenceMode,
    mission: missionFromRow(requireMission(database, missionId), resourceUrl),
    rawChallenge: input.challenge,
    settlementPath: "botchain_settlement_pending",
    guard: {
      decision: result.decision,
      status: result.status,
      ...(result.guardEventId !== undefined ? { guardEventId: result.guardEventId } : {}),
      ...(result.reason !== undefined ? { reason: result.reason } : {}),
      evidenceMode
    },
    evidenceBundle: result.evidenceBundle
  };
  const providerRegistryResult = withEvidenceMode(result.providerRegistryResult, evidenceMode);
  if (providerRegistryResult !== undefined) {
    response.providerRegistryResult = providerRegistryResult;
  }
  if (result.trustResult !== undefined) {
    response.trustResult = result.trustResult;
  }
  if (result.metadataFirewall !== undefined) {
    response.metadataFirewall = result.metadataFirewall;
  }
  if (result.paymentContext !== undefined) {
    response.paymentContext = result.paymentContext;
  }
  if (result.paymentContextHash !== undefined) {
    response.paymentContextHash = result.paymentContextHash;
  }
  if (result.cawRequestId !== undefined) {
    response.cawRequestId = result.cawRequestId;
  }
  if (result.clearsig !== undefined) {
    response.clearSign = result.clearsig;
  }
  if (result.cawEvidence !== undefined) {
    response.cawEvidence = result.cawEvidence;
  }
  const normalizedChallenge = latestNormalizedChallenge(result);
  if (normalizedChallenge !== undefined) {
    response.normalizedChallenge = normalizedChallenge;
  }

  return response;
}

export function verifyMission(database: DatabaseSync, missionId: string): MissionFlowResponse {
  const mission = requireMission(database, missionId);
  const resourceUrl = missionResourceUrl(database, mission);
  const paymentContextRow = readLatestPaymentContext(database, missionId);
  if (!paymentContextRow) {
    throw new MissionFlowError(
      "MISSION_NOT_GUARDED",
      "Run guard before verifying a mission receipt.",
      409,
      { missionId }
    );
  }

  const now = Date.now();
  const context = parsePaymentContext(paymentContextRow.rawContextJson);
  const guard = latestGuardSummary(database, missionId);
  const providerContext = readLatestProviderContext(database, missionId);
  const providerPublicKey = providerContext?.providerPublicKey ?? demoProviderPublicKey;
  const merchantAddress = providerContext?.merchantAddress ?? mission.cawWalletAddress ?? demoProvider.merchantAddress;
  const receiptInput = {
    missionId,
    paymentContextHash: paymentContextRow.paymentContextHash,
    cawRequestId: paymentContextRow.cawRequestId ?? `clear402:${paymentContextRow.paymentContextHash.slice(2, 18)}`,
    context,
    now
  };
  const receipt = insertFallbackReceipt(
    database,
    guard.guardEventId === undefined
      ? {
          ...receiptInput,
          resource: resourceUrl,
          providerAddress: merchantAddress,
          providerPublicKey
        }
      : {
          ...receiptInput,
          resource: resourceUrl,
          providerAddress: merchantAddress,
          providerPublicKey,
          guardEventId: guard.guardEventId
        }
  );
  const storedReceipt = requireLatestReceipt(database, missionId);
  const serviceReceipt = serviceReceiptFromRow(storedReceipt);
  const dualReceipt = serviceReceipt
      ? createDualReceipt({
        serviceReceipt,
        providerPublicKey,
        resource: resourceUrl,
        cawEvidenceRef: serviceReceipt.cawEvidenceRef ?? `fallback:${serviceReceipt.receiptId}`,
        fallbackEvidenceRef: serviceReceipt.fallbackEvidenceRef ?? `fallback:${serviceReceipt.receiptId}`,
        verifierMetadata: {
          verifiedAt: storedReceipt?.deliveryTimestamp ?? now
        }
      })
    : undefined;
  const verificationResult = dualReceipt
    ? verifyDualReceipt({
        dualReceipt,
        expectedPaymentContextHash: paymentContextRow.paymentContextHash,
        expectedRequestId: dualReceipt.paymentReceipt.requestId,
        expectedPactId: context.cawPactId,
        expectedProviderAddress: merchantAddress,
        expectedMerchantAddress: merchantAddress,
        expectedProviderPublicKey: providerPublicKey,
        expectedAmount: context.amount,
        expectedAsset: dualReceipt.paymentReceipt.asset,
        expectedChainId: context.chainId,
        expectedTokenId: context.tokenId,
        expectedResource: resourceUrl,
        expectedServiceResultHash: dualReceipt.deliveryReceipt.serviceResultHash,
        expectedPaymentReceiptHash: dualReceipt.paymentReceipt.paymentReceiptHash,
        expectedDeliveryReceiptHash: dualReceipt.deliveryReceipt.deliveryReceiptHash,
        existingRecords: readDualReceiptReplayRecords(database, missionId)
      })
    : undefined;
  if (dualReceipt && verificationResult) {
    upsertDualReceipt(database, {
      missionId,
      dualReceipt,
      verificationResult,
      createdAt: now
    });
  }
  updateMissionStatus(database, missionId, "blocked", now);

  return {
    source: "runtime_api",
    action: "verify",
    evidenceMode,
    mission: missionFromRow(requireMission(database, missionId), resourceUrl),
    paymentContext: context,
    paymentContextHash: paymentContextRow.paymentContextHash,
    cawRequestId: paymentContextRow.cawRequestId ?? receipt.paymentReceipt.requestId,
    guard,
    receipt: {
      ...receipt,
      ...(dualReceipt !== undefined ? { dualReceipt } : {}),
      ...(verificationResult !== undefined ? { verificationResult } : {}),
      ...(dualReceipt !== undefined ? { dualReceiptHash: dualReceipt.dualReceiptHash } : {}),
      ...(dualReceipt !== undefined ? { paymentReceiptHash: dualReceipt.paymentReceipt.paymentReceiptHash } : {}),
      ...(dualReceipt !== undefined ? { deliveryReceiptHash: dualReceipt.deliveryReceipt.deliveryReceiptHash } : {}),
      ...(dualReceipt !== undefined ? { serviceResultHash: dualReceipt.deliveryReceipt.serviceResultHash } : {})
    }
  };
}

export function getMission(database: DatabaseSync, missionId: string): MissionFlowResponse {
  const mission = requireMission(database, missionId);
  const resourceUrl = missionResourceUrl(database, mission);
  const paymentContextRow = readLatestPaymentContext(database, missionId);
  const latestReceipt = readLatestReceipt(database, missionId);
  const latestDualReceipt = readLatestDualReceipt(database, missionId);
  const context = paymentContextRow
    ? parsePaymentContext(paymentContextRow.rawContextJson)
    : undefined;

  return {
    source: "runtime_api",
    action: "get_mission",
    evidenceMode,
    mission: missionFromRow(mission, resourceUrl),
    ...(context !== undefined ? { paymentContext: context } : {}),
    ...(paymentContextRow !== undefined
      ? {
          paymentContextHash: paymentContextRow.paymentContextHash,
          cawRequestId:
            paymentContextRow.cawRequestId ??
            `clear402:${paymentContextRow.paymentContextHash.slice(2, 18)}`
        }
      : {}),
    guard: latestGuardSummary(database, missionId),
    ...(latestDualReceipt !== undefined
      ? { receipt: dualReceiptSummaryFromRow(latestDualReceipt) }
      : latestReceipt !== undefined
        ? { receipt: receiptSummaryFromRow(latestReceipt) }
        : {})
  };
}

export class MissionFlowError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, statusCode: number, details: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function ensureRuntimeMission(
  database: DatabaseSync,
  input: {
    missionId: string;
    userPrompt: string;
    budgetUsd: string;
    resourceUrl: string;
    now: number;
  }
) {
  ensureMission(database, {
    missionId: input.missionId,
    userPrompt: input.userPrompt,
    budgetUsd: input.budgetUsd,
    cawWalletUuid: demoWalletUuid,
    cawWalletAddress: demoWalletAddress,
    pactId: demoPactId,
    createdAt: input.now
  });
  recordMissionResource(database, input.missionId, input.resourceUrl, input.now);
}

function buildGuardInput(
  database: DatabaseSync,
  mission: MissionRow,
  resourceUrl: string,
  now: number
): Parameters<typeof runGuardPipeline>[1] {
  ensureProvider(database, ensureProviderInput(now));
  const rawChallenge = buildRawChallenge(resourceUrl, now);
  const normalizedChallenge = normalizeX402Challenge({
    providerId: demoProvider.providerId,
    rawChallenge,
    now,
    evidenceMode
  });
  const metadata: MetadataTriple = {
    resourceUrl,
    description: mission.userPrompt,
    reason: "MARKET_DATA_REQUEST"
  };
  const metadataFirewall = scanMetadata(metadata);
  const builtContext = buildPaymentContext({
    missionId: mission.id,
    providerId: demoProvider.providerId,
    quoteId: `quote_${mission.id}_${demoProvider.providerId}`,
    method: "POST",
    challenge: normalizedChallenge,
    metadata: { ...metadataFirewall, evidenceMode },
    merchantAddress: demoProvider.merchantAddress,
    chainId: demoProvider.chainId,
    tokenId: demoProvider.tokenId,
    amountDecimals: 18,
    nonce: `nonce_${mission.id}_${demoProvider.providerId}`,
    issuedAt: now,
    cawPactId: demoPactId,
    serviceMode: "escrowed-delivery",
    body: { missionId: mission.id }
  });

  return {
    missionId: mission.id,
    providerRegistryEntries: [demoProvider],
    trustRecords: demoTrustRecords,
    challenge: rawChallenge,
    request: {
      method: "POST",
      url: resourceUrl,
      body: { missionId: mission.id },
      headers: {},
      boundHeaders: []
    },
    metadata,
    budgetLimitUsd: mission.budgetUsd,
    reservedBudgetUsd: normalizedChallenge.amount,
    amountDecimals: 18,
    cawPactId: demoPactId,
    serviceMode: "escrowed-delivery",
    evidenceMode,
    cawAdapter: createFallbackOnlyCawAdapter(),
    now,
    providerChallenge: {
      responseBody: {
        ok: false,
        status: "fallback_required",
        paymentContextHash: builtContext.paymentContextHash,
        source: "runtime_api",
        evidenceMode
      },
      responseHeaders: {
        "cache-control": "no-store",
        vary: "x-payment"
      },
      providerAddress: demoProvider.merchantAddress,
      providerPublicKey: demoProvider.publicKey,
      responseSchemaHash: sha256Hex("clear402.runtime.fallback_receipt.v1"),
      auditLogIds: [`runtime-fallback-${mission.id}`]
    }
  };
}

function createFallbackOnlyCawAdapter(): Parameters<typeof runGuardPipeline>[1]["cawAdapter"] {
  return {
    async transferTokens(input) {
      return {
        evidenceMode,
        requestId: input.requestId,
        walletAddress: demoWalletAddress,
        auditLogId: `runtime-fallback-${input.missionId}`,
        rawEvidenceRef: "runtime-api:fallback-only",
        decision: "fallback_required",
        denial: {
          code: "BOTCHAIN_TX_EVIDENCE_REQUIRED",
          reason: "Mission Flow Runtime API prepared guard evidence; BOT Chain tx execution is recorded by the deployment scripts.",
          details: {
            liveExecutor: "botchain-scripted",
            paymentAttempted: false,
            source: "runtime_api"
          },
          attemptedOperation: "contract_call",
          paymentContextHash: input.paymentContextHash,
          cawRequestId: input.requestId,
          auditLogId: `runtime-fallback-${input.missionId}`,
          evidenceMode
        }
      };
    }
  };
}

function ensureProviderInput(createdAt: number): Parameters<typeof ensureProvider>[1] {
  return {
    providerId: demoProvider.providerId,
    origin: demoProvider.origin,
    merchantAddress: demoProvider.merchantAddress,
    chainId: demoProvider.chainId,
    tokenId: demoProvider.tokenId,
    publicKey: demoProvider.publicKey,
    allowedResources: [...demoProvider.allowedResources],
    cawAllowlistStatus: demoProvider.cawAllowlistStatus,
    createdAt,
    ...(demoProvider.facilitatorUrl !== undefined
      ? { facilitatorUrl: demoProvider.facilitatorUrl }
      : {}),
    ...(demoProvider.erc8004AgentId !== undefined
      ? { erc8004AgentId: demoProvider.erc8004AgentId }
      : {}),
    ...(demoProvider.erc8004AgentUri !== undefined
      ? { erc8004AgentUri: demoProvider.erc8004AgentUri }
      : {}),
    ...(demoProvider.reputationThreshold !== undefined
      ? { reputationThreshold: demoProvider.reputationThreshold }
      : {}),
    ...(demoProvider.validationTags !== undefined
      ? { validationTags: [...demoProvider.validationTags] }
      : {})
  };
}

function buildRawChallenge(resourceUrl: string, now: number) {
  return {
    accepts: [
      {
        scheme: "exact",
        network: "botchain-testnet",
        asset: demoProvider.tokenId,
        amount: "1000000000000",
        payTo: demoProvider.merchantAddress,
        resource: resourceUrl,
        facilitatorUrl: demoProvider.facilitatorUrl,
        description: "Runtime fallback challenge for Mission Flow API",
        expiresAt: now + 300_000
      }
    ]
  };
}

function missionFromRow(row: MissionRow, resourceUrl: string): MissionFlowMission {
  return {
    id: row.id,
    userPrompt: row.userPrompt,
    budgetUsd: row.budgetUsd,
    resourceUrl,
    status: row.status,
    cawWalletUuid: row.cawWalletUuid,
    cawWalletAddress: row.cawWalletAddress ?? demoWalletAddress,
    pactId: row.pactId ?? demoPactId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    evidenceMode,
    source: "runtime_api"
  };
}

function requireMission(database: DatabaseSync, missionId: string): MissionRow {
  const row = database
    .prepare(
      `select
        id,
        user_prompt as userPrompt,
        budget_usd as budgetUsd,
        status,
        caw_wallet_uuid as cawWalletUuid,
        caw_wallet_address as cawWalletAddress,
        pact_id as pactId,
        created_at as createdAt,
        updated_at as updatedAt
      from missions
      where id = ?`
    )
    .get(missionId) as MissionRow | undefined;

  if (!row) {
    throw new MissionFlowError("MISSION_NOT_FOUND", "Mission not found.", 404, { missionId });
  }

  return row;
}

function readLatestPaymentContext(database: DatabaseSync, missionId: string): PaymentContextRow | undefined {
  return database
    .prepare(
      `select
        payment_context_hash as paymentContextHash,
        raw_context_json as rawContextJson,
        mission_id as missionId,
        provider_id as providerId,
        quote_id as quoteId,
        'clear402:' || substr(payment_context_hash, 3, 16) as cawRequestId
      from payment_contexts
      where mission_id = ?
      order by issued_at desc, payment_context_hash desc
      limit 1`
    )
    .get(missionId) as PaymentContextRow | undefined;
}

function readLatestReceipt(database: DatabaseSync, missionId: string): ReceiptRow | undefined {
  return database
    .prepare(
      `select
        receipt_id as receiptId,
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
        audit_log_ids as auditLogIds,
        redaction_summary_hash as redactionSummaryHash,
        evidence_mode as evidenceMode
      from receipts
      where mission_id = ?
      order by created_at desc, receipt_id desc
      limit 1`
    )
    .get(missionId) as ReceiptRow | undefined;
}

function readLatestProviderContext(database: DatabaseSync, missionId: string): ProviderContextRow | undefined {
  return database
    .prepare(
      `select
        pr.provider_id as providerId,
        pr.merchant_address as merchantAddress,
        pr.public_key as providerPublicKey
      from payment_contexts pc
      join provider_registry pr on pr.provider_id = pc.provider_id
      where pc.mission_id = ?
      order by pc.issued_at desc, pc.payment_context_hash desc
      limit 1`
    )
    .get(missionId) as ProviderContextRow | undefined;
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

function latestGuardSummary(database: DatabaseSync, missionId: string): MissionFlowGuardSummary {
  const latest = listGuardEvents(database, missionId).at(-1);
  if (!latest) {
    return {
      decision: "not_recorded",
      status: "not_recorded",
      evidenceMode
    };
  }

  return {
    decision: latest.decision,
    status: latest.decision === "block" ? "blocked" : "prepared",
    guardEventId: latest.id,
    layer: latest.layer,
    ...(latest.reason !== undefined ? { reason: latest.reason } : {}),
    evidenceMode: evidenceModeFromGuardDecision(latest.decision)
  };
}

function insertFallbackReceipt(
  database: DatabaseSync,
  input: {
    missionId: string;
    paymentContextHash: string;
    cawRequestId: string;
    context: PaymentContext;
    resource: string;
    providerAddress: string;
    providerPublicKey: string;
    guardEventId?: string;
    now: number;
  }
): MissionFlowReceiptSummary {
  const receiptId = `receipt_${input.paymentContextHash.slice(2, 18)}`;
  const responseBody = {
    ok: false,
    status: "fallback_required",
    missionId: input.missionId,
    paymentAttempted: false,
    evidenceMode
  };
  const providerResponseHash = sha256Hex(canonicalJson(responseBody));
  const responseSchemaHash = sha256Hex("clear402.runtime.fallback_receipt.v1");
  const asset = input.context.tokenId;
  const cawEvidenceRef = "runtime-api:fallback-only";
  const fallbackEvidenceRef = `fallback:${receiptId}`;
  const receiptStatus: ServiceReceipt["status"] = "failed";
  const serviceResultHash = buildServiceResultHash({
    receiptId,
    providerResponseHash,
    responseSchemaHash,
    resource: input.resource,
    asset,
    deliveryTimestamp: input.now,
    status: receiptStatus
  });
  const providerSignature = signReceiptForDemo(input.providerPublicKey, {
    paymentContextHash: input.paymentContextHash,
    providerResponseHash,
    resource: input.resource,
    asset,
    cawEvidenceRef,
    fallbackEvidenceRef,
    serviceResultHash,
    responseSchemaHash,
    deliveryTimestamp: input.now,
    status: receiptStatus
  });
  const auditLogIds = [input.guardEventId, `runtime-fallback-${input.missionId}`].filter(
    (value): value is string => typeof value === "string"
  );

  database
    .prepare(
      `insert into receipts (
        receipt_id,
        mission_id,
        payment_context_hash,
        caw_request_id,
        caw_wallet_address,
        pact_id,
        provider_address,
        resource,
        asset,
        service_result_hash,
        caw_evidence_ref,
        fallback_evidence_ref,
        facilitator_url_hash,
        tx_hash,
        cobo_transaction_id,
        chain_id,
        token_id,
        amount,
        provider_response_hash,
        provider_signature,
        response_schema_hash,
        delivery_timestamp,
        status,
        clearsig_digest,
        audit_log_ids,
        redaction_summary_hash,
        evidence_mode,
        created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'failed', ?, ?, ?, 'fallback', ?)
      on conflict(receipt_id) do update set
        caw_request_id = excluded.caw_request_id,
        resource = excluded.resource,
        asset = excluded.asset,
        service_result_hash = excluded.service_result_hash,
        caw_evidence_ref = excluded.caw_evidence_ref,
        fallback_evidence_ref = excluded.fallback_evidence_ref,
        provider_response_hash = excluded.provider_response_hash,
        provider_signature = excluded.provider_signature,
        response_schema_hash = excluded.response_schema_hash,
        delivery_timestamp = excluded.delivery_timestamp,
        status = 'failed',
        audit_log_ids = excluded.audit_log_ids,
        redaction_summary_hash = excluded.redaction_summary_hash,
        evidence_mode = 'fallback',
        created_at = excluded.created_at`
    )
    .run(
      receiptId,
      input.missionId,
      input.paymentContextHash,
      input.cawRequestId,
      demoWalletAddress,
      input.context.cawPactId,
      input.providerAddress,
      input.resource,
      asset,
      serviceResultHash,
      cawEvidenceRef,
      fallbackEvidenceRef,
      input.context.facilitatorUrlHash ?? null,
      null,
      null,
      input.context.chainId,
      input.context.tokenId,
      input.context.amount,
      providerResponseHash,
      providerSignature,
      responseSchemaHash,
      input.now,
      input.context.clearSignDigest ?? null,
      canonicalJson(auditLogIds),
      input.context.piiPolicyHash,
      input.now
    );

  const receipt = requireLatestReceipt(database, input.missionId);
  recordMissionTimelineEvent(database, {
    missionId: input.missionId,
    type: "receipt",
    createdAt: input.now,
    payload: buildMissionTimelineEventFromReceipt({
      receiptId: receipt.receiptId,
      paymentContextHash: receipt.paymentContextHash,
      cawRequestId: receipt.cawRequestId,
      txHash: receipt.txHash,
      status: receipt.status,
      evidenceMode: receipt.evidenceMode
    })
  });

  return receiptSummaryFromRow(receipt);
}

function receiptSummaryFromRow(row: ReceiptRow): MissionFlowReceiptSummary {
  const auditLogIds = parseJsonArray(row.auditLogIds).filter(
    (value): value is string => typeof value === "string"
  );

  return {
    receiptId: row.receiptId,
    ...(row.serviceResultHash !== null ? { serviceResultHash: row.serviceResultHash } : {}),
    ...(row.cawEvidenceRef !== null ? { cawEvidenceRef: row.cawEvidenceRef } : {}),
    ...(row.fallbackEvidenceRef !== null ? { fallbackEvidenceRef: row.fallbackEvidenceRef } : {}),
    ...(row.coboTransactionId !== null ? { coboTransactionId: row.coboTransactionId } : {}),
    deliveryTimestamp: row.deliveryTimestamp,
    paymentReceipt: {
      status: row.status === "paid" || row.status === "delivered" ? "paid" : "failed",
      requestId: row.cawRequestId ?? `clear402:${row.paymentContextHash.slice(2, 18)}`,
      walletAddress: row.cawWalletAddress,
      pactId: row.pactId,
      amount: row.amount,
      ...(row.asset !== null ? { asset: row.asset } : {}),
      ...(row.txHash !== null ? { txHash: row.txHash } : {}),
      evidenceMode: row.evidenceMode
    },
    deliveryReceipt: {
      status: row.status === "delivered" ? "delivered" : row.status === "paid_but_not_delivered" ? "paid_but_not_delivered" : "failed",
      responseHash: row.providerResponseHash,
      ...(row.resource !== null ? { resource: row.resource } : {}),
      providerSignature: row.providerSignature,
      schemaHash: row.responseSchemaHash ?? "n/a",
      ...(row.redactionSummaryHash !== null ? { redactionSummaryHash: row.redactionSummaryHash } : {}),
      evidenceMode: row.evidenceMode
    },
    finalStatus: row.status,
    auditLogIds,
    evidenceMode: row.evidenceMode
  };
}

function dualReceiptSummaryFromRow(row: DualReceiptRow): MissionFlowReceiptSummary {
  const dualReceipt = JSON.parse(row.dualReceiptJson) as DualReceipt;
  const verificationResult = JSON.parse(row.verificationResultJson) as DualReceiptVerificationResult;

  return {
    receiptId: row.receiptId,
    dualReceiptHash: row.dualReceiptHash,
    paymentReceiptHash: row.paymentReceiptHash,
    deliveryReceiptHash: row.deliveryReceiptHash,
    serviceResultHash: row.serviceResultHash,
    dualReceipt,
    verificationResult,
    paymentReceipt: {
      status: dualReceipt.paymentReceipt.status === "failed" ? "failed" : "paid",
      requestId: dualReceipt.paymentReceipt.requestId,
      walletAddress: dualReceipt.paymentReceipt.cawWalletAddress,
      pactId: dualReceipt.paymentReceipt.pactId,
      amount: dualReceipt.paymentReceipt.amount,
      asset: dualReceipt.paymentReceipt.asset,
      ...(dualReceipt.paymentReceipt.txHash !== undefined
        ? { txHash: dualReceipt.paymentReceipt.txHash }
        : {}),
      evidenceMode: dualReceipt.paymentReceipt.evidenceMode
    },
    deliveryReceipt: {
      status: dualReceipt.deliveryReceipt.status,
      responseHash: dualReceipt.deliveryReceipt.providerResponseHash,
      resource: dualReceipt.deliveryReceipt.resource,
      providerSignature: dualReceipt.deliveryReceipt.providerSignature,
      schemaHash: dualReceipt.deliveryReceipt.responseSchemaHash ?? "n/a",
      ...(dualReceipt.deliveryReceipt.redactionSummaryHash !== undefined
        ? { redactionSummaryHash: dualReceipt.deliveryReceipt.redactionSummaryHash }
        : {}),
      evidenceMode: dualReceipt.deliveryReceipt.evidenceMode
    },
    finalStatus:
      row.finalStatus === "delivered" ||
      row.finalStatus === "paid_but_not_delivered" ||
      row.finalStatus === "refunded"
        ? row.finalStatus
        : "failed",
    auditLogIds: [...dualReceipt.paymentReceipt.auditLogIds],
    evidenceMode: row.evidenceMode
  };
}

function serviceReceiptFromRow(row: ReceiptRow): ServiceReceipt {
  return {
    receiptId: row.receiptId,
    paymentContextHash: row.paymentContextHash,
    ...(row.cawRequestId !== null ? { cawRequestId: row.cawRequestId } : {}),
    cawWalletAddress: row.cawWalletAddress,
    pactId: row.pactId,
    providerAddress: row.providerAddress,
    ...(row.resource !== null ? { resource: row.resource } : {}),
    ...(row.asset !== null ? { asset: row.asset } : {}),
    ...(row.serviceResultHash !== null ? { serviceResultHash: row.serviceResultHash } : {}),
    ...(row.cawEvidenceRef !== null ? { cawEvidenceRef: row.cawEvidenceRef } : {}),
    ...(row.fallbackEvidenceRef !== null ? { fallbackEvidenceRef: row.fallbackEvidenceRef } : {}),
    ...(row.txHash !== null ? { txHash: row.txHash } : {}),
    ...(row.coboTransactionId !== null ? { coboTransactionId: row.coboTransactionId } : {}),
    chainId: row.chainId,
    tokenId: row.tokenId,
    amount: row.amount,
    providerResponseHash: row.providerResponseHash,
    providerSignature: row.providerSignature,
    ...(row.responseSchemaHash !== null ? { responseSchemaHash: row.responseSchemaHash } : {}),
    deliveryTimestamp: row.deliveryTimestamp,
    status: row.status,
    auditLogIds: parseJsonArray(row.auditLogIds).filter(
      (value): value is string => typeof value === "string"
    ),
    ...(row.redactionSummaryHash !== null ? { redactionSummaryHash: row.redactionSummaryHash } : {}),
    evidenceMode: row.evidenceMode
  };
}

function readDualReceiptReplayRecords(database: DatabaseSync, missionId: string) {
  return database
    .prepare(
      `select
        payment_context_hash as paymentContextHash,
        delivery_receipt_hash as deliveryReceiptHash,
        dual_receipt_hash as dualReceiptHash,
        created_at as createdAt
      from dual_receipts
      where mission_id = ?`
    )
    .all(missionId) as Array<{
      paymentContextHash: string;
      deliveryReceiptHash: string;
      dualReceiptHash: string;
      createdAt: number;
    }>;
}

function upsertDualReceipt(
  database: DatabaseSync,
  input: {
    missionId: string;
    dualReceipt: DualReceipt;
    verificationResult: DualReceiptVerificationResult;
    createdAt: number;
  }
) {
  database
    .prepare(
      `insert into dual_receipts (
        dual_receipt_hash,
        receipt_id,
        mission_id,
        payment_context_hash,
        payment_receipt_hash,
        delivery_receipt_hash,
        service_result_hash,
        resource,
        provider_address,
        provider_public_key_hash,
        final_status,
        verification_decision,
        verification_result_json,
        dual_receipt_json,
        evidence_mode,
        created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(payment_context_hash, delivery_receipt_hash) do update set
        verification_decision = excluded.verification_decision,
        verification_result_json = excluded.verification_result_json,
        dual_receipt_json = excluded.dual_receipt_json,
        created_at = excluded.created_at`
    )
    .run(
      input.dualReceipt.dualReceiptHash,
      input.dualReceipt.deliveryReceipt.receiptId,
      input.missionId,
      input.dualReceipt.paymentReceipt.paymentContextHash,
      input.dualReceipt.paymentReceipt.paymentReceiptHash,
      input.dualReceipt.deliveryReceipt.deliveryReceiptHash,
      input.dualReceipt.deliveryReceipt.serviceResultHash,
      input.dualReceipt.deliveryReceipt.resource,
      input.dualReceipt.deliveryReceipt.providerAddress,
      input.dualReceipt.verifierMetadata.providerPublicKeyHash ?? null,
      input.dualReceipt.finalStatus,
      input.verificationResult.decision,
      canonicalJson(input.verificationResult),
      canonicalJson(input.dualReceipt),
      input.dualReceipt.evidenceMode,
      input.createdAt
    );
}

function requireLatestReceipt(database: DatabaseSync, missionId: string): ReceiptRow {
  const row = readLatestReceipt(database, missionId);
  if (!row) {
    throw new MissionFlowError("RECEIPT_NOT_FOUND", "Receipt was not recorded.", 500, {
      missionId
    });
  }

  return row;
}

function parsePaymentContext(value: string): PaymentContext {
  const parsed = JSON.parse(value) as PaymentContext;
  return { ...parsed };
}

function latestNormalizedChallenge(
  result: GuardPipelineResult
): NormalizedX402Challenge | undefined {
  const evidence = result.guardEventId
    ? result.evidenceBundle.fallback.at(-1) ?? result.evidenceBundle.mock.at(-1)
    : undefined;
  if (evidence && typeof evidence === "object" && "evidenceJson" in evidence) {
    const challenge = (evidence as { evidenceJson?: { challenge?: unknown } }).evidenceJson?.challenge;
    if (isRecord(challenge)) {
      return challenge as unknown as NormalizedX402Challenge;
    }
  }

  return undefined;
}

function recordMissionResource(database: DatabaseSync, missionId: string, resourceUrl: string, now: number) {
  recordGuardEvent(database, {
    id: `mission_resource_${hashObject({ missionId, resourceUrl }).slice(2, 18)}`,
    missionId,
    layer: "mission_resource",
    decision: "fallback_required",
    reason: "Mission Flow API recorded the requested resource in fallback/demo mode.",
    evidenceJson: {
      source: "runtime_api",
      evidenceMode,
      resourceUrl
    },
    createdAt: now
  });
}

function missionResourceUrl(database: DatabaseSync, mission: MissionRow): string {
  for (const event of [...listGuardEvents(database, mission.id)].reverse()) {
    if (event.layer !== "mission_resource") {
      continue;
    }

    const value = event.evidenceJson.resourceUrl;
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return mission.userPrompt.includes("https://")
    ? mission.userPrompt.match(/https:\/\/\S+/)?.[0] ?? defaultResourceUrl
    : defaultResourceUrl;
}

function updateMissionStatus(
  database: DatabaseSync,
  missionId: string,
  status: MissionStatus,
  now: number
) {
  database
    .prepare(`update missions set status = ?, updated_at = ? where id = ?`)
    .run(status, now, missionId);
}

function normalizeId(value: unknown, prefix: string) {
  if (typeof value === "string" && /^[A-Za-z0-9_.:-]{1,96}$/.test(value)) {
    return value;
  }

  return `${prefix}_${randomUUID()}`;
}

function stringOrDefault(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function decimalOrDefault(value: unknown, fallback: string) {
  return typeof value === "string" && /^\d+(?:\.\d{1,18})?$/.test(value.trim())
    ? value.trim()
    : fallback;
}

function urlOrDefault(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  try {
    const url = new URL(value);
    const providerOrigin = new URL(demoProvider.origin).origin;
    return url.origin === providerOrigin ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

function withEvidenceMode<T extends object | undefined>(value: T, mode: EvidenceMode): T {
  if (value === undefined) {
    return value;
  }

  return { ...value, evidenceMode: mode };
}

function evidenceModeFromGuardDecision(_decision: GuardDecision): EvidenceMode {
  return evidenceMode;
}

function parseJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
