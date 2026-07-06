import {
  createCawAdapter,
  createCawPolicyDenialEvidence,
} from "../caw-adapter.mjs";
import { clearSign } from "../clearsig/adapter.ts";
import { hashObject, sha256Hex } from "../guard/hash.ts";
import { buildPaymentContext } from "../guard/payment_context.ts";
import { runGuardPipeline } from "../guard/pipeline.ts";
import { scanMetadata } from "../guard/metadata_firewall.ts";
import { recordMissionTimelineEvent } from "../mission_timeline.ts";
import { normalizeX402Challenge } from "../x402/challenge_normalizer.ts";
import { validateERC8004Trust } from "../x402/erc8004_trust_adapter.ts";
import {
  buildServiceResultHash,
  signReceiptForDemo,
  type DemoReceiptSignatureInput
} from "../receipt/receipt_verifier.ts";
import {
  buildAttackPaymentContext,
  collectCawBoundaryEvidence,
  createAttackLabDatabase,
  createAttackRequest,
  createDemoProviderEntry,
  createDemoTrustRecord,
  createRawChallenge,
  encodeApproveCalldata,
  encodeMulticallCalldata,
  encodeTransferCalldata
} from "./common.ts";

export const ATTACK_NAMES = Object.freeze([
  "replay_same_proof",
  "cross_resource_substitution",
  "pii_leakage",
  "dynamic_price_overspend",
  "malicious_approve",
  "discovery_poisoning",
  "paid_but_denied",
  "erc8004_identity_mismatch",
  "low_reputation_provider",
  "header_confusion_duplicate_x_payment",
  "cache_confusion",
  "concurrent_free_riding_20_requests",
  "settlement_path_substitution",
  "partial_payment_decimals_confusion",
  "malformed_delivery",
  "multicall_hidden_operation"
]);

const DEMO_NOW = 1_800_000_000_000;
const DEMO_WALLET_ADDRESS = "0xCAW0000000000000000000000000000000000001";
const DEMO_RESPONSE_SCHEMA_HASH = sha256Hex("clear402.provider.report.v1");
const DEMO_DEFAULT_HEADERS = {
  "cache-control": "no-store, private",
  vary: "x-clear402-payment"
};

