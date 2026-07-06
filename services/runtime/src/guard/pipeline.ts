import type { DatabaseSync } from "node:sqlite";

import type {
  CawPolicyDenialEvidence,
  EvidenceMode,
  ERC8004TrustResult,
  EvidenceBundle,
  GuardDecision,
  GuardEvent,
  MetadataFirewallResult,
  PaymentOperation,
  PaymentContext,
  ProviderRegistryEntry,
  ServiceReceipt,
  SignedProviderQuote,
  X402Quote
} from "../../../../packages/shared/src/index.mjs";
import { compareDecimalStrings, subtractDecimalStrings } from "./amount.ts";
import { clearSign, type ClearSignInput, type ClearSignResult } from "../clearsig/adapter.ts";
import {
  buildPaymentContext,
  canonicalizeUrl,
  type BuiltPaymentContext
} from "./payment_context.ts";
import { normalizeX402Challenge, type NormalizedX402Challenge } from "../x402/challenge_normalizer.ts";
import { validateProviderRegistry, type ProviderRegistryValidationResult } from "../x402/provider_registry.ts";
import {
  validateERC8004Trust,
  type ERC8004LiveSourceResult,
  type ERC8004TrustRecord
} from "../x402/erc8004_trust_adapter.ts";
import { scanMetadata, type MetadataTriple } from "./metadata_firewall.ts";
import {
  ensureProvider,
  getLedgerExposureUsd,
  markReservationDisputed,
  markReservationSpent,
  releaseReservationBudget,
  reserveQuoteAndBudget
} from "./quote_lock.ts";
import { hashObject, sha256Hex } from "./hash.ts";
import { recordGuardEvent, listGuardEvents } from "./events.ts";
import {
  buildServiceResultHash,
  verifyServiceReceipt,
  type VerifyServiceReceiptInput
} from "../receipt/receipt_verifier.ts";
import {
  verifySignedProviderQuote,
  type ProviderQuoteVerificationResult
} from "../x402/provider_quote.ts";
import {
  SERVICE_ESCROW_FUNCTION_ABIS,
  SERVICE_ESCROW_FUND_SELECTOR,
  buildServiceEscrowFundCalldata,
  serviceEscrowAmountFromPaymentContext
} from "../escrow/service_escrow_onchain.ts";

export interface CawAdapterLike {
  transferTokens(input: {
    requestId: string;
    missionId: string;
    providerId: string;
    chainId: string;
    tokenId: string;
    dstAddr: string;
    amount: string;
    pactId: string;
    paymentContextHash: string;
    paymentContext: PaymentContext;
  }): Promise<{
    evidenceMode: "live" | "fallback" | "mock";
    requestId: string;
    txHash?: string;
    coboTransactionId?: string;
    walletAddress: string;
    auditLogId?: string;
    rawEvidenceRef?: string;
    decision?: "allow" | "block" | "require_approval" | "fallback_required";
    denial?: CawPolicyDenialEvidence;
  }>;
  contractCall?(input: {
    requestId: string;
    missionId: string;
    providerId: string;
    chainId: string;
    contractAddress: string;
    calldata: string;
    amount: string;
    pactId: string;
    paymentContextHash: string;
    paymentContext: PaymentContext;
  }): Promise<{
    evidenceMode: "live" | "fallback" | "mock";
    requestId: string;
    txHash?: string;
    coboTransactionId?: string;
    walletAddress: string;
    auditLogId?: string;
    rawEvidenceRef?: string;
    decision?: "allow" | "block" | "require_approval" | "fallback_required";
    denial?: CawPolicyDenialEvidence;
  }>;
  signMessage?(input: {
    requestId: string;
    missionId: string;
    providerId: string;
    chainId: string;
    messageDigest: string;
    pactId: string;
    paymentContextHash: string;
    paymentContext: PaymentContext;
  }): Promise<{
    evidenceMode: "live" | "fallback" | "mock";
    requestId: string;
    txHash?: string;
    coboTransactionId?: string;
    walletAddress: string;
    auditLogId?: string;
    rawEvidenceRef?: string;
    decision?: "allow" | "block" | "require_approval" | "fallback_required";
    denial?: CawPolicyDenialEvidence;
  }>;
  getTransactionByRequestId?(requestId: string): Promise<{
    requestId: string;
    txHash?: string;
    status: "submitted" | "confirmed" | "failed";
    auditLogId?: string;
    providerResponseHash?: string;
    walletAddress?: string;
  } | null>;
  getAuditLogs?(filter: { missionId?: string; requestId?: string }): Promise<Array<{
    auditLogId: string;
    requestId?: string;
    decision: "allow" | "block" | "require_approval";
    reason?: string;
  }>>;
}

export interface GuardPipelineInput {
  missionId: string;
  providerRegistryEntries: ProviderRegistryEntry[];
  trustRecords: ERC8004TrustRecord[];
  erc8004LiveSource?: ERC8004LiveSourceResult;
  challenge: unknown;
  request: {
    method: "GET" | "POST";
    url: string;
    body?: unknown;
    headers?: Record<string, string | string[] | undefined>;
    boundHeaders?: string[];
    rawHeaders?: string[];
  };
  metadata: MetadataTriple;
  budgetLimitUsd: string;
  reservedBudgetUsd: string;
  amountDecimals: number;
  cawPactId: string;
  serviceMode: "caw-fetch" | "direct-transfer" | "escrowed-delivery";
  paymentOperation?: PaymentOperation;
  providerQuote?: SignedProviderQuote;
  policyBindings?: ClearSignInput["expected"];
  messageToSign?: unknown;
  cawAdapter: CawAdapterLike;
  evidenceMode?: EvidenceMode;
  now?: number;
  providerChallenge?: {
    responseSchemaHash?: string;
    responseHeaders?: Record<string, string | string[] | undefined>;
    providerCalldata?: string;
    serviceEscrowAddress?: string;
    providerSignature?: string;
    providerPublicKey?: string;
    providerAddress?: string;
    walletAddress?: string;
    responseBody?: unknown;
    auditLogIds?: string[];
  };
}

