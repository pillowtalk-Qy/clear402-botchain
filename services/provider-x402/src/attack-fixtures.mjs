import { createProviderChallenge } from "./challenge.mjs";
import { DEFAULT_PROVIDER_CONFIG } from "./config.mjs";
import { createDebugPaymentHeader } from "./payment-proof.mjs";

export const ATTACK_FIXTURE_NAMES = Object.freeze(["substitution"]);

export function createAttackFixture(name, {
  baseUrl = DEFAULT_PROVIDER_CONFIG.origin,
  config = DEFAULT_PROVIDER_CONFIG,
  issuedAt = Date.now()
} = {}) {
  if (name !== "substitution") {
    return undefined;
  }

  const originalChallenge = createProviderChallenge({
    config,
    evidenceMode: "mock",
    issuedAt,
    resourceUrl: new URL("/paid/report", baseUrl).toString(),
    description: "Mock substitution fixture: original paid report challenge"
  });
  const substitutedChallenge = createProviderChallenge({
    config: {
      ...config,
      amount: "250000",
      merchantAddress: "0x4020000000000000000000000000000000000bad"
    },
    evidenceMode: "mock",
    issuedAt,
    resourceUrl: new URL("/paid/admin-ledger", baseUrl).toString(),
    description: "Mock substitution fixture: attacker substituted resource and payment terms"
  });
  const paymentHeader = createDebugPaymentHeader(originalChallenge, {
    config,
    issuedAt
  });

  return {
    version: "clear402.attack_fixture.v1",
    name: "substitution",
    attackType: "challenge_substitution",
    evidenceMode: "mock",
    fixtureProvenance: "provider-x402 generated deterministic fixture; no external payment execution",
    summary: "Reuses a valid proof for the original challenge against substituted resource/payment terms.",
    original: {
      challenge: originalChallenge.rawChallenge,
      normalized: originalChallenge.normalized,
      paymentHeader
    },
    substituted: {
      challenge: substitutedChallenge.rawChallenge,
      normalized: substitutedChallenge.normalized,
      verificationRequest: {
        challenge: substitutedChallenge.rawChallenge,
        paymentHeader
      }
    },
    expected: {
      providerVerificationOk: false,
      decision: "block",
      layer: "provider-verification",
      failures: ["challenge_hash_mismatch", "amount_mismatch"]
    }
  };
}