export const ATTACK_SCENARIOS = Object.freeze({
  replay_same_proof: {
    attack: "replay_same_proof",
    paper: "Five Attacks on x402 Agentic Payment Protocol",
    painPoint: "replay / free-riding",
    defense: "nonce lock + quote reservation + receipt state",
    evidenceAnchor: "replay_detected event",
    baselineRisk: "the same proof can be replayed to reserve the same paid request twice",
    blockedBy: "Quote Reservation / Nonce Lock",
    async build() {
      return makeReplayScenario();
    }
  },
  cross_resource_substitution: {
    attack: "cross_resource_substitution",
    paper: "Five Attacks on x402 Agentic Payment Protocol",
    painPoint: "weak binding",
    defense: "PaymentContext canonical URL hash",
    evidenceAnchor: "context mismatch event",
    baselineRisk: "a valid proof for one resource can be reused against a different resource",
    blockedBy: "PaymentContext Binder",
    async build() {
      return makeCrossResourceScenario();
    }
  },
  pii_leakage: {
    attack: "pii_leakage",
    paper: "Hardening x402: PII-Safe Agentic Payments",
    painPoint: "metadata leakage",
    defense: "Metadata Firewall",
    evidenceAnchor: "redacted metadata payload",
    baselineRisk: "raw metadata can leak email or secret material into the payment trail",
    blockedBy: "Metadata Firewall",
    async build() {
      return makePiiScenario();
    }
  },
  dynamic_price_overspend: {
    attack: "dynamic_price_overspend",
    paper: "Free-Riding in the AI Economy",
    painPoint: "dynamic pricing / overdraft",
    defense: "quote lock + CAW policy + budget ledger",
    evidenceAnchor: "CAW policy denial",
    baselineRisk: "a provider can raise the price after the quote and overspend the buyer budget",
    blockedBy: "CAW policy / Budget Ledger",
    async build() {
      return makeDynamicPriceScenario();
    }
  },
  malicious_approve: {
    attack: "malicious_approve",
    paper: "Five Attacks on x402 Agentic Payment Protocol",
    painPoint: "blind signing",
    defense: "clearsig semantic gate",
    evidenceAnchor: "decoded approve(max) block",
    baselineRisk: "the payment intent can be replaced with an unlimited approve",
    blockedBy: "clearsig",
    async build() {
      return makeMaliciousApproveScenario();
    }
  },
  discovery_poisoning: {
    attack: "discovery_poisoning",
    paper: "Five Attacks on x402 Agentic Payment Protocol",
    painPoint: "malicious provider discovery",
    defense: "Provider Registry + CAW allowlist",
    evidenceAnchor: "registry miss / unregistered provider",
    baselineRisk: "the agent can be steered toward a fake provider or payment destination",
    blockedBy: "Provider Registry",
    async build() {
      return makeDiscoveryPoisoningScenario();
    }
  },
  paid_but_denied: {
    attack: "paid_but_denied",
    paper: "A402: Binding Cryptocurrency Payments to Service Execution",
    painPoint: "payment-delivery mismatch",
    defense: "ServiceReceipt + fault evidence",
    evidenceAnchor: "paid_but_not_delivered receipt",
    baselineRisk: "the buyer pays and the provider still refuses to deliver",
    blockedBy: "ServiceReceipt verifier",
    async build() {
      return makePaidButDeniedScenario();
    }
  },
  erc8004_identity_mismatch: {
    attack: "erc8004_identity_mismatch",
    paper: "Five Attacks on x402 Agentic Payment Protocol",
    painPoint: "provider identity spoofing",
    defense: "ERC-8004 Trust Adapter",
    evidenceAnchor: "endpoint / payTo mismatch",
    baselineRisk: "the provider identity can point at a different endpoint or payTo address",
    blockedBy: "ERC-8004 Trust Adapter",
    async build() {
      return makeErc8004IdentityMismatchScenario();
    }
  },
  low_reputation_provider: {
    attack: "low_reputation_provider",
    paper: "Free-Riding in the AI Economy",
    painPoint: "low trust provider selection",
    defense: "ERC-8004 reputation threshold",
    evidenceAnchor: "reputation threshold block",
    baselineRisk: "a low-quality provider can still look structurally valid",
    blockedBy: "ERC-8004 Trust Adapter",
    async build() {
      return makeLowReputationProviderScenario();
    }
  },
  header_confusion_duplicate_x_payment: {
    attack: "header_confusion_duplicate_x_payment",
    paper: "Five Attacks on x402 Agentic Payment Protocol",
    painPoint: "web header ambiguity",
    defense: "HTTP canonicalizer",
    evidenceAnchor: "duplicate payment header rejection",
    baselineRisk: "duplicate payment headers can split parsing between middleware layers",
    blockedBy: "HTTP canonicalizer",
    async build() {
      return makeHeaderConfusionScenario();
    }
  },
  cache_confusion: {
    attack: "cache_confusion",
    paper: "Five Attacks on x402 Agentic Payment Protocol",
    painPoint: "cache leakage",
    defense: "cache-control / Vary validation + receipt verification",
    evidenceAnchor: "cache policy rejection",
    baselineRisk: "a paid response can be cached and replayed to another request",
    blockedBy: "Response cache policy",
    async build() {
      return makeCacheConfusionScenario();
    }
  },
  concurrent_free_riding_20_requests: {
    attack: "concurrent_free_riding_20_requests",
    paper: "Free-Riding in the AI Economy",
    painPoint: "race-condition free-riding",
    defense: "quote reservation DB lock",
    evidenceAnchor: "19 concurrent replays blocked",
    baselineRisk: "twenty parallel requests can race through the same paid quote",
    blockedBy: "Quote Reservation / DB lock",
    async build() {
      return makeConcurrentFreeRidingScenario();
    }
  },
  settlement_path_substitution: {
    attack: "settlement_path_substitution",
    paper: "Five Attacks on x402 Agentic Payment Protocol",
    painPoint: "settlement-path inconsistency",
    defense: "provider registry + quoteTermsHash",
    evidenceAnchor: "facilitator/payTo mismatch",
    baselineRisk: "the settlement path can be swapped after the quote was issued",
    blockedBy: "Provider Registry",
    async build() {
      return makeSettlementPathScenario();
    }
  },
  partial_payment_decimals_confusion: {
    attack: "partial_payment_decimals_confusion",
    paper: "A402: Binding Cryptocurrency Payments to Service Execution",
    painPoint: "amount normalization",
    defense: "clearsig amount decoder",
    evidenceAnchor: "amount mismatch",
    baselineRisk: "a payment can be under-specified or misread because of token decimals",
    blockedBy: "clearsig",
    async build() {
      return makePartialPaymentScenario();
    }
  },
  malformed_delivery: {
    attack: "malformed_delivery",
    paper: "A402: Binding Cryptocurrency Payments to Service Execution",
    painPoint: "delivery schema mismatch",
    defense: "response schema validation",
    evidenceAnchor: "malformed delivery rejected",
    baselineRisk: "a provider can return a body that does not match the expected delivery contract",
    blockedBy: "ServiceReceipt verifier",
    async build() {
      return makeMalformedDeliveryScenario();
    }
  },
  multicall_hidden_operation: {
    attack: "multicall_hidden_operation",
    paper: "Hardening x402: PII-Safe Agentic Payments",
    painPoint: "hidden signer intent",
    defense: "multicall selector inspection",
    evidenceAnchor: "hidden selector block",
    baselineRisk: "a harmless outer call can hide an unsafe inner operation",
    blockedBy: "clearsig",
    async build() {
      return makeMulticallHiddenOperationScenario();
    }
  }
});

export async function runScenarioByName(attackName: string, options: {
  capabilityReport?: unknown;
  now?: number;
} = {}) {
  const scenario = (ATTACK_SCENARIOS as Record<string, ScenarioDefinition>)[attackName];
  if (!scenario) {
    throw new Error(`Unknown attack: ${attackName}`);
  }

  const config = await scenario.build();
  return executeAttackScenario(scenario, config, options);
}

export async function runAllScenarios(options: {
  capabilityReport?: unknown;
  now?: number;
} = {}) {
  const results = [];
  for (const attackName of ATTACK_NAMES) {
    results.push(await runScenarioByName(attackName, options));
  }

  return results;
}

type ScenarioDefinition = {
  attack: string;
  paper: string;
  painPoint: string;
  defense: string;
  evidenceAnchor: string;
  baselineRisk: string;
  blockedBy: string;
  build: () => Promise<ScenarioConfig> | ScenarioConfig;
};