export interface GuardPipelineResult {
  decision: "allow" | "block" | "require_approval" | "fallback_required";
  status: "prepared" | "executed" | "completed" | "blocked" | "disputed";
  reason?: string;
  guardEventId?: string;
  providerRegistryResult?: ProviderRegistryValidationResult;
  trustResult?: ERC8004TrustResult;
  metadataFirewall?: MetadataFirewallResult;
  paymentContext?: PaymentContext;
  paymentContextHash?: string;
  cawRequestId?: string;
  quote?: X402Quote;
  reservation?: {
    quoteId: string;
    paymentContextHash: string;
    nonce: string;
    reservedBudget: string;
  };
  clearsig?: ClearSignResult;
  providerQuoteResult?: ProviderQuoteVerificationResult;
  cawEvidence?: {
    evidenceMode: "live" | "fallback" | "mock";
    requestId: string;
    txHash?: string;
    coboTransactionId?: string;
    walletAddress: string;
    auditLogId?: string;
    rawEvidenceRef?: string;
    denial?: CawPolicyDenialEvidence;
  };
  receipt?: ServiceReceipt;
  evidenceBundle: EvidenceBundle;
}

function createFailure(
  database: DatabaseSync,
  input: {
    missionId: string;
    layer: string;
    reason: string;
    decision: GuardDecision;
    evidence: Record<string, unknown>;
    now?: number;
  }
): GuardEvent {
  return recordGuardEvent(database, {
    missionId: input.missionId,
    layer: input.layer,
    reason: input.reason,
    decision: input.decision,
    evidenceJson: input.evidence,
    ...(input.now !== undefined ? { createdAt: input.now } : {})
  });
}

function extractChallengeResource(rawChallenge: unknown): string | undefined {
  if (!rawChallenge || typeof rawChallenge !== "object") {
    return undefined;
  }

  const record = rawChallenge as Record<string, unknown>;
  const accepts = Array.isArray(record.accepts) ? record.accepts : [record];
  const first = accepts[0];
  if (!first || typeof first !== "object") {
    return undefined;
  }

  const firstRecord = first as Record<string, unknown>;
  return typeof firstRecord.resource === "string" ? firstRecord.resource : undefined;
}

function evidenceBundleForMission(database: DatabaseSync, missionId: string): EvidenceBundle {
  const classifiedEvents = listGuardEvents(database, missionId).map((event) => ({
    event,
    evidenceMode: inferEventEvidenceMode(event.evidenceJson, event.decision)
  }));

  return {
    missionId,
    live: classifiedEvents
      .filter((entry) => entry.evidenceMode === "live")
      .map((entry) => entry.event),
    fallback: classifiedEvents
      .filter((entry) => entry.evidenceMode === "fallback")
      .map((entry) => entry.event),
    mock: classifiedEvents
      .filter((entry) => entry.evidenceMode === "mock")
      .map((entry) => entry.event),
    redactions: [],
    createdAt: Date.now()
  };
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

function nestedRecord(
  record: Record<string, unknown>,
  path: string[]
): Record<string, unknown> | undefined {
  let current: unknown = record;

  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return isRecord(current) ? current : undefined;
}

function evidenceModeFromRecord(record: Record<string, unknown> | undefined): EvidenceMode | undefined {
  const value = record?.evidenceMode;
  return value === "live" || value === "fallback" || value === "mock" ? value : undefined;
}

function modeMax(left: EvidenceMode, right: EvidenceMode): EvidenceMode {
  const rank: Record<EvidenceMode, number> = {
    live: 0,
    fallback: 1,
    mock: 2
  };

  return rank[right] > rank[left] ? right : left;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getProviderRegistryEntry(
  entries: ProviderRegistryEntry[],
  providerId: string
): ProviderRegistryEntry {
  const entry = entries.find((candidate) => candidate.providerId === providerId);
  if (!entry) {
    throw new Error("Provider registry entry not found");
  }

  return entry;
}

function ensureReceiptBody(receipt: ServiceReceipt | undefined): ServiceReceipt {
  if (!receipt) {
    throw new Error("Service receipt unavailable");
  }

  return receipt;
}

function normalizeHeaderValue(value: string | string[] | undefined): string[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value.map((entry) => entry.trim()) : [value.trim()];
}

function readHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string
): string | undefined {
  if (!headers) {
    return undefined;
  }

  const value = headers[name.toLowerCase()];
  const values = normalizeHeaderValue(value);
  return values.length > 0 ? values[0] : undefined;
}

function detectDuplicatePaymentHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
  rawHeaders: string[] | undefined
): { headerName: string; values: string[] } | undefined {
  const names = ["x-payment", "x-clear402-payment"];
  for (const name of names) {
    const values: string[] = [];
    const headerValue = headers?.[name];
    if (headerValue !== undefined) {
      values.push(...normalizeHeaderValue(headerValue));
    }

    if (rawHeaders !== undefined) {
      for (let index = 0; index < rawHeaders.length - 1; index += 2) {
        if (rawHeaders[index]?.trim().toLowerCase() === name) {
          values.push(rawHeaders[index + 1]?.trim() ?? "");
        }
      }
    }

    if (values.length > 1 || values.some((value) => value.includes(","))) {
      return {
        headerName: name,
        values
      };
    }
  }

  return undefined;
}

function responseHeadersLookCacheSafe(
  headers: Record<string, string | string[] | undefined> | undefined
): { allowed: boolean; reason?: string; checks: Record<string, boolean> } {
  if (headers === undefined) {
    return { allowed: true, checks: {} };
  }

  const cacheControl = readHeader(headers, "cache-control") ?? "";
  const vary = readHeader(headers, "vary") ?? "";
  const cacheTokens = cacheControl
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const varyTokens = vary
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const hasNoStoreOrPrivate =
    cacheTokens.includes("no-store") || cacheTokens.includes("private");
  const variesOnPayment = varyTokens.some((entry) =>
    ["x-payment", "x-clear402-payment", "authorization"].includes(entry)
  );

  const checks = {
    cacheControl: hasNoStoreOrPrivate,
    vary: variesOnPayment
  };

  if (!checks.cacheControl) {
    return {
      allowed: false,
      reason: "Cache confusion blocked by response cache-control policy",
      checks
    };
  }

  if (!checks.vary) {
    return {
      allowed: false,
      reason: "Cache confusion blocked by missing Vary payment binding",
      checks
    };
  }

  return { allowed: true, checks };
}

function hasCompleteLiveCawEvidence(cawEvidence: {
  requestId?: string;
  walletAddress?: string;
  txHash?: string;
  coboTransactionId?: string;
  auditLogId?: string;
  rawEvidenceRef?: string;
}): boolean {
  return Boolean(
    cawEvidence.requestId &&
      cawEvidence.walletAddress &&
      (cawEvidence.txHash || cawEvidence.coboTransactionId) &&
      cawEvidence.auditLogId &&
      cawEvidence.rawEvidenceRef
  );
}

