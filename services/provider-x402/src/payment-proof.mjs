import { createHmac, timingSafeEqual } from "node:crypto";
import {
  canonicalJson,
  fromBase64Url,
  hashObject,
  toBase64Url
} from "../../../packages/shared/src/index.mjs";
import { DEBUG_PAYMENT_KEY, DEBUG_PAYMENT_KEY_ID, DEFAULT_PROVIDER_CONFIG } from "./config.mjs";

export function createDebugPaymentProof(challenge, {
  config = DEFAULT_PROVIDER_CONFIG,
  cawWalletAddress = "0x7A11E4dA1A6D1F8B9Fb3C3C7d4C6A0eF1Faa2402",
  pactId = "botchain-service-escrow",
  issuedAt = Date.now()
} = {}) {
  const normalized = challenge.normalized ?? challenge;
  const unsignedProof = {
    version: "clear402.debug-payment.v1",
    keyId: DEBUG_PAYMENT_KEY_ID,
    providerId: normalized.providerId,
    challengeHash: normalized.rawChallengeHash,
    paymentContextHash: hashObject({
      version: "clear402.payment.v1",
      providerId: normalized.providerId,
      resource: normalized.resource,
      amount: normalized.amount,
      challengeHash: normalized.rawChallengeHash
    }),
    cawWalletAddress,
    pactId,
    amount: normalized.amount,
    chainId: config.chainId,
    tokenId: config.tokenId,
    issuedAt,
    evidenceMode: "fallback",
    substitution: "local debug payment proof; BOT Chain settlement evidence is recorded separately"
  };

  return {
    ...unsignedProof,
    signature: signProof(unsignedProof)
  };
}

export function createDebugPaymentHeader(challenge, options = {}) {
  return toBase64Url(createDebugPaymentProof(challenge, options));
}

export function decodePaymentHeader(headerValue) {
  if (!headerValue) {
    return { ok: false, reason: "missing_payment_header" };
  }

  const encoded = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const value = String(encoded).trim();

  try {
    return { ok: true, proof: JSON.parse(fromBase64Url(value)) };
  } catch {
    try {
      return { ok: true, proof: JSON.parse(value) };
    } catch {
      return { ok: false, reason: "invalid_payment_header" };
    }
  }
}

export function verifyPaymentProof(headerValue, challenge, {
  config = DEFAULT_PROVIDER_CONFIG,
  now = Date.now()
} = {}) {
  const decoded = decodePaymentHeader(headerValue);

  if (!decoded.ok) {
    return decoded;
  }

  const proof = decoded.proof;
  const normalized = challenge.normalized ?? challenge;
  const unsignedProof = { ...proof };
  delete unsignedProof.signature;

  const failures = [];

  if (proof.version !== "clear402.debug-payment.v1") failures.push("unsupported_payment_version");
  if (proof.keyId !== DEBUG_PAYMENT_KEY_ID) failures.push("unsupported_key_id");
  if (proof.providerId !== config.providerId) failures.push("provider_mismatch");
  if (proof.challengeHash !== normalized.rawChallengeHash) failures.push("challenge_hash_mismatch");
  if (proof.amount !== normalized.amount) failures.push("amount_mismatch");
  if (proof.chainId !== config.chainId) failures.push("chain_mismatch");
  if (proof.tokenId !== config.tokenId) failures.push("token_mismatch");
  if (proof.evidenceMode !== "fallback") failures.push("debug_payment_must_be_fallback");
  if (!proof.signature || !constantTimeEqual(proof.signature, signProof(unsignedProof))) {
    failures.push("signature_mismatch");
  }
  if (Number.isSafeInteger(normalized.expiresAt) && now > normalized.expiresAt) {
    failures.push("challenge_expired");
  }

  if (failures.length > 0) {
    return { ok: false, reason: "payment_verification_failed", failures, proof };
  }

  return {
    ok: true,
    proof,
    evidenceMode: "fallback",
    settlementMode: "local_debug_payment_proof"
  };
}

function signProof(proof) {
  return createHmac("sha256", DEBUG_PAYMENT_KEY).update(canonicalJson(proof)).digest("base64url");
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