type ScenarioConfig = {
  missionId?: string;
  provider?: ReturnType<typeof createDemoProviderEntry>;
  providerRegistryEntries?: Array<ReturnType<typeof createDemoProviderEntry>>;
  trustRecords?: Array<ReturnType<typeof createDemoTrustRecord>>;
  rawChallenge: unknown;
  request: ReturnType<typeof createAttackRequest>;
  metadata: {
    resourceUrl: string;
    description?: string;
    reason?: string;
  };
  budgetLimitUsd: string;
  reservedBudgetUsd: string;
  amountDecimals: number;
  cawPactId: string;
  serviceMode: "caw-fetch" | "direct-transfer" | "escrowed-delivery";
  cawOutcome:
    | { type: "allow" }
    | { type: "block"; code: string; reason: string; suggestion?: string }
    | { type: "block_if_amount_over"; maxAmount: string; code: string; reason: string; suggestion?: string };
  providerChallenge: (input: {
    builtContext: ReturnType<typeof buildPaymentContext>;
    provider: ReturnType<typeof createDemoProviderEntry>;
    now: number;
  }) => {
    responseBody: unknown;
    responseSchemaHash?: string;
    responseHeaders?: Record<string, string | string[] | undefined>;
    providerCalldata?: string;
    providerSignature?: string;
    providerAddress?: string;
    providerPublicKey?: string;
    auditLogIds?: string[];
  };
  execute?: (input: {
    runOnce: () => Promise<unknown>;
    buildBaseResult: (guardResult: unknown, extra?: Record<string, unknown>) => Record<string, unknown>;
    provider: ReturnType<typeof createDemoProviderEntry>;
    capabilityReport: unknown;
    now: number;
    builtContext: ReturnType<typeof buildPaymentContext>;
    rawChallenge: unknown;
    request: ReturnType<typeof createAttackRequest>;
    metadata: ReturnType<typeof scanMetadata>;
    providerChallenge: unknown;
    cawBoundary: unknown;
    missionId: string;
  }) => Promise<Record<string, unknown>> | Record<string, unknown>;
};

async function executeAttackScenario(
  scenario: ScenarioDefinition,
  config: ScenarioConfig,
  options: { capabilityReport?: unknown; now?: number } = {}
) {
  const now = options.now ?? DEMO_NOW;
  const capabilityReport = options.capabilityReport ?? probeCawCapabilitiesFallback();
  const provider = config.provider ?? createDemoProviderEntry();
  const providerRegistryEntries = config.providerRegistryEntries ?? [provider];
  const trustRecords = config.trustRecords ?? [createDemoTrustRecord(provider)];
  const missionId = config.missionId ?? `mission-${scenario.attack}`;
  const database = createAttackLabDatabase();
  const rawChallenge = config.rawChallenge;
  const normalized = normalizeX402Challenge({
    providerId: provider.providerId,
    rawChallenge,
    now,
    evidenceMode: "mock"
  });
  const metadata = scanMetadata(config.metadata);
  const builtContext = buildPaymentContext({
    missionId,
    providerId: provider.providerId,
    quoteId: `quote_${missionId}_${provider.providerId}`,
    method: config.request.method,
    challenge: normalized,
    metadata,
    merchantAddress: provider.merchantAddress,
    chainId: provider.chainId,
    tokenId: provider.tokenId,
    amountDecimals: config.amountDecimals,
    nonce: `nonce_${missionId}_${provider.providerId}`,
    issuedAt: now,
    cawPactId: config.cawPactId,
    serviceMode: config.serviceMode,
    body: config.request.body
  });
  const cawBoundary = await collectCawBoundaryEvidence(builtContext.context, capabilityReport, now);
  const providerChallenge = config.providerChallenge({
    builtContext,
    provider,
    now
  });
  const runOnce = async () => {
    const guardResult = await runGuardPipeline(database, {
      missionId,
      providerRegistryEntries,
      trustRecords,
      challenge: rawChallenge,
      request: config.request,
      metadata: {
        resourceUrl: metadata.sanitized.resourceUrl,
        ...(metadata.sanitized.description !== undefined
          ? { description: metadata.sanitized.description }
          : {}),
        ...(metadata.sanitized.reason !== undefined
          ? { reason: metadata.sanitized.reason }
          : {})
      },
      budgetLimitUsd: config.budgetLimitUsd,
      reservedBudgetUsd: config.reservedBudgetUsd,
      amountDecimals: config.amountDecimals,
      cawPactId: config.cawPactId,
      serviceMode: config.serviceMode,
      cawAdapter: createScenarioCawAdapter(config.cawOutcome, now),
      now,
      providerChallenge
    });

    recordMissionTimelineEvent(database, {
      missionId,
      type: "attack",
      createdAt: now,
      payload: {
        title: `${scenario.attack} attack`,
        detail: `${scenario.blockedBy} handled ${scenario.attack.replace(/_/g, " ")}.`,
        status: guardResult.decision === "allow" ? "success" : "blocked",
        evidenceMode: cawBoundary.execution.evidenceMode ?? "mock",
        attack: scenario.attack,
        paper: scenario.paper,
        blockedBy: scenario.blockedBy,
        decision: toAttackDecision(guardResult.decision),
        guardEventId: (guardResult as { guardEventId?: string }).guardEventId
      }
    });

    return guardResult;
  };

  const buildBaseResult = (guardResult: unknown, extra: Record<string, unknown> = {}) => ({
    attack: scenario.attack,
    paper: scenario.paper,
    paperMapping: {
      paper: scenario.paper,
      painPoint: scenario.painPoint,
      defense: scenario.defense,
      evidence: scenario.evidenceAnchor
    },
    baselineRisk: scenario.baselineRisk,
    blockedBy: scenario.blockedBy,
    decision: toAttackDecision((guardResult as { decision: string }).decision),
    guardEventId: (guardResult as { guardEventId?: string }).guardEventId,
    evidenceMode: cawBoundary.execution.evidenceMode ?? "mock",
    fixtureMode: "mock",
    cawBoundary,
    guard: guardResult,
    input: {
      missionId: config.missionId ?? `mission-${scenario.attack}`,
      providerId: provider.providerId,
      request: config.request,
      metadata: config.metadata,
      amountDecimals: config.amountDecimals,
      budgetLimitUsd: config.budgetLimitUsd,
      reservedBudgetUsd: config.reservedBudgetUsd,
      cawPactId: config.cawPactId,
      serviceMode: config.serviceMode
    },
    evidence: {
      modes: {
        fixture: "mock",
        cawBoundary: cawBoundary.execution.evidenceMode ?? "mock",
        guard:
          (guardResult as {
            cawEvidence?: { evidenceMode?: "live" | "fallback" | "mock" };
          }).cawEvidence?.evidenceMode ?? "mock"
      },
      provider,
      capabilityReport,
      rawChallenge,
      request: config.request,
      metadata: config.metadata,
      builtContext: builtContext.context,
      providerChallenge,
      cawBoundary,
      guard: guardResult,
      ...extra
    },
    ...extra
  });

  const result =
    config.execute !== undefined
      ? await config.execute({
          runOnce,
          buildBaseResult,
          provider,
          capabilityReport,
          now,
          builtContext,
          rawChallenge,
          request: config.request,
          metadata,
      providerChallenge,
      cawBoundary,
      missionId
        })
      : buildBaseResult(await runOnce());

  return {
    ...result
  };
}

