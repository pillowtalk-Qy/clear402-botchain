import type {
  ERC8004TrustResult,
  ProviderRegistryEntry
} from "../../../../packages/shared/src/index.mjs";
import { compareDecimalStrings } from "../guard/amount.ts";

export interface ERC8004TrustRecord {
  agentId: string;
  agentUri: string;
  payTo: string;
  reputationScore: number;
  deliverySuccessRate?: number;
  paidButDeniedReports?: number;
  validationAttestations?: ERC8004TrustResult["validationAttestations"];
  identityVerified?: boolean;
  source?: "live_erc8004" | "demo_erc8004";
}

export interface ERC8004LiveSourceResult {
  source: "registry_contract" | "8004scan" | "official_indexer";
  status: "verified" | "unavailable" | "needs_registration";
  record?: ERC8004TrustRecord;
  reference?: string;
  checkedAt?: number;
  reason?: string;
}

export interface ERC8004TrustValidationInput {
  entry: ProviderRegistryEntry;
  records: ERC8004TrustRecord[];
  endpoint: string;
  payTo: string;
  amount: string;
  liveSource?: ERC8004LiveSourceResult;
  requireLiveForRegisteredAgent?: boolean;
  highAmountThreshold?: string;
  paidButDeniedThreshold?: number;
}

function sameAddress(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function endpointOriginAndPath(value: string): string {
  const url = new URL(value);
  return `${url.origin.toLowerCase()}${url.pathname}`;
}

function baseResult(
  input: ERC8004TrustValidationInput,
  record: ERC8004TrustRecord | undefined,
  source: ERC8004TrustResult["trustSource"],
  overrides: Partial<ERC8004TrustResult>
): ERC8004TrustResult {
  const liveSource =
    input.liveSource === undefined
      ? undefined
      : {
          source: input.liveSource.source,
          status: input.liveSource.status,
          ...(input.liveSource.reference !== undefined ? { reference: input.liveSource.reference } : {}),
          ...(input.liveSource.checkedAt !== undefined ? { checkedAt: input.liveSource.checkedAt } : {})
        };

  return {
    agentId: record?.agentId ?? input.entry.erc8004AgentId ?? "unregistered",
    trustSource: source,
    registrationStatus:
      source === "live_erc8004"
        ? "registered"
        : "needs_registration",
    identityVerified: record?.identityVerified ?? false,
    endpointMatches:
      record !== undefined &&
      endpointOriginAndPath(record.agentUri) === endpointOriginAndPath(input.endpoint),
    payToMatches: record !== undefined && sameAddress(record.payTo, input.payTo),
    reputationScore: record?.reputationScore ?? 0,
    deliverySuccessRate: record?.deliverySuccessRate,
    paidButDeniedReports: record?.paidButDeniedReports,
    validationAttestations: record?.validationAttestations ?? [],
    decision: "allow",
    ...(liveSource !== undefined ? { liveSource } : {}),
    demoFallbackUsed: source === "demo_erc8004",
    evidenceMode: source === "live_erc8004" ? "live" : source === "demo_erc8004" ? "mock" : "fallback",
    ...overrides
  };
}

function demoRecordForInput(input: ERC8004TrustValidationInput): ERC8004TrustRecord | undefined {
  if (input.entry.erc8004AgentId === undefined) {
    return undefined;
  }

  return input.records.find((candidate) => candidate.agentId === input.entry.erc8004AgentId);
}

function chooseRecord(input: ERC8004TrustValidationInput): {
  record: ERC8004TrustRecord | undefined;
  source: ERC8004TrustResult["trustSource"];
  liveUnavailableReason?: string;
} {
  if (input.liveSource?.status === "verified" && input.liveSource.record !== undefined) {
    return {
      record: {
        ...input.liveSource.record,
        source: "live_erc8004"
      },
      source: "live_erc8004"
    };
  }

  const demoRecord = demoRecordForInput(input);
  if (demoRecord !== undefined && input.requireLiveForRegisteredAgent !== true) {
    return {
      record: {
        ...demoRecord,
        source: "demo_erc8004"
      },
      source: "demo_erc8004",
      ...(input.liveSource?.reason !== undefined ? { liveUnavailableReason: input.liveSource.reason } : {})
    };
  }

  return {
    record: undefined,
    source: "unavailable",
    ...(input.liveSource?.reason !== undefined ? { liveUnavailableReason: input.liveSource.reason } : {})
  };
}

export function validateERC8004Trust(
  input: ERC8004TrustValidationInput
): ERC8004TrustResult {
  const { record, source, liveUnavailableReason } = chooseRecord(input);
  const highAmountThreshold = input.highAmountThreshold ?? "0.25";

  if (!record) {
    return baseResult(input, undefined, source, {
      registrationStatus: "needs_registration",
      decision: "fallback_required",
      reason: liveUnavailableReason ?? "Provider has no verified live ERC-8004 identity; registration is required before live trust can be claimed"
    });
  }

  const endpointMatches = endpointOriginAndPath(record.agentUri) === endpointOriginAndPath(input.endpoint);
  if (!endpointMatches) {
    return baseResult(input, record, source, {
      decision: "block",
      reason: "ERC-8004 endpoint does not match current provider endpoint"
    });
  }

  if (!sameAddress(record.payTo, input.payTo)) {
    return baseResult(input, record, source, {
      decision: "block",
      reason: "ERC-8004 payTo does not match x402 challenge payTo"
    });
  }

  const paidButDeniedThreshold = input.paidButDeniedThreshold ?? 2;
  if ((record.paidButDeniedReports ?? 0) > paidButDeniedThreshold) {
    return baseResult(input, record, source, {
      decision: "block",
      reason: "ERC-8004 paid-but-denied reports exceed threshold"
    });
  }

  const threshold = input.entry.reputationThreshold ?? 60;
  if (record.reputationScore < threshold) {
    return baseResult(input, record, source, {
      decision: record.reputationScore < Math.max(20, threshold / 2) ? "block" : "require_approval",
      reason: "ERC-8004 reputation score is below provider threshold"
    });
  }

  if (source !== "live_erc8004") {
    return baseResult(input, record, source, {
      identityVerified: false,
      decision: "require_approval",
      reason: "ERC-8004 trust is demo-backed; live ERC-8004 registration is required before live trust can be claimed"
    });
  }

  return baseResult(input, record, source, {
    identityVerified: record.identityVerified ?? true,
    decision: "allow"
  });
}
