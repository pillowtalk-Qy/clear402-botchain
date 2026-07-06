import { createHash } from "node:crypto";

export const EVIDENCE_MODES = Object.freeze(["live", "fallback", "mock"]);

export const CAPABILITY_STATUSES = Object.freeze([
  "verified",
  "needs_manual_step",
  "unavailable",
  "fallback_required"
]);

export const RECEIPT_STATUSES = Object.freeze([
  "paid",
  "delivered",
  "failed",
  "refundable",
  "refunded",
  "paid_but_not_delivered"
]);

export function assertEvidenceMode(value) {
  if (!EVIDENCE_MODES.includes(value)) {
    throw new TypeError(`Unsupported evidenceMode: ${String(value)}`);
  }

  return value;
}

export function assertCapabilityStatus(value) {
  if (!CAPABILITY_STATUSES.includes(value)) {
    throw new TypeError(`Unsupported capability status: ${String(value)}`);
  }

  return value;
}

export function assertStringAmount(value, fieldName = "amount") {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }

  if (!/^[0-9]+$/.test(value)) {
    throw new TypeError(`${fieldName} must contain only decimal digits`);
  }

  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function hashObject(value) {
  return sha256Hex(canonicalJson(value));
}

export function toBase64Url(value) {
  const input = typeof value === "string" ? value : canonicalJson(value);
  return Buffer.from(input, "utf8").toString("base64url");
}

export function fromBase64Url(value) {
  return Buffer.from(String(value), "base64url").toString("utf8");
}

export function createProblem(code, message, details = undefined, requestId = undefined) {
  return {
    code,
    message,
    ...(details === undefined ? {} : { details }),
    ...(requestId === undefined ? {} : { requestId })
  };
}

export function normalizeX402Challenge(rawChallenge, options = {}) {
  const paymentRequirements = rawChallenge?.paymentRequirements ?? rawChallenge;
  const extra = paymentRequirements.extra ?? {};
  const providerId = options.providerId ?? extra.providerId;
  const evidenceMode = assertEvidenceMode(options.evidenceMode ?? extra.evidenceMode);
  const expiresAt = Number(options.expiresAt ?? paymentRequirements.expiresAt);

  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
    throw new TypeError("expiresAt must be a positive unix timestamp in milliseconds");
  }

  for (const field of ["scheme", "network", "asset", "payTo", "resource"]) {
    if (typeof paymentRequirements[field] !== "string" || paymentRequirements[field].length === 0) {
      throw new TypeError(`x402 challenge is missing ${field}`);
    }
  }

  if (typeof providerId !== "string" || providerId.length === 0) {
    throw new TypeError("x402 challenge is missing providerId");
  }

  return {
    scheme: paymentRequirements.scheme,
    network: paymentRequirements.network,
    asset: paymentRequirements.asset,
    amount: assertStringAmount(paymentRequirements.maxAmountRequired ?? paymentRequirements.amount),
    payTo: paymentRequirements.payTo,
    resource: paymentRequirements.resource,
    ...(paymentRequirements.facilitator?.url
      ? { facilitatorUrl: paymentRequirements.facilitator.url }
      : {}),
    ...(paymentRequirements.description ? { description: paymentRequirements.description } : {}),
    expiresAt,
    providerId,
    rawChallengeHash: hashObject(rawChallenge),
    evidenceMode
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, canonicalize(entryValue)])
    );
  }

  return value;
}