function createScenarioCawAdapter(
  outcome: ScenarioConfig["cawOutcome"],
  now: number
): {
  transferTokens: (input: {
    requestId: string;
    missionId: string;
    providerId: string;
    chainId: string;
    tokenId: string;
    dstAddr: string;
    amount: string;
    pactId: string;
    paymentContextHash: string;
  }) => Promise<{
    evidenceMode: "live" | "fallback" | "mock";
    requestId: string;
    txHash?: string;
    walletAddress: string;
    auditLogId?: string;
    decision?: "allow" | "block" | "require_approval";
    denial?: ReturnType<typeof createCawPolicyDenialEvidence>;
  }>;
} {
  return {
    async transferTokens(input) {
      const walletAddress = DEMO_WALLET_ADDRESS;

      if (
        outcome.type === "block" ||
        (outcome.type === "block_if_amount_over" && BigInt(input.amount) > BigInt(outcome.maxAmount))
      ) {
        return {
          evidenceMode: "fallback",
          requestId: input.requestId,
          walletAddress,
          decision: "block",
          denial: createCawPolicyDenialEvidence({
            code: outcome.code,
            reason: outcome.reason,
            suggestion: "Request a fresh quote and stay within the approved price envelope.",
            details:
              outcome.type === "block_if_amount_over"
                ? {
                    maxAmount: outcome.maxAmount,
                    requestedAmount: input.amount
                  }
                : { requestedAmount: input.amount },
            attemptedOperation: "transfer",
            paymentContextHash: input.paymentContextHash,
            cawRequestId: input.requestId,
            auditLogId: `audit-${input.missionId}`,
            evidenceMode: "fallback"
          })
        };
      }

      return {
        evidenceMode: "fallback",
        requestId: input.requestId,
        walletAddress,
        txHash: `0x${sha256Hex(`${input.requestId}:${input.paymentContextHash}`).slice(2, 66)}`,
        auditLogId: `audit-${input.missionId}`,
        decision: "allow"
      };
    }
  };
}

function toAttackDecision(decision: string) {
  if (decision === "block") {
    return "blocked";
  }

  if (decision === "allow") {
    return "allowed";
  }

  return "require_approval";
}

function probeCawCapabilitiesFallback() {
  const report = createCawAdapter({
    capabilities: undefined
  }).getCapabilities();
  return report;
}

function makeSafeProviderChallengeArtifacts(input: {
  provider: ReturnType<typeof createDemoProviderEntry>;
  builtContext: ReturnType<typeof buildPaymentContext>;
  now: number;
  responseBody?: unknown;
  responseSchemaHash?: string;
  responseHeaders?: Record<string, string | string[] | undefined>;
  providerCalldata?: string;
  providerAddress?: string;
  providerPublicKey?: string;
  auditLogIds?: string[];
  cawEvidenceRef?: string;
  fallbackEvidenceRef?: string;
  receiptStatus?: "paid" | "refundable" | "refunded" | "failed" | "delivered" | "paid_but_not_delivered";
}) {
  const responseBody =
    input.responseBody ?? { ok: true, paymentContextHash: input.builtContext.paymentContextHash };
  const providerResponseHash = sha256Hex(JSON.stringify(responseBody));
  const responseSchemaHash = input.responseSchemaHash ?? DEMO_RESPONSE_SCHEMA_HASH;
  const resource = `${input.provider.origin}/paid/report`;
  const asset = "0x0000000000000000000000000000000000000001";
  const paymentContextSuffix = input.builtContext.paymentContextHash.slice(2, 18);
  const cawEvidenceRef = input.cawEvidenceRef ?? `caw-fallback:${paymentContextSuffix}`;
  const fallbackEvidenceRef = input.fallbackEvidenceRef ?? `fallback:${paymentContextSuffix}`;
  const receiptStatus = input.receiptStatus ?? "paid";
  const serviceResultHash = buildServiceResultHash({
    receiptId: `receipt_${input.builtContext.paymentContextHash.slice(2, 18)}`,
    providerResponseHash,
    responseSchemaHash,
    resource,
    asset,
    deliveryTimestamp: input.now,
    status: receiptStatus
  });
  const receipt = {
    paymentContextHash: input.builtContext.paymentContextHash,
    providerResponseHash,
    responseSchemaHash,
    deliveryTimestamp: input.now,
    status: receiptStatus
  };
  const signatureInput: DemoReceiptSignatureInput = {
    paymentContextHash: receipt.paymentContextHash,
    providerResponseHash: receipt.providerResponseHash,
    resource,
    asset,
    cawEvidenceRef,
    fallbackEvidenceRef,
    serviceResultHash,
    deliveryTimestamp: receipt.deliveryTimestamp,
    status: receipt.status,
    ...(receipt.responseSchemaHash !== undefined
      ? { responseSchemaHash: receipt.responseSchemaHash }
      : {})
  };

  const providerSignature = signReceiptForDemo(
    input.providerPublicKey ?? input.provider.publicKey,
    signatureInput
  );

  return {
    responseBody,
    responseSchemaHash,
    responseHeaders: input.responseHeaders ?? DEMO_DEFAULT_HEADERS,
    providerCalldata:
      input.providerCalldata ?? encodeTransferCalldata(input.provider.merchantAddress, input.builtContext.context.amount),
    providerSignature,
    providerAddress: input.providerAddress ?? input.provider.merchantAddress,
    providerPublicKey: input.providerPublicKey ?? input.provider.publicKey,
    auditLogIds:
      input.auditLogIds ?? [`provider-local:${input.builtContext.paymentContextHash.slice(2, 18)}`]
  };
}

