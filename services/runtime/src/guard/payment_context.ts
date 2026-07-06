import type {
  MetadataFirewallResult,
  PaymentContext,
  PaymentOperation,
  ServiceMode,
  SignedProviderQuote
} from "../../../../packages/shared/src/index.mjs";
import type { NormalizedX402Challenge } from "../x402/challenge_normalizer.ts";
import { canonicalJson, hashObject, sha256Hex } from "./hash.ts";

export interface CanonicalRequestInput {
  method: "GET" | "POST";
  url: string;
  body?: unknown;
  headers?: Record<string, string | undefined>;
  boundHeaders?: string[];
}

export interface CanonicalRequest {
  method: "GET" | "POST";
  canonicalUrl: string;
  origin: string;
  resourcePath: string;
  canonicalUrlHash: string;
  bodyHash: string;
  boundHeadersHash: string;
}

export interface BuildPaymentContextInput {
  missionId: string;
  providerId: string;
  quoteId: string;
  method: "GET" | "POST";
  challenge: NormalizedX402Challenge;
  metadata: MetadataFirewallResult;
  merchantAddress: string;
  chainId: string;
  tokenId: string;
  amountDecimals: number;
  nonce: string;
  issuedAt?: number;
  cawPactId: string;
  serviceMode: ServiceMode;
  operation?: PaymentOperation;
  clearSignDigest?: string;
  messageToSign?: unknown;
  providerQuote?: SignedProviderQuote;
  policyBindings?: unknown;
  body?: unknown;
}

export interface BuiltPaymentContext {
  context: PaymentContext;
  paymentContextHash: string;
  cawRequestId: string;
  canonicalRequest: CanonicalRequest;
}

const unreservedPercent = /%[0-9A-Fa-f]{2}/g;

function decodeUnreserved(value: string): string {
  return value.replace(unreservedPercent, (entry) => {
    const character = String.fromCharCode(Number.parseInt(entry.slice(1), 16));
    return /^[A-Za-z0-9._~-]$/.test(character) ? character : entry.toUpperCase();
  });
}

function sortedQuery(searchParams: URLSearchParams): string {
  const entries = [...searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    const keyCompare = leftKey.localeCompare(rightKey);
    return keyCompare === 0 ? leftValue.localeCompare(rightValue) : keyCompare;
  });
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    params.append(key, value);
  }

  return params.toString();
}

export function canonicalizeUrl(value: string): {
  canonicalUrl: string;
  origin: string;
  resourcePath: string;
} {
  const url = new URL(value);
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";
  url.pathname = decodeUnreserved(url.pathname);

  const query = sortedQuery(url.searchParams);
  url.search = query.length > 0 ? `?${query}` : "";

  const canonicalUrl = url.toString();
  return {
    canonicalUrl,
    origin: url.origin.toLowerCase(),
    resourcePath: `${url.pathname}${url.search}`
  };
}

export function hashBody(body: unknown): string {
  if (body === undefined || body === null || body === "") {
    return sha256Hex("");
  }

  if (typeof body === "string" || body instanceof Uint8Array) {
    return sha256Hex(body);
  }

  return sha256Hex(canonicalJson(body));
}

export function canonicalizeHeaders(
  headers: Record<string, string | undefined> = {},
  boundHeaders: string[] = []
): string {
  const normalized = boundHeaders
    .map((header) => header.toLowerCase())
    .sort()
    .map((header) => [header, headers[header]?.trim() ?? ""] as const);

  return canonicalJson(Object.fromEntries(normalized));
}

export function canonicalizeRequest(input: CanonicalRequestInput): CanonicalRequest {
  const url = canonicalizeUrl(input.url);
  const boundHeaders = canonicalizeHeaders(input.headers, input.boundHeaders);

  return {
    method: input.method,
    canonicalUrl: url.canonicalUrl,
    origin: url.origin,
    resourcePath: url.resourcePath,
    canonicalUrlHash: sha256Hex(url.canonicalUrl),
    bodyHash: hashBody(input.body),
    boundHeadersHash: sha256Hex(boundHeaders)
  };
}

export function buildPaymentContext(input: BuildPaymentContextInput): BuiltPaymentContext {
  const canonicalRequest = canonicalizeRequest({
    method: input.method,
    // The resource binding must come from the verified x402 challenge. Metadata is evidence,
    // and may be redacted or blocked, but it cannot choose the paid resource.
    url: input.challenge.resource,
    ...(input.body !== undefined ? { body: input.body } : {})
  });
  const issuedAt = input.issuedAt ?? Date.now();
  const facilitatorUrlHash =
    input.challenge.facilitatorUrl === undefined
      ? undefined
      : sha256Hex(canonicalizeUrl(input.challenge.facilitatorUrl).canonicalUrl);
  const quoteTermsHash = hashObject({
    scheme: input.challenge.scheme,
    network: input.challenge.network,
    asset: input.challenge.asset,
    amount: input.challenge.amount,
    payTo: input.challenge.payTo,
    facilitatorUrlHash,
    expiresAt: input.challenge.expiresAt
  });

  const context: PaymentContext = {
    version: "clear402.payment.v1",
    missionId: input.missionId,
    providerId: input.providerId,
    quoteId: input.quoteId,
    method: input.method,
    origin: canonicalRequest.origin,
    resourcePath: canonicalRequest.resourcePath,
    canonicalUrlHash: canonicalRequest.canonicalUrlHash,
    bodyHash: canonicalRequest.bodyHash,
    sanitizedResourceHash: sha256Hex(input.metadata.sanitized.resourceUrl),
    merchantAddress: input.merchantAddress,
    chainId: input.chainId,
    tokenId: input.tokenId,
    amount: input.challenge.amount,
    amountDecimals: input.amountDecimals,
    nonce: input.nonce,
    issuedAt,
    expiresAt: input.challenge.expiresAt,
    quoteTermsHash,
    piiPolicyHash: input.metadata.piiPolicyHash,
    cawPactId: input.cawPactId,
    serviceMode: input.serviceMode
  };

  if (input.operation !== undefined) {
    context.operation = input.operation;
  }

  if (facilitatorUrlHash !== undefined) {
    context.facilitatorUrlHash = facilitatorUrlHash;
  }

  if (input.clearSignDigest !== undefined) {
    context.clearSignDigest = input.clearSignDigest;
  }

  if (input.messageToSign !== undefined) {
    context.messageSignDigest = hashObject(input.messageToSign);
  }

  if (input.providerQuote !== undefined) {
    context.providerQuoteHash = hashObject(input.providerQuote);
    context.providerQuoteSignature = input.providerQuote.signature;
  }

  if (input.policyBindings !== undefined) {
    context.policyBindingsHash = hashObject(input.policyBindings);
  }

  const paymentContextHash = hashObject(context);
  return {
    context,
    paymentContextHash,
    cawRequestId: `clear402:${paymentContextHash.slice(2, 34)}`,
    canonicalRequest
  };
}
