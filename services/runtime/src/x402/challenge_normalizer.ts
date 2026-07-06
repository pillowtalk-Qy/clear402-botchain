import { hashObject } from "../guard/hash.ts";

export interface RawX402Accept {
  scheme?: unknown;
  network?: unknown;
  asset?: unknown;
  amount?: unknown;
  maxAmountRequired?: unknown;
  payTo?: unknown;
  resource?: unknown;
  facilitatorUrl?: unknown;
  facilitator?: unknown;
  description?: unknown;
  expiresAt?: unknown;
  maxTimeoutSeconds?: unknown;
}

export interface NormalizeChallengeInput {
  providerId: string;
  rawChallenge: unknown;
  now?: number;
  evidenceMode?: "live" | "fallback" | "mock";
}

export interface NormalizedX402Challenge {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  resource: string;
  facilitatorUrl?: string;
  description?: string;
  expiresAt: number;
  providerId: string;
  rawChallengeHash: string;
  evidenceMode: "live" | "fallback" | "mock";
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`x402 challenge missing ${field}`);
  }

  return value.trim();
}

function optionalStringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberField(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }

  throw new Error(`x402 challenge missing ${field}`);
}

export function normalizeX402Challenge(input: NormalizeChallengeInput): NormalizedX402Challenge {
  const raw =
    typeof input.rawChallenge === "object" && input.rawChallenge !== null
      ? (input.rawChallenge as Record<string, unknown>)
      : {};
  const accepts = Array.isArray(raw.accepts) ? raw.accepts : [raw];
  const first = accepts[0] as RawX402Accept | undefined;

  if (!first || typeof first !== "object") {
    throw new Error("x402 challenge has no acceptable payment requirement");
  }

  const amount = first.maxAmountRequired ?? first.amount;
  const facilitatorUrl = first.facilitatorUrl ?? first.facilitator;
  const now = input.now ?? Date.now();
  const expiresAt =
    first.expiresAt === undefined && first.maxTimeoutSeconds !== undefined
      ? now + numberField(first.maxTimeoutSeconds, "maxTimeoutSeconds") * 1000
      : numberField(first.expiresAt, "expiresAt");

  if (expiresAt <= now) {
    throw new Error("x402 challenge is expired");
  }

  const normalized: NormalizedX402Challenge = {
    scheme: stringField(first.scheme, "scheme").toLowerCase(),
    network: stringField(first.network, "network"),
    asset: stringField(first.asset, "asset"),
    amount: stringField(amount, "amount"),
    payTo: stringField(first.payTo, "payTo"),
    resource: stringField(first.resource, "resource"),
    expiresAt,
    providerId: input.providerId,
    rawChallengeHash: hashObject(input.rawChallenge),
    evidenceMode: input.evidenceMode ?? "live"
  };

  const normalizedFacilitatorUrl = optionalStringField(facilitatorUrl);
  if (normalizedFacilitatorUrl !== undefined) {
    normalized.facilitatorUrl = normalizedFacilitatorUrl;
  }

  const description = optionalStringField(first.description);
  if (description !== undefined) {
    normalized.description = description;
  }

  return normalized;
}