async function makeReplayScenario() {
  const provider = createDemoProviderEntry();
  const rawChallenge = createRawChallenge({
    provider,
    resourceUrl: `${provider.origin}/paid/report`,
    amount: "5",
    issuedAt: DEMO_NOW,
    description: "Replayable report quote"
  });
  return {
    missionId: "mission-replay",
    provider,
    trustRecords: [createDemoTrustRecord(provider)],
    rawChallenge,
    request: createAttackRequest({
      url: `${provider.origin}/paid/report`,
      method: "GET"
    }),
    metadata: {
      resourceUrl: `${provider.origin}/paid/report`,
      description: "replay-safe metadata",
      reason: "MARKET_DATA_REQUEST"
    },
    budgetLimitUsd: "10",
    reservedBudgetUsd: "1",
    amountDecimals: 6,
    cawPactId: "pact-replay",
    serviceMode: "caw-fetch",
    cawOutcome: { type: "allow" },
    execute: async ({ runOnce, buildBaseResult }) => {
      const first = await runOnce();
      const second = await runOnce();
      return buildBaseResult(second, {
        attempts: [first, second],
        replayEvidence: {
          firstDecision: (first as { decision: string }).decision,
          secondDecision: (second as { decision: string }).decision
        }
      });
    },
    providerChallenge: (input: { builtContext: ReturnType<typeof buildPaymentContext>; provider: ReturnType<typeof createDemoProviderEntry>; now: number }) =>
      makeSafeProviderChallengeArtifacts({
        provider: input.provider,
        builtContext: input.builtContext,
        now: input.now
      })
  } satisfies ScenarioConfig;
}

async function makeCrossResourceScenario() {
  const provider = createDemoProviderEntry();
  const rawChallenge = createRawChallenge({
    provider,
    resourceUrl: `${provider.origin}/paid/report`,
    amount: "5",
    issuedAt: DEMO_NOW,
    description: "Original report quote"
  });
  return {
    missionId: "mission-cross-resource",
    provider,
    trustRecords: [createDemoTrustRecord(provider)],
    rawChallenge,
    request: createAttackRequest({
      url: `${provider.origin}/paid/admin-ledger`,
      method: "GET"
    }),
    metadata: {
      resourceUrl: `${provider.origin}/paid/admin-ledger`,
      description: "cross resource substitution",
      reason: "MARKET_DATA_REQUEST"
    },
    budgetLimitUsd: "10",
    reservedBudgetUsd: "1",
    amountDecimals: 6,
    cawPactId: "pact-cross-resource",
    serviceMode: "caw-fetch",
    cawOutcome: { type: "allow" },
    providerChallenge: (input) =>
      makeSafeProviderChallengeArtifacts({
        provider: input.provider,
        builtContext: input.builtContext,
        now: input.now
      })
  } satisfies ScenarioConfig;
}

async function makePiiScenario() {
  const provider = createDemoProviderEntry();
  const rawChallenge = createRawChallenge({
    provider,
    resourceUrl: `${provider.origin}/paid/report`,
    amount: "5",
    issuedAt: DEMO_NOW,
    description: "Metadata contains alice@example.com"
  });
  return {
    missionId: "mission-pii",
    provider,
    trustRecords: [createDemoTrustRecord(provider)],
    rawChallenge,
    request: createAttackRequest({
      url: `${provider.origin}/paid/report`,
      method: "GET"
    }),
    metadata: {
      resourceUrl: `${provider.origin}/paid/report`,
      description: "api_key=supersecretvalue123456",
      reason: "MARKET_DATA_REQUEST"
    },
    budgetLimitUsd: "10",
    reservedBudgetUsd: "1",
    amountDecimals: 6,
    cawPactId: "pact-pii",
    serviceMode: "caw-fetch",
    cawOutcome: { type: "allow" },
    providerChallenge: (input) =>
      makeSafeProviderChallengeArtifacts({
        provider: input.provider,
        builtContext: input.builtContext,
        now: input.now
      })
  } satisfies ScenarioConfig;
}

async function makeDynamicPriceScenario() {
  const provider = createDemoProviderEntry();
  const rawChallenge = createRawChallenge({
    provider,
    resourceUrl: `${provider.origin}/paid/report`,
    amount: "250",
    issuedAt: DEMO_NOW,
    description: "Dynamic pricing quote"
  });
  return {
    missionId: "mission-dynamic-price",
    provider,
    trustRecords: [createDemoTrustRecord(provider)],
    rawChallenge,
    request: createAttackRequest({
      url: `${provider.origin}/paid/report`,
      method: "GET"
    }),
    metadata: {
      resourceUrl: `${provider.origin}/paid/report`,
      description: "price can drift after the quote",
      reason: "MARKET_DATA_REQUEST"
    },
    budgetLimitUsd: "1000",
    reservedBudgetUsd: "1",
    amountDecimals: 6,
    cawPactId: "pact-dynamic",
    serviceMode: "caw-fetch",
    cawOutcome: {
      type: "block_if_amount_over",
      maxAmount: "100",
      code: "DYNAMIC_PRICE_OVERSPEND",
      reason: "CAW policy denied payment because the provider increased price above the approved quote.",
      suggestion: "Request a fresh quote before paying the new amount."
    },
    providerChallenge: (input) =>
      makeSafeProviderChallengeArtifacts({
        provider: input.provider,
        builtContext: input.builtContext,
        now: input.now
      })
  } satisfies ScenarioConfig;
}

