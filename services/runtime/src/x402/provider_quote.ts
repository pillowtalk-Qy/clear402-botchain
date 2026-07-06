import type { SignedProviderQuote } from "../../../../packages/shared/src/index.mjs";
import { canonicalJson, hashObject, hmacSha256Hex, sha256Hex, timingSafeStringEqual } from "../guard/hash.ts";
import { canonicalizeUrl } from "../guard/payment_context.ts";
import type { NormalizedX402Challenge } from "./challenge_normalizer.ts";

export interface ProviderQuoteInput {
  quoteId: string;
  providerId: string;
  challenge: NormalizedX402Challenge;
  chainId: string;
  tokenId: string;
  signer: string;
  secret: string;
  issuedAt?: number;
  paymentContextHash?: string;
  evidenceMode?: SignedProviderQuote["evidenceMode"];
}

export interface ProviderQuoteVerificationInput {
  quote: SignedProviderQuote;
  challenge: NormalizedX402Challenge;
  providerPublicKey: string;
  now?: number;
  expectedPaymentContextHash?: string;
}

export interface ProviderQuoteVerificationResult {
  decision: "allow" | "block";
  quoteHash: string;
  checks: Record<string, boolean>;
  reason?: string;
}

export function quoteTermsHashForChallenge(challenge: NormalizedX402Challenge): string {
  const facilitatorUrlHash =
    challenge.facilitatorUrl === undefined
      ? undefined
      : sha256Hex(canonicalizeUrl(challenge.facilitatorUrl).canonicalUrl);

  return hashObject({
    scheme: challenge.scheme,
    network: challenge.network,
    asset: challenge.asset,
    amount: challenge.amount,
    payTo: challenge.payTo,
    facilitatorUrlHash,
    expiresAt: challenge.expiresAt
  });
}

export function createSignedProviderQuote(input: ProviderQuoteInput): SignedProviderQuote {
  const quoteWithoutSignature = {
    version: "clear402.provider-quote.v1" as const,
    quoteId: input.quoteId,
    providerId: input.providerId,
    resource: input.challenge.resource,
    scheme: input.challenge.scheme,
    network: input.challenge.network,
    asset: input.challenge.asset,
    amount: input.challenge.amount,
    payTo: input.challenge.payTo,
    chainId: input.chainId,
    tokenId: input.tokenId,
    expiresAt: input.challenge.expiresAt,
    issuedAt: input.issuedAt ?? Date.now(),
    quoteTermsHash: quoteTermsHashForChallenge(input.challenge),
    ...(input.paymentContextHash !== undefined
      ? { paymentContextHash: input.paymentContextHash }
      : {}),
    signer: input.signer,
    signatureScheme: "debug-hmac-sha256" as const,
    evidenceMode: input.evidenceMode ?? "fallback"
  };

  return {
    ...quoteWithoutSignature,
    signature: signProviderQuote(input.secret, quoteWithoutSignature)
  };
}

export function verifySignedProviderQuote(
  input: ProviderQuoteVerificationInput
): ProviderQuoteVerificationResult {
  const quoteHash = hashObject(input.quote);
  const unsigned = unsignedQuote(input.quote);
  const expectedSignature = signProviderQuote(input.providerPublicKey, unsigned);
  const now = input.now ?? Date.now();
  const checks = {
    version: input.quote.version === "clear402.provider-quote.v1",
    signatureScheme: input.quote.signatureScheme === "debug-hmac-sha256",
    signature: timingSafeStringEqual(input.quote.signature, expectedSignature),
    providerId: input.quote.providerId === input.challenge.providerId,
    resource: input.quote.resource === input.challenge.resource,
    scheme: input.quote.scheme === input.challenge.scheme,
    network: input.quote.network === input.challenge.network,
    asset: input.quote.asset === input.challenge.asset,
    amount: input.quote.amount === input.challenge.amount,
    payTo: sameAddress(input.quote.payTo, input.challenge.payTo),
    expiresAt: input.quote.expiresAt === input.challenge.expiresAt && input.quote.expiresAt > now,
    quoteTermsHash: input.quote.quoteTermsHash === quoteTermsHashForChallenge(input.challenge),
    paymentContextHash:
      input.expectedPaymentContextHash === undefined ||
      input.quote.paymentContextHash === input.expectedPaymentContextHash
  };
  const failed = Object.entries(checks).find(([, passed]) => !passed);

  if (failed) {
    return {
      decision: "block",
      quoteHash,
      checks,
      reason: `Signed ProviderQuote check failed: ${failed[0]}`
    };
  }

  return {
    decision: "allow",
    quoteHash,
    checks
  };
}

function signProviderQuote(secret: string, quoteWithoutSignature: Record<string, unknown>): string {
  return hmacSha256Hex(secret, canonicalJson(quoteWithoutSignature));
}

function unsignedQuote(quote: SignedProviderQuote): Record<string, unknown> {
  const { signature: _signature, ...unsigned } = quote;
  return unsigned;
}

function sameAddress(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