function isEscrowContractCall(input: {
  operation: PaymentOperation;
  serviceMode: GuardPipelineInput["serviceMode"];
}): boolean {
  return input.operation === "contract_call" && input.serviceMode === "escrowed-delivery";
}

async function executeCawOperation(input: {
  cawAdapter: CawAdapterLike;
  operation: PaymentOperation;
  serviceMode: GuardPipelineInput["serviceMode"];
  builtContext: BuiltPaymentContext;
  missionId: string;
  providerEntry: ProviderRegistryEntry;
  challenge: NormalizedX402Challenge;
  cawPactId: string;
  contractAddress?: string;
  providerCalldata?: string;
  contractCallValue?: string;
}): Promise<Awaited<ReturnType<CawAdapterLike["transferTokens"]>>> {
  const base = {
    requestId: input.builtContext.cawRequestId,
    missionId: input.missionId,
    providerId: input.providerEntry.providerId,
    chainId: input.providerEntry.chainId,
    pactId: input.cawPactId,
    paymentContextHash: input.builtContext.paymentContextHash,
    paymentContext: input.builtContext.context
  };

  if (input.operation === "transfer") {
    return input.cawAdapter.transferTokens({
      ...base,
      tokenId: input.providerEntry.tokenId,
      dstAddr: input.providerEntry.merchantAddress,
      amount: input.challenge.amount
    });
  }

  if (input.operation === "contract_call") {
    if (input.providerCalldata === undefined) {
      return localCawOperationFailure({
        base,
        attemptedOperation: "contract_call",
        code: "CONTRACT_CALLDATA_REQUIRED",
        reason: "contract_call PaymentContext requires provider calldata for CAW execution.",
        decision: "block"
      });
    }

    if (
      input.contractAddress === undefined &&
      isEscrowContractCall({ operation: input.operation, serviceMode: input.serviceMode })
    ) {
      return localCawOperationFailure({
        base,
        attemptedOperation: "contract_call",
        code: "CONTRACT_ADDRESS_REQUIRED",
        reason: "contract_call PaymentContext requires an escrow contract address.",
        decision: "block"
      });
    }

    if (input.cawAdapter.contractCall === undefined) {
      return localCawOperationFailure({
        base,
        attemptedOperation: "contract_call",
        code: "CAW_CONTRACT_CALL_NOT_CONFIGURED",
        reason: "CawAdapter has no contract_call executor configured.",
        decision: "fallback_required"
      });
    }

    return input.cawAdapter.contractCall({
      ...base,
      contractAddress: input.contractAddress ?? input.providerEntry.merchantAddress,
      calldata: input.providerCalldata,
      amount:
        input.contractCallValue ??
        (isEscrowContractCall({ operation: input.operation, serviceMode: input.serviceMode })
          ? serviceEscrowAmountFromPaymentContext(
              input.builtContext.context.amount,
              input.builtContext.context.amountDecimals
            )
          : input.challenge.amount)
    });
  }

  if (input.builtContext.context.messageSignDigest === undefined) {
    return localCawOperationFailure({
      base,
      attemptedOperation: "message_sign",
      code: "MESSAGE_SIGN_DIGEST_REQUIRED",
      reason: "message_sign PaymentContext requires a messageSignDigest.",
      decision: "block"
    });
  }

  if (input.cawAdapter.signMessage === undefined) {
    return localCawOperationFailure({
      base,
      attemptedOperation: "message_sign",
      code: "CAW_MESSAGE_SIGN_NOT_CONFIGURED",
      reason: "CawAdapter has no message_sign executor configured.",
      decision: "fallback_required"
    });
  }

  return input.cawAdapter.signMessage({
    ...base,
    messageDigest: input.builtContext.context.messageSignDigest
  });
}

function localCawOperationFailure(input: {
  base: {
    requestId: string;
    paymentContextHash: string;
    paymentContext: PaymentContext;
  };
  attemptedOperation: PaymentOperation;
  code: string;
  reason: string;
  decision: "block" | "fallback_required";
}): Awaited<ReturnType<CawAdapterLike["transferTokens"]>> {
  return {
    evidenceMode: "fallback",
    requestId: input.base.requestId,
    walletAddress: "unavailable",
    decision: input.decision,
    denial: {
      code: input.code,
      reason: input.reason,
      details: {
        cawPactId: input.base.paymentContext.cawPactId,
        serviceMode: input.base.paymentContext.serviceMode
      },
      attemptedOperation: input.attemptedOperation,
      paymentContextHash: input.base.paymentContextHash,
      cawRequestId: input.base.requestId,
      auditLogId: `local-denial:${input.base.paymentContextHash.slice(0, 16)}`,
      evidenceMode: "fallback"
    }
  };
}