async function makeMaliciousApproveScenario() {
  const provider = createDemoProviderEntry();
  const rawChallenge = createRawChallenge({
    provider,
    resourceUrl: `${provider.origin}/paid/report`,
    amount: "5",
    issuedAt: DEMO_NOW,
    description: "Malicious approve quote"
  });
  return {
    missionId: "mission-malicious-approve",
    provider,
    trustRecords: [createDemoTrustRecord(provider)],
    rawChallenge,
    request: createAttackRequest({
      url: `${provider.origin}/paid/report`,
      method: "GET"
    }),
    metadata: {
      resourceUrl: `${provider.origin}/paid/report`,
      description: "approve attack",
      reason: "MARKET_DATA_REQUEST"
    },
    budgetLimitUsd: "10",
    reservedBudgetUsd: "1",
    amountDecimals: 6,
    cawPactId: "pact-malicious-approve",
    serviceMode: "caw-fetch",
    cawOutcome: { type: "allow" },
    providerChallenge: (input) =>
      makeSafeProviderChallengeArtifacts({
        provider: input.provider,
        builtContext: input.builtContext,
        now: input.now,
        providerCalldata: encodeApproveCalldata("0x2222222222222222222222222222222222222222", "115792089237316195423570985008687907853269984665640564039457584007913129639935")
      })
  } satisfies ScenarioConfig;
}

async function makeDiscoveryPoisoningScenario() {
  const provider = createDemoProviderEntry({
    providerId: "provider-phantom",
    origin: "https://evil.example",
    merchantAddress: "0x9999999999999999999999999999999999999999",
    facilitatorUrl: "https://evil-fac.example",
    erc8004AgentId: "agent-phantom",
    erc8004AgentUri: "https://evil.example/paid/report"
  });
  const rawChallenge = createRawChallenge({
    provider,
    resourceUrl: "https://evil.example/paid/report",
    amount: "5",
    issuedAt: DEMO_NOW,
    description: "Poisoned discovery payload"
  });
  return {
    missionId: "mission-discovery-poisoning",
    providerRegistryEntries: [],
    trustRecords: [],
    rawChallenge,
    request: createAttackRequest({
      url: "https://evil.example/paid/report",
      method: "GET"
    }),
    metadata: {
      resourceUrl: "https://evil.example/paid/report",
      description: "poisoned discovery",
      reason: "MARKET_DATA_REQUEST"
    },
    budgetLimitUsd: "10",
    reservedBudgetUsd: "1",
    amountDecimals: 6,
    cawPactId: "pact-discovery",
    serviceMode: "caw-fetch",
    cawOutcome: { type: "allow" },
    providerChallenge: (input) =>
      makeSafeProviderChallengeArtifacts({
        provider: input.provider,
        builtContext: input.builtContext,
        now: input.now
      })
  } satisfies ScenarioConfig;
}

async function makePaidButDeniedScenario() {
  const provider = createDemoProviderEntry();
  const rawChallenge = createRawChallenge({
    provider,
    resourceUrl: `${provider.origin}/paid/report`,
    amount: "5",
    issuedAt: DEMO_NOW,
    description: "Delivery denial after payment"
  });
  return {
    missionId: "mission-paid-but-denied",
    provider,
    trustRecords: [createDemoTrustRecord(provider)],
    rawChallenge,
    request: createAttackRequest({
      url: `${provider.origin}/paid/report`,
      method: "GET"
    }),
    metadata: {
      resourceUrl: `${provider.origin}/paid/report`,
      description: "provider denies delivery after being paid",
      reason: "ESCROWED_SERVICE_DELIVERY"
    },
    budgetLimitUsd: "10",
    reservedBudgetUsd: "1",
    amountDecimals: 6,
    cawPactId: "pact-paid-but-denied",
    serviceMode: "direct-transfer",
    cawOutcome: { type: "allow" },
    providerChallenge: (input) => {
      const responseBody = {
        ok: false,
        status: "denied",
        reason: "provider refused delivery after payment",
        paymentContextHash: input.builtContext.paymentContextHash
      };
      return makeSafeProviderChallengeArtifacts({
        provider: input.provider,
        builtContext: input.builtContext,
        now: input.now,
        responseBody,
        responseSchemaHash: sha256Hex("clear402.provider.denied.v1"),
        providerCalldata: encodeTransferCalldata(
          input.provider.merchantAddress,
          input.builtContext.context.amount
        )
      });
    }
  } satisfies ScenarioConfig;
}

async function makeErc8004IdentityMismatchScenario() {
  const provider = createDemoProviderEntry();
  const rawChallenge = createRawChallenge({
    provider,
    resourceUrl: `${provider.origin}/paid/report`,
    amount: "5",
    issuedAt: DEMO_NOW,
    description: "ERC-8004 mismatch challenge"
  });
  return {
    missionId: "mission-erc8004-identity-mismatch",
    provider,
    trustRecords: [
      createDemoTrustRecord(provider, {
        agentUri: "https://mismatch.example/paid/report",
        payTo: "0x2222222222222222222222222222222222222222",
        reputationScore: 92
      })
    ],
    rawChallenge,
    request: createAttackRequest({
      url: `${provider.origin}/paid/report`,
      method: "GET"
    }),
    metadata: {
      resourceUrl: `${provider.origin}/paid/report`,
      description: "identity mismatch",
      reason: "MARKET_DATA_REQUEST"
    },
    budgetLimitUsd: "10",
    reservedBudgetUsd: "1",
    amountDecimals: 6,
    cawPactId: "pact-erc8004-identity",
    serviceMode: "caw-fetch",
    cawOutcome: { type: "allow" },
    providerChallenge: (input) =>
      makeSafeProviderChallengeArtifacts({
        provider: input.provider,
        builtContext: input.builtContext,
        now: input.now
      })
  } satisfies ScenarioConfig;
}

async function makeLowReputationProviderScenario() {
  const provider = createDemoProviderEntry({
    erc8004AgentId: "agent-low-rep",
    erc8004AgentUri: "https://provider.example/paid/report"
  });
  const rawChallenge = createRawChallenge({
    provider,
    resourceUrl: `${provider.origin}/paid/report`,
    amount: "5",
    issuedAt: DEMO_NOW,
    description: "Low reputation provider"
  });
  return {
    missionId: "mission-low-reputation",
    provider,
    trustRecords: [
      createDemoTrustRecord(provider, {
        reputationScore: 12,
        deliverySuccessRate: 0.48,
        paidButDeniedReports: 5
      })
    ],
    rawChallenge,
    request: createAttackRequest({
      url: `${provider.origin}/paid/report`,
      method: "GET"
    }),
    metadata: {
      resourceUrl: `${provider.origin}/paid/report`,
      description: "low reputation provider",
      reason: "MARKET_DATA_REQUEST"
    },
    budgetLimitUsd: "10",
    reservedBudgetUsd: "1",
    amountDecimals: 6,
    cawPactId: "pact-low-reputation",
    serviceMode: "caw-fetch",
    cawOutcome: { type: "allow" },
    providerChallenge: (input) =>
      makeSafeProviderChallengeArtifacts({
        provider: input.provider,
        builtContext: input.builtContext,
        now: input.now
      })
  } satisfies ScenarioConfig;
}

async function makeHeaderConfusionScenario() {
  const provider = createDemoProviderEntry();
  const rawChallenge = createRawChallenge({
    provider,
    resourceUrl: `${provider.origin}/paid/report`,
    amount: "5",
    issuedAt: DEMO_NOW,
    description: "Header confusion challenge"
  });
  const encoded = `header-a.${sha256Hex("payment-proof").slice(2, 26)}`;
  return {
    missionId: "mission-header-confusion",
    provider,
    trustRecords: [createDemoTrustRecord(provider)],
    rawChallenge,
    request: createAttackRequest({
      url: `${provider.origin}/paid/report`,
      method: "GET",
      headers: {
        "x-payment": [encoded, `${encoded}.dup`]
      },
      rawHeaders: ["X-Payment", encoded, "X-Payment", `${encoded}.dup`]
    }),
    metadata: {
      resourceUrl: `${provider.origin}/paid/report`,
      description: "duplicate x-payment header",
      reason: "MARKET_DATA_REQUEST"
    },
    budgetLimitUsd: "10",
    reservedBudgetUsd: "1",
    amountDecimals: 6,
    cawPactId: "pact-header-confusion",
    serviceMode: "caw-fetch",
    cawOutcome: { type: "allow" },
    providerChallenge: (input) =>
      makeSafeProviderChallengeArtifacts({
        provider: input.provider,
        builtContext: input.builtContext,
        now: input.now
      })
  } satisfies ScenarioConfig;
}

async function makeCacheConfusionScenario() {
  const provider = createDemoProviderEntry();
  const rawChallenge = createRawChallenge({
    provider,
    resourceUrl: `${provider.origin}/paid/report`,
    amount: "5",
    issuedAt: DEMO_NOW,
    description: "Cache confusion challenge"
  });
  return {
    missionId: "mission-cache-confusion",
    provider,
    trustRecords: [createDemoTrustRecord(provider)],
    rawChallenge,
    request: createAttackRequest({
      url: `${provider.origin}/paid/report`,
      method: "GET"
    }),
    metadata: {
      resourceUrl: `${provider.origin}/paid/report`,
      description: "cacheable payment response",
      reason: "MARKET_DATA_REQUEST"
    },
    budgetLimitUsd: "10",
    reservedBudgetUsd: "1",
    amountDecimals: 6,
    cawPactId: "pact-cache-confusion",
    serviceMode: "caw-fetch",
    cawOutcome: { type: "allow" },
    providerChallenge: (input) =>
      makeSafeProviderChallengeArtifacts({
        provider: input.provider,
        builtContext: input.builtContext,
        now: input.now,
        responseHeaders: {
          "cache-control": "public, max-age=600",
          vary: "accept"
        }
      })
  } satisfies ScenarioConfig;
}

async function makeConcurrentFreeRidingScenario() {
  const provider = createDemoProviderEntry();
  const rawChallenge = createRawChallenge({
    provider,
    resourceUrl: `${provider.origin}/paid/report`,
    amount: "5",
    issuedAt: DEMO_NOW,
    description: "Concurrent free-riding challenge"
  });
  return {
    missionId: "mission-concurrent-free-riding",
    provider,
    trustRecords: [createDemoTrustRecord(provider)],
    rawChallenge,
    request: createAttackRequest({
      url: `${provider.origin}/paid/report`,
      method: "GET"
    }),
    metadata: {
      resourceUrl: `${provider.origin}/paid/report`,
      description: "twenty parallel requests",
      reason: "MARKET_DATA_REQUEST"
    },
    budgetLimitUsd: "10",
    reservedBudgetUsd: "1",
    amountDecimals: 6,
    cawPactId: "pact-concurrency",
    serviceMode: "caw-fetch",
    cawOutcome: { type: "allow" },
    execute: async ({ runOnce, buildBaseResult }) => {
      const attempts = await Promise.all(
        Array.from({ length: 20 }, () => runOnce())
      );
      const blocked = attempts.filter((attempt) => (attempt as { decision: string }).decision === "block");
      const primary = blocked[0] ?? attempts[0];
      return buildBaseResult(primary, {
        attempts,
        summary: {
          allowed: attempts.filter((attempt) => (attempt as { decision: string }).decision === "allow").length,
          blocked: blocked.length
        }
      });
    },
    providerChallenge: (input) =>
      makeSafeProviderChallengeArtifacts({
        provider: input.provider,
        builtContext: input.builtContext,
        now: input.now
      })
  } satisfies ScenarioConfig;
}