export async function runGuardPipeline(
  database: DatabaseSync,
  input: GuardPipelineInput
): Promise<GuardPipelineResult> {
  const now = input.now ?? Date.now();
  const challengeResource = extractChallengeResource(input.challenge);
  if (challengeResource === undefined) {
    const event = createFailure(database, {
      missionId: input.missionId,
      layer: "resource_binding",
      reason: "x402 challenge is missing resource",
      decision: "block",
      evidence: {
        challenge: input.challenge,
        request: input.request
      }
    });

    return {
      decision: "block",
      status: "blocked",
      reason: "x402 challenge is missing resource",
      guardEventId: event.id,
      evidenceBundle: evidenceBundleForMission(database, input.missionId)
    };
  }

  let requestUrl: ReturnType<typeof canonicalizeUrl>;
  let challengeUrl: ReturnType<typeof canonicalizeUrl>;

  try {
    requestUrl = canonicalizeUrl(input.request.url);
    challengeUrl = canonicalizeUrl(challengeResource);
  } catch (error) {
    const event = createFailure(database, {
      missionId: input.missionId,
      layer: "resource_binding",
      reason: error instanceof Error ? error.message : "Invalid request or challenge URL",
      decision: "block",
      evidence: {
        challenge: input.challenge,
        request: input.request
      }
    });

    return {
      decision: "block",
      status: "blocked",
      reason: error instanceof Error ? error.message : "Invalid request or challenge URL",
      guardEventId: event.id,
      evidenceBundle: evidenceBundleForMission(database, input.missionId)
    };
  }

  const duplicatePaymentHeader = detectDuplicatePaymentHeader(
    input.request.headers,
    input.request.rawHeaders
  );
  if (duplicatePaymentHeader !== undefined) {
    const event = createFailure(database, {
      missionId: input.missionId,
      layer: "http_headers",
      reason: "Duplicate payment header rejected",
      decision: "block",
      evidence: {
        duplicatePaymentHeader,
        request: input.request,
        challenge: input.challenge
      }
    });

    return {
      decision: "block",
      status: "blocked",
      reason: "Duplicate payment header rejected",
      guardEventId: event.id,
      evidenceBundle: evidenceBundleForMission(database, input.missionId)
    };
  }

  const rawChallenge = input.challenge;
  if (requestUrl.canonicalUrl !== challengeUrl.canonicalUrl) {
    const event = createFailure(database, {
      missionId: input.missionId,
      layer: "resource_binding",
      reason: "Cross-resource substitution blocked by canonical request binding",
      decision: "block",
      evidence: {
        challengeResource: challengeUrl.canonicalUrl,
        requestResource: requestUrl.canonicalUrl,
        challenge: rawChallenge,
        request: input.request
      }
    });

    return {
      decision: "block",
      status: "blocked",
      reason: "Cross-resource substitution blocked by canonical request binding",
      guardEventId: event.id,
      evidenceBundle: evidenceBundleForMission(database, input.missionId)
    };
  }

  const providerEntry =
    input.providerRegistryEntries.find((candidate) => {
      try {
        return new URL(candidate.origin).origin.toLowerCase() === requestUrl.origin;
      } catch {
        return false;
      }
    });

  if (!providerEntry) {
    const event = createFailure(database, {
      missionId: input.missionId,
      layer: "provider_registry",
      reason: "Provider registry entry not found",
      decision: "block",
      evidence: { challenge: rawChallenge }
    });

    return {
      decision: "block",
      status: "blocked",
      reason: "Provider registry entry not found",
      guardEventId: event.id,
      evidenceBundle: evidenceBundleForMission(database, input.missionId)
    };
  }

  const challenge = normalizeX402Challenge({
    providerId: providerEntry.providerId,
    rawChallenge: rawChallenge,
    now,
    ...(input.evidenceMode !== undefined ? { evidenceMode: input.evidenceMode } : {})
  });

  const challengeOrigin = new URL(challenge.resource).origin.toLowerCase();

  const registryValidation = validateProviderRegistry({
    entries: input.providerRegistryEntries,
    providerId: providerEntry.providerId,
    origin: challengeOrigin,
    resourcePath: new URL(challenge.resource).pathname + new URL(challenge.resource).search,
    payTo: challenge.payTo,
    chainId: providerEntry.chainId,
    tokenId: providerEntry.tokenId,
    cawAllowedMerchantAddresses: [providerEntry.merchantAddress],
    ...(challenge.facilitatorUrl !== undefined ? { facilitatorUrl: challenge.facilitatorUrl } : {})
  });
  const registryResult =
    input.evidenceMode === undefined
      ? registryValidation
      : { ...registryValidation, evidenceMode: input.evidenceMode };

  if (registryResult.decision !== "allow") {
    const event = createFailure(database, {
      missionId: input.missionId,
      layer: "provider_registry",
      reason: registryResult.reason ?? "Provider registry blocked challenge",
      decision: "block",
      evidence: { challenge, registryResult }
    });

    return {
      decision: "block",
      status: "blocked",
      ...(registryResult.reason !== undefined ? { reason: registryResult.reason } : {}),
      guardEventId: event.id,
      providerRegistryResult: registryResult,
      evidenceBundle: evidenceBundleForMission(database, input.missionId)
    };
  }

  const trustResult = validateERC8004Trust({
    entry: providerEntry,
    records: input.trustRecords,
    endpoint: challenge.resource,
    payTo: challenge.payTo,
    amount: challenge.amount,
    ...(input.erc8004LiveSource !== undefined ? { liveSource: input.erc8004LiveSource } : {})
  });

  if (trustResult.decision === "block") {
    const event = createFailure(database, {
      missionId: input.missionId,
      layer: "erc8004",
      reason: trustResult.reason ?? "ERC-8004 trust blocked payment",
      decision: "block",
      evidence: { challenge, registryResult, trustResult }
    });

    return {
      decision: "block",
      status: "blocked",
      ...(trustResult.reason !== undefined ? { reason: trustResult.reason } : {}),
      guardEventId: event.id,
      providerRegistryResult: registryResult,
      trustResult,
      evidenceBundle: evidenceBundleForMission(database, input.missionId)
    };
  }

  if (trustResult.decision === "fallback_required") {
    const event = createFailure(database, {
      missionId: input.missionId,
      layer: "erc8004",
      reason: trustResult.reason ?? "ERC-8004 live trust source is unavailable",
      decision: "fallback_required",
      evidence: { challenge, registryResult, trustResult }
    });

    return {
      decision: "fallback_required",
      status: "blocked",
      ...(trustResult.reason !== undefined ? { reason: trustResult.reason } : {}),
      guardEventId: event.id,
      providerRegistryResult: registryResult,
      trustResult,
      evidenceBundle: evidenceBundleForMission(database, input.missionId)
    };
  }

  const scannedMetadata = scanMetadata(input.metadata);
  const metadataFirewall =
    input.evidenceMode === undefined
      ? scannedMetadata
      : { ...scannedMetadata, evidenceMode: input.evidenceMode };
  if (metadataFirewall.decision === "block") {
    const event = createFailure(database, {
      missionId: input.missionId,
      layer: "metadata_firewall",
      reason: "PII metadata blocked",
      decision: "block",
      evidence: { challenge, registryResult, trustResult, metadataFirewall }
    });

    return {
      decision: "block",
      status: "blocked",
      reason: "Metadata firewall blocked the request",
      guardEventId: event.id,
      providerRegistryResult: registryResult,
      trustResult,
      metadataFirewall,
      evidenceBundle: evidenceBundleForMission(database, input.missionId)
    };
  }

  let metadataResourceUrl: ReturnType<typeof canonicalizeUrl>;
  try {
    metadataResourceUrl = canonicalizeUrl(input.metadata.resourceUrl);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Metadata resource URL is invalid";
    const event = createFailure(database, {
      missionId: input.missionId,
      layer: "resource_binding",
      reason,
      decision: "block",
      evidence: {
        challenge,
        request: input.request,
        registryResult,
        trustResult,
        metadataFirewall,
        metadata: input.metadata
      }
    });

    return {
      decision: "block",
      status: "blocked",
      reason,
      guardEventId: event.id,
      providerRegistryResult: registryResult,
      trustResult,
      metadataFirewall,
      evidenceBundle: evidenceBundleForMission(database, input.missionId)
    };
  }

  if (metadataResourceUrl.canonicalUrl !== requestUrl.canonicalUrl) {
    const event = createFailure(database, {
      missionId: input.missionId,
      layer: "resource_binding",
      reason: "Metadata resource does not match bound request resource",
      decision: "block",
      evidence: {
        boundResource: requestUrl.canonicalUrl,
        challengeResource: challengeUrl.canonicalUrl,
        metadataResource: metadataResourceUrl.canonicalUrl,
        challenge,
        request: input.request,
        registryResult,
        trustResult,
        metadataFirewall
      }
    });

    return {
      decision: "block",
      status: "blocked",
      reason: "Metadata resource does not match bound request resource",
      guardEventId: event.id,
      providerRegistryResult: registryResult,
      trustResult,
      metadataFirewall,
      evidenceBundle: evidenceBundleForMission(database, input.missionId)
    };
  }

  let providerQuoteResult: ProviderQuoteVerificationResult | undefined;
  if (input.providerQuote !== undefined) {
    providerQuoteResult = verifySignedProviderQuote({
      quote: input.providerQuote,
      challenge,
      providerPublicKey: providerEntry.publicKey,
      now
    });

    if (providerQuoteResult.decision === "block") {
      const event = createFailure(database, {
        missionId: input.missionId,
        layer: "provider_quote",
        reason: providerQuoteResult.reason ?? "Signed ProviderQuote verification failed",
        decision: "block",
        evidence: {
          challenge,
          registryResult,
          trustResult,
          metadataFirewall,
          providerQuote: input.providerQuote,
          providerQuoteResult
        }
      });

      return {
        decision: "block",
        status: "blocked",
        ...(providerQuoteResult.reason !== undefined ? { reason: providerQuoteResult.reason } : {}),
        guardEventId: event.id,
        providerRegistryResult: registryResult,
        trustResult,
        metadataFirewall,
        providerQuoteResult,
        evidenceBundle: evidenceBundleForMission(database, input.missionId)
      };
    }
  }

  const builtContext = buildPaymentContext({
    missionId: input.missionId,
    providerId: providerEntry.providerId,
    quoteId: `quote_${input.missionId}_${providerEntry.providerId}`,
    method: input.request.method,
    challenge,
    metadata: metadataFirewall,
    merchantAddress: providerEntry.merchantAddress,
    chainId: providerEntry.chainId,
    tokenId: providerEntry.tokenId,
    amountDecimals: input.amountDecimals,
    nonce: `nonce_${input.missionId}_${providerEntry.providerId}`,
    issuedAt: now,
    cawPactId: input.cawPactId,
    serviceMode: input.serviceMode,
    ...(input.paymentOperation !== undefined ? { operation: input.paymentOperation } : {}),
    ...(input.messageToSign !== undefined ? { messageToSign: input.messageToSign } : {}),
    ...(input.providerQuote !== undefined ? { providerQuote: input.providerQuote } : {}),
    ...(input.policyBindings !== undefined ? { policyBindings: input.policyBindings } : {}),
    body: input.request.body
  });

  if (
    input.providerQuote?.paymentContextHash !== undefined &&
    input.providerQuote.paymentContextHash !== builtContext.paymentContextHash
  ) {
    const event = createFailure(database, {
      missionId: input.missionId,
      layer: "provider_quote",
      reason: "Signed ProviderQuote paymentContextHash does not match the built PaymentContext",
      decision: "block",
      evidence: {
        challenge,
        registryResult,
        trustResult,
        metadataFirewall,
        paymentContext: builtContext.context,
        providerQuote: input.providerQuote,
        ...(providerQuoteResult !== undefined ? { providerQuoteResult } : {})
      }
    });

    return {
      decision: "block",
      status: "blocked",
      reason: "Signed ProviderQuote paymentContextHash does not match the built PaymentContext",
      guardEventId: event.id,
      providerRegistryResult: registryResult,
      trustResult,
      metadataFirewall,
      paymentContext: builtContext.context,
      paymentContextHash: builtContext.paymentContextHash,
      cawRequestId: builtContext.cawRequestId,
      ...(providerQuoteResult !== undefined ? { providerQuoteResult } : {}),
      evidenceBundle: evidenceBundleForMission(database, input.missionId)
    };
  }

  const reservationResult = reserveQuoteAndBudget(database, {
    missionId: input.missionId,
    provider: {
      providerId: providerEntry.providerId,
      origin: providerEntry.origin,
      merchantAddress: providerEntry.merchantAddress,
      chainId: providerEntry.chainId,
      tokenId: providerEntry.tokenId,
      publicKey: providerEntry.publicKey,
      allowedResources: [...providerEntry.allowedResources],
      cawAllowlistStatus: providerEntry.cawAllowlistStatus,
      ...(providerEntry.facilitatorUrl !== undefined
        ? { facilitatorUrl: providerEntry.facilitatorUrl }
        : {}),
      ...(providerEntry.erc8004AgentId !== undefined
        ? { erc8004AgentId: providerEntry.erc8004AgentId }
        : {}),
      ...(providerEntry.erc8004AgentUri !== undefined
        ? { erc8004AgentUri: providerEntry.erc8004AgentUri }
        : {}),
      ...(providerEntry.reputationThreshold !== undefined
        ? { reputationThreshold: providerEntry.reputationThreshold }
        : {}),
      ...(providerEntry.validationTags !== undefined
        ? { validationTags: [...providerEntry.validationTags] }
        : {})
    },
    paymentContextHash: builtContext.paymentContextHash,
    cawRequestId: builtContext.cawRequestId,
    context: builtContext.context,
    rawChallengeHash: challenge.rawChallengeHash,
    reservedBudget: input.reservedBudgetUsd,
    budgetLimitUsd: input.budgetLimitUsd,
    now
  });

  if (reservationResult.decision === "block" || !reservationResult.reservation) {
    const event = createFailure(database, {
      missionId: input.missionId,
      layer: "quote_lock",
      reason: reservationResult.reason ?? "Quote or budget reservation failed",
      decision: "block",
      evidence: {
        challenge,
        registryResult,
        trustResult,
        metadataFirewall,
        paymentContext: builtContext.context,
        reservationResult
      }
    });

    return {
      decision: "block",
      status: "blocked",
      ...(reservationResult.reason !== undefined ? { reason: reservationResult.reason } : {}),
      guardEventId: event.id,
      providerRegistryResult: registryResult,
      trustResult,
      metadataFirewall,
      paymentContext: builtContext.context,
      paymentContextHash: builtContext.paymentContextHash,
      cawRequestId: builtContext.cawRequestId,
      ...(reservationResult.reservation !== undefined
        ? {
            reservation: {
              quoteId: reservationResult.reservation.quoteId,
              paymentContextHash: reservationResult.reservation.paymentContextHash,
              nonce: reservationResult.reservation.nonce,
              reservedBudget: reservationResult.reservation.reservedBudget
            }
          }
        : {}),
      evidenceBundle: evidenceBundleForMission(database, input.missionId)
    };
  }

  const clearSignInput: ClearSignInput = {
    chainId: providerEntry.chainId,
    to:
      isEscrowContractCall({
        operation: input.paymentOperation ?? "transfer",
        serviceMode: input.serviceMode
      }) && input.providerChallenge?.serviceEscrowAddress !== undefined
        ? input.providerChallenge.serviceEscrowAddress
        : providerEntry.merchantAddress,
    expected: {
      ...(input.policyBindings ?? {}),
      merchantAddress: providerEntry.merchantAddress,
      amount: challenge.amount,
      tokenId: providerEntry.tokenId,
      allowedSelectors:
        input.policyBindings?.allowedSelectors ?? [
          "0xa9059cbb",
          "0x095ea7b3",
          "0x23b872dd",
          "0xac9650d8"
        ],
      paymentContextHash: builtContext.paymentContextHash
    },
    ...(input.providerChallenge?.responseBody !== undefined
      ? { typedData: input.providerChallenge.responseBody }
      : {})
  };
  if (
    isEscrowContractCall({
      operation: input.paymentOperation ?? "transfer",
      serviceMode: input.serviceMode
    })
  ) {
    if (input.providerChallenge?.serviceEscrowAddress === undefined) {
      const event = createFailure(database, {
        missionId: input.missionId,
        layer: "service_escrow",
        reason: "ServiceEscrow contract address is required for escrowed contract_call.",
        decision: "block",
        evidence: {
          challenge,
          registryResult,
          trustResult,
          metadataFirewall,
          paymentContext: builtContext.context
        }
      });
      releaseReservationBudget(database, builtContext.paymentContextHash);
      return {
        decision: "block",
        status: "blocked",
        reason: "ServiceEscrow contract address is required for escrowed contract_call.",
        guardEventId: event.id,
        providerRegistryResult: registryResult,
        trustResult,
        metadataFirewall,
        paymentContext: builtContext.context,
        paymentContextHash: builtContext.paymentContextHash,
        cawRequestId: builtContext.cawRequestId,
        reservation: {
          quoteId: reservationResult.reservation.quoteId,
          paymentContextHash: reservationResult.reservation.paymentContextHash,
          nonce: reservationResult.reservation.nonce,
          reservedBudget: reservationResult.reservation.reservedBudget
        },
        evidenceBundle: evidenceBundleForMission(database, input.missionId)
      };
    }

    const escrowCalldata = buildServiceEscrowFundCalldata({
      paymentContextHash: builtContext.paymentContextHash,
      providerAddress: providerEntry.merchantAddress,
      amount: serviceEscrowAmountFromPaymentContext(
        builtContext.context.amount,
        builtContext.context.amountDecimals
      )
    });
    Object.assign(clearSignInput, {
      calldata: escrowCalldata.calldata,
      expected: {
        ...clearSignInput.expected,
        amount: escrowCalldata.value,
        allowedSelectors: [SERVICE_ESCROW_FUND_SELECTOR],
        functionAbis: [...SERVICE_ESCROW_FUNCTION_ABIS],
        paramsMatch: escrowCalldata.policy.paramsMatch
      }
    });
  } else if (input.providerChallenge?.providerCalldata !== undefined) {
    Object.assign(clearSignInput, { calldata: input.providerChallenge.providerCalldata });
  } else if (input.providerChallenge?.providerSignature !== undefined) {
    Object.assign(clearSignInput, { calldata: input.providerChallenge.providerSignature });
  }
  const clearSignResult = clearSign(clearSignInput);

  if (clearSignResult.decision === "block") {
    const event = createFailure(database, {
      missionId: input.missionId,
      layer: "clearsig",
      reason: clearSignResult.reason ?? "clearsig blocked calldata",
      decision: "block",
      evidence: {
        challenge,
        registryResult,
        trustResult,
        metadataFirewall,
        paymentContext: builtContext.context,
        clearSignResult
      }
    });

    releaseReservationBudget(database, builtContext.paymentContextHash);
    return {
      decision: "block",
      status: "blocked",
      ...(clearSignResult.reason !== undefined ? { reason: clearSignResult.reason } : {}),
      guardEventId: event.id,
      providerRegistryResult: registryResult,
      trustResult,
      metadataFirewall,
      paymentContext: builtContext.context,
      paymentContextHash: builtContext.paymentContextHash,
      cawRequestId: builtContext.cawRequestId,
      reservation: {
        quoteId: reservationResult.reservation.quoteId,
        paymentContextHash: reservationResult.reservation.paymentContextHash,
        nonce: reservationResult.reservation.nonce,
        reservedBudget: reservationResult.reservation.reservedBudget
      },
      clearsig: clearSignResult,
      evidenceBundle: evidenceBundleForMission(database, input.missionId)
    };
  }

  const cawEvidence = await executeCawOperation({
    cawAdapter: input.cawAdapter,
    operation: input.paymentOperation ?? "transfer",
    serviceMode: input.serviceMode,
    builtContext,
    missionId: input.missionId,
    providerEntry,
    challenge,
    cawPactId: input.cawPactId,
    ...(input.providerChallenge?.serviceEscrowAddress !== undefined
      ? { contractAddress: input.providerChallenge.serviceEscrowAddress }
      : {}),
    ...(clearSignInput.calldata !== undefined ? { providerCalldata: clearSignInput.calldata } : {}),
    ...(isEscrowContractCall({
      operation: input.paymentOperation ?? "transfer",
      serviceMode: input.serviceMode
    })
      ? {
          contractCallValue: serviceEscrowAmountFromPaymentContext(
            builtContext.context.amount,
            builtContext.context.amountDecimals
          )
        }
      : {})
  });

  if (cawEvidence.decision === "require_approval") {
    const event = createFailure(database, {
      missionId: input.missionId,
      layer: "caw",
      reason: cawEvidence.denial?.reason ?? "CAW requires owner approval",
      decision: "require_approval",
      evidence: {
        challenge,
        registryResult,
        trustResult,
        metadataFirewall,
        paymentContext: builtContext.context,
        clearSignResult,
        cawEvidence
      }
    });
    releaseReservationBudget(database, builtContext.paymentContextHash);

    return {
      decision: "require_approval",
      status: "prepared",
      ...(cawEvidence.denial?.reason !== undefined
        ? { reason: cawEvidence.denial.reason }
        : { reason: "CAW requires owner approval" }),
      guardEventId: event.id,
      providerRegistryResult: registryResult,
      trustResult,
      metadataFirewall,
      paymentContext: builtContext.context,
      paymentContextHash: builtContext.paymentContextHash,
      cawRequestId: builtContext.cawRequestId,
      reservation: {
        quoteId: reservationResult.reservation.quoteId,
        paymentContextHash: reservationResult.reservation.paymentContextHash,
        nonce: reservationResult.reservation.nonce,
        reservedBudget: reservationResult.reservation.reservedBudget
      },
      clearsig: clearSignResult,
      cawEvidence,
      evidenceBundle: evidenceBundleForMission(database, input.missionId)
    };
  }

  if (cawEvidence.decision === "fallback_required") {
    const event = createFailure(database, {
      missionId: input.missionId,
      layer: "caw",
      reason: cawEvidence.denial?.reason ?? "CAW fallback evidence required before payment execution",
      decision: "fallback_required",
      evidence: {
        challenge,
        registryResult,
        trustResult,
        metadataFirewall,
        paymentContext: builtContext.context,
        clearSignResult,
        cawEvidence
      }
    });
    releaseReservationBudget(database, builtContext.paymentContextHash);

    return {
      decision: "fallback_required",
      status: "prepared",
      ...(cawEvidence.denial?.reason !== undefined
        ? { reason: cawEvidence.denial.reason }
        : { reason: "CAW fallback evidence required before payment execution" }),
      guardEventId: event.id,
      providerRegistryResult: registryResult,
      trustResult,
      metadataFirewall,
      paymentContext: builtContext.context,
      paymentContextHash: builtContext.paymentContextHash,
      cawRequestId: builtContext.cawRequestId,
      reservation: {
        quoteId: reservationResult.reservation.quoteId,
        paymentContextHash: reservationResult.reservation.paymentContextHash,
        nonce: reservationResult.reservation.nonce,
        reservedBudget: reservationResult.reservation.reservedBudget
      },
      clearsig: clearSignResult,
      cawEvidence,
      evidenceBundle: evidenceBundleForMission(database, input.missionId)
    };
  }

  if (cawEvidence.decision === "block" || cawEvidence.denial !== undefined) {
    const event = createFailure(database, {
      missionId: input.missionId,
      layer: "caw",
      reason: cawEvidence.denial?.reason ?? "CAW denied payment",
      decision: "block",
      evidence: {
        challenge,
        registryResult,
        trustResult,
        metadataFirewall,
        paymentContext: builtContext.context,
        clearSignResult,
        cawEvidence
      }
    });
    releaseReservationBudget(database, builtContext.paymentContextHash);

    return {
      decision: "block",
      status: "blocked",
      ...(cawEvidence.denial?.reason !== undefined
        ? { reason: cawEvidence.denial.reason }
        : { reason: "CAW denied payment" }),
      guardEventId: event.id,
      providerRegistryResult: registryResult,
      trustResult,
      metadataFirewall,
      paymentContext: builtContext.context,
      paymentContextHash: builtContext.paymentContextHash,
      cawRequestId: builtContext.cawRequestId,
      reservation: {
        quoteId: reservationResult.reservation.quoteId,
        paymentContextHash: reservationResult.reservation.paymentContextHash,
        nonce: reservationResult.reservation.nonce,
        reservedBudget: reservationResult.reservation.reservedBudget
      },
      clearsig: clearSignResult,
      cawEvidence,
      evidenceBundle: evidenceBundleForMission(database, input.missionId)
    };
  }

  if (cawEvidence.evidenceMode === "live" && !hasCompleteLiveCawEvidence(cawEvidence)) {
    const event = createFailure(database, {
      missionId: input.missionId,
      layer: "caw",
      reason: "CAW live evidence is missing wallet, transaction, audit, or raw evidence",
      decision: "fallback_required",
      evidence: {
        challenge,
        registryResult,
        trustResult,
        metadataFirewall,
        paymentContext: builtContext.context,
        clearSignResult,
        cawEvidence
      }
    });
    markReservationDisputed(database, builtContext.paymentContextHash);

    return {
      decision: "block",
      status: "disputed",
      reason: "CAW live evidence is missing wallet, transaction, audit, or raw evidence",
      guardEventId: event.id,
      providerRegistryResult: registryResult,
      trustResult,
      metadataFirewall,
      paymentContext: builtContext.context,
      paymentContextHash: builtContext.paymentContextHash,
      cawRequestId: builtContext.cawRequestId,
      reservation: {
        quoteId: reservationResult.reservation.quoteId,
        paymentContextHash: reservationResult.reservation.paymentContextHash,
        nonce: reservationResult.reservation.nonce,
        reservedBudget: reservationResult.reservation.reservedBudget
      },
      clearsig: clearSignResult,
      cawEvidence,
      evidenceBundle: evidenceBundleForMission(database, input.missionId)
    };
  }

  const cachePolicy = responseHeadersLookCacheSafe(input.providerChallenge?.responseHeaders);
  if (!cachePolicy.allowed) {
    const event = createFailure(database, {
      missionId: input.missionId,
      layer: "cache_policy",
      reason: cachePolicy.reason ?? "Cache confusion blocked by response policy",
      decision: "block",
      evidence: {
        challenge,
        registryResult,
        trustResult,
        metadataFirewall,
        paymentContext: builtContext.context,
        clearSignResult,
        cawEvidence,
        responseHeaders: input.providerChallenge?.responseHeaders,
        cachePolicy
      }
    });
    markReservationDisputed(database, builtContext.paymentContextHash);

    return {
      decision: "block",
      status: "disputed",
      ...(cachePolicy.reason !== undefined
        ? { reason: cachePolicy.reason }
        : { reason: "Cache confusion blocked by response policy" }),
      guardEventId: event.id,
      providerRegistryResult: registryResult,
      trustResult,
      metadataFirewall,
      paymentContext: builtContext.context,
      paymentContextHash: builtContext.paymentContextHash,
      cawRequestId: builtContext.cawRequestId,
      reservation: {
        quoteId: reservationResult.reservation.quoteId,
        paymentContextHash: reservationResult.reservation.paymentContextHash,
        nonce: reservationResult.reservation.nonce,
        reservedBudget: reservationResult.reservation.reservedBudget
      },
      clearsig: clearSignResult,
      cawEvidence,
      evidenceBundle: evidenceBundleForMission(database, input.missionId)
    };
  }

  markReservationSpent(database, builtContext.paymentContextHash);
  const receiptId = `receipt_${builtContext.paymentContextHash.slice(2, 18)}`;
  const receiptStatus: ServiceReceipt["status"] = "paid";
  const providerResponseHash =
    input.providerChallenge?.responseBody !== undefined
      ? sha256Hex(JSON.stringify(input.providerChallenge.responseBody))
      : undefined;
  const serviceResultHash =
    providerResponseHash !== undefined
      ? buildServiceResultHash({
          receiptId,
          providerResponseHash,
          ...(input.providerChallenge?.responseSchemaHash !== undefined
            ? { responseSchemaHash: input.providerChallenge.responseSchemaHash }
            : {}),
          resource: challenge.resource,
          asset: challenge.asset,
          deliveryTimestamp: now,
          status: receiptStatus
        })
      : undefined;
  const cawEvidenceRef =
    cawEvidence.rawEvidenceRef ?? `caw-fallback:${builtContext.paymentContextHash.slice(2, 18)}`;
  const fallbackEvidenceRef =
    cawEvidence.rawEvidenceRef === undefined
      ? `fallback:${builtContext.paymentContextHash.slice(2, 18)}`
      : undefined;

  const receiptInput: VerifyServiceReceiptInput = {
    receipt: ensureReceiptBody(
        input.providerChallenge?.responseBody !== undefined &&
        input.providerChallenge?.providerSignature !== undefined &&
        input.providerChallenge?.providerAddress !== undefined
        ? {
            receiptId,
            paymentContextHash: builtContext.paymentContextHash,
            cawRequestId: builtContext.cawRequestId,
            cawWalletAddress: cawEvidence.walletAddress,
            pactId: input.cawPactId,
            providerAddress: input.providerChallenge.providerAddress,
            resource: challenge.resource,
            asset: challenge.asset,
            serviceResultHash,
            cawEvidenceRef,
            ...(fallbackEvidenceRef !== undefined ? { fallbackEvidenceRef } : {}),
            ...(challenge.facilitatorUrl !== undefined
              ? { facilitatorUrlHash: sha256Hex(challenge.facilitatorUrl) }
              : {}),
            ...(cawEvidence.txHash !== undefined ? { txHash: cawEvidence.txHash } : {}),
            ...(cawEvidence.coboTransactionId !== undefined
              ? { coboTransactionId: cawEvidence.coboTransactionId }
              : {}),
            chainId: providerEntry.chainId,
            tokenId: providerEntry.tokenId,
            amount: challenge.amount,
            providerResponseHash: providerResponseHash ?? "",
            providerSignature: input.providerChallenge.providerSignature,
            ...(input.providerChallenge.responseSchemaHash !== undefined
              ? { responseSchemaHash: input.providerChallenge.responseSchemaHash }
              : {}),
            deliveryTimestamp: now,
            status: receiptStatus,
            ...(clearSignResult.calldataDigest ?? clearSignResult.typedDataDigest
              ? {
                  clearsigDigest:
                    clearSignResult.calldataDigest ?? clearSignResult.typedDataDigest
              }
              : {}),
            auditLogIds: input.providerChallenge.auditLogIds ?? [],
            redactionSummaryHash: metadataFirewall.piiPolicyHash,
            evidenceMode: cawEvidence.evidenceMode
          }
        : undefined
    ),
    responseBody: input.providerChallenge?.responseBody ?? {},
    providerPublicKey: input.providerChallenge?.providerPublicKey ?? providerEntry.publicKey,
    expectedPaymentContextHash: builtContext.paymentContextHash,
    expectedPactId: input.cawPactId,
    expectedProviderAddress: providerEntry.merchantAddress,
    expectedResource: challenge.resource,
    expectedAmount: challenge.amount,
    expectedChainId: providerEntry.chainId,
    expectedTokenId: providerEntry.tokenId,
    ...(input.providerChallenge?.responseSchemaHash !== undefined
      ? { responseSchemaHash: input.providerChallenge.responseSchemaHash }
      : {})
  };

  const receiptResult = verifyServiceReceipt(receiptInput);
  if (receiptResult.decision === "block") {
    const event = createFailure(database, {
      missionId: input.missionId,
      layer: "receipt",
      reason: receiptResult.reason ?? "Receipt verification failed",
      decision: "block",
      evidence: {
        challenge,
        registryResult,
        trustResult,
        metadataFirewall,
        paymentContext: builtContext.context,
        clearSignResult,
        cawEvidence,
        receiptResult
      }
    });
    markReservationDisputed(database, builtContext.paymentContextHash);

    return {
      decision: "block",
      status: "disputed",
      ...(receiptResult.reason !== undefined ? { reason: receiptResult.reason } : {}),
      guardEventId: event.id,
      providerRegistryResult: registryResult,
      trustResult,
      metadataFirewall,
      paymentContext: builtContext.context,
      paymentContextHash: builtContext.paymentContextHash,
      cawRequestId: builtContext.cawRequestId,
      reservation: {
        quoteId: reservationResult.reservation.quoteId,
        paymentContextHash: reservationResult.reservation.paymentContextHash,
        nonce: reservationResult.reservation.nonce,
        reservedBudget: reservationResult.reservation.reservedBudget
      },
      clearsig: clearSignResult,
      cawEvidence,
      receipt: receiptResult.receipt,
      evidenceBundle: evidenceBundleForMission(database, input.missionId)
    };
  }

  const successEvent = recordGuardEvent(database, {
    missionId: input.missionId,
    layer: "guard_pipeline",
    decision: "allow",
    evidenceJson: {
      challenge,
      registryResult,
      trustResult,
      metadataFirewall,
      paymentContext: builtContext.context,
      reservation: reservationResult.reservation,
      clearSignResult,
      cawEvidence,
      receipt: receiptResult.receipt
    },
    createdAt: now
  });
  const evidenceBundle = evidenceBundleForMission(database, input.missionId);

  return {
    decision: "allow",
    status: "completed",
    guardEventId: successEvent.id,
    providerRegistryResult: registryResult,
    trustResult,
    metadataFirewall,
    paymentContext: builtContext.context,
    paymentContextHash: builtContext.paymentContextHash,
    cawRequestId: builtContext.cawRequestId,
    reservation: {
      quoteId: reservationResult.reservation.quoteId,
      paymentContextHash: reservationResult.reservation.paymentContextHash,
      nonce: reservationResult.reservation.nonce,
      reservedBudget: reservationResult.reservation.reservedBudget
    },
    clearsig: clearSignResult,
    cawEvidence,
    receipt: receiptResult.receipt,
    evidenceBundle
  };
}