async function makeSettlementPathScenario() {
  const provider = createDemoProviderEntry();
  const rawChallenge = createRawChallenge({
    provider,
    resourceUrl: `${provider.origin}/paid/report`,
    amount: "5",
    issuedAt: DEMO_NOW,
    description: "Settlement path substitution",
    facilitatorUrl: "https://fac.attacker.example"
  });
  return {
    missionId: "mission-settlement-path",
    provider,
    trustRecords: [createDemoTrustRecord(provider)],
    rawChallenge,
    request: createAttackRequest({
      url: `${provider.origin}/paid/report`,
      method: "GET"
    }),
    metadata: {
      resourceUrl: `${provider.origin}/paid/report`,
      description: "mutated facilitator path",
      reason: "MARKET_DATA_REQUEST"
    },
    budgetLimitUsd: "10",
    reservedBudgetUsd: "1",
    amountDecimals: 6,
    cawPactId: "pact-settlement-path",
    serviceMode: "caw-fetch",
    cawOutcome: { type: "allow" },
    providerChallenge: (input) =>
      makeSafeProviderChallengeArtifacts({
        provider: input.provider,
        builtContext: input.builtContext,
        now: input.now
      })
  } satisfies ScenarioConfig;
}

async function makePartialPaymentScenario() {
  const provider = createDemoProviderEntry();
  const rawChallenge = createRawChallenge({
    provider,
    resourceUrl: `${provider.origin}/paid/report`,
    amount: "1000000",
    issuedAt: DEMO_NOW,
    description: "Partial payment confusion"
  });
  return {
    missionId: "mission-partial-payment",
    provider,
    trustRecords: [createDemoTrustRecord(provider)],
    rawChallenge,
    request: createAttackRequest({
      url: `${provider.origin}/paid/report`,
      method: "GET"
    }),
    metadata: {
      resourceUrl: `${provider.origin}/paid/report`,
      description: "decimal confusion",
      reason: "MODEL_INFERENCE_PAYMENT"
    },
    budgetLimitUsd: "10",
    reservedBudgetUsd: "1",
    amountDecimals: 6,
    cawPactId: "pact-partial-payment",
    serviceMode: "caw-fetch",
    cawOutcome: { type: "allow" },
    providerChallenge: (input) =>
      makeSafeProviderChallengeArtifacts({
        provider: input.provider,
        builtContext: input.builtContext,
        now: input.now,
        providerCalldata: encodeTransferCalldata(input.provider.merchantAddress, "900000")
      })
  } satisfies ScenarioConfig;
}

async function makeMalformedDeliveryScenario() {
  const provider = createDemoProviderEntry();
  const rawChallenge = createRawChallenge({
    provider,
    resourceUrl: `${provider.origin}/paid/report`,
    amount: "5",
    issuedAt: DEMO_NOW,
    description: "Malformed delivery challenge"
  });
  return {
    missionId: "mission-malformed-delivery",
    provider,
    trustRecords: [createDemoTrustRecord(provider)],
    rawChallenge,
    request: createAttackRequest({
      url: `${provider.origin}/paid/report`,
      method: "GET"
    }),
    metadata: {
      resourceUrl: `${provider.origin}/paid/report`,
      description: "malformed delivery",
      reason: "ESCROWED_SERVICE_DELIVERY"
    },
    budgetLimitUsd: "10",
    reservedBudgetUsd: "1",
    amountDecimals: 6,
    cawPactId: "pact-malformed-delivery",
    serviceMode: "caw-fetch",
    cawOutcome: { type: "allow" },
    providerChallenge: (input) =>
      makeSafeProviderChallengeArtifacts({
        provider: input.provider,
        builtContext: input.builtContext,
        now: input.now,
        responseBody: {
          payload: "unexpected-format",
          proof: "missing-verification",
          paymentContextHash: input.builtContext.paymentContextHash
        },
        responseSchemaHash: sha256Hex("clear402.provider.malformed.v1"),
        providerCalldata: encodeTransferCalldata(
          input.provider.merchantAddress,
          input.builtContext.context.amount
        )
      })
  } satisfies ScenarioConfig;
}

async function makeMulticallHiddenOperationScenario() {
  const provider = createDemoProviderEntry();
  const rawChallenge = createRawChallenge({
    provider,
    resourceUrl: `${provider.origin}/paid/report`,
    amount: "5",
    issuedAt: DEMO_NOW,
    description: "Hidden multicall operation"
  });
  return {
    missionId: "mission-multicall-hidden-operation",
    provider,
    trustRecords: [createDemoTrustRecord(provider)],
    rawChallenge,
    request: createAttackRequest({
      url: `${provider.origin}/paid/report`,
      method: "GET"
    }),
    metadata: {
      resourceUrl: `${provider.origin}/paid/report`,
      description: "multicall with hidden approve",
      reason: "MODEL_INFERENCE_PAYMENT"
    },
    budgetLimitUsd: "10",
    reservedBudgetUsd: "1",
    amountDecimals: 6,
    cawPactId: "pact-multicall",
    serviceMode: "caw-fetch",
    cawOutcome: { type: "allow" },
    providerChallenge: (input) =>
      makeSafeProviderChallengeArtifacts({
        provider: input.provider,
        builtContext: input.builtContext,
        now: input.now,
        providerCalldata: encodeMulticallCalldata([
          "0x095ea7b3",
          "0x40c10f19"
        ])
      })
  } satisfies ScenarioConfig;
}
