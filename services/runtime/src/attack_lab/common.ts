import { DatabaseSync } from "node:sqlite";

import type { ProviderRegistryEntry } from "../../../../packages/shared/src/index.mjs";
import type {
  ERC8004TrustRecord,
} from "../x402/erc8004_trust_adapter.ts";
import { createCawAdapter } from "../caw-adapter.mjs";
import { scanMetadata } from "../guard/metadata_firewall.ts";
import { buildPaymentContext } from "../guard/payment_context.ts";

export interface AttackLabRequestInput {
  method?: "GET" | "POST";
  url: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  boundHeaders?: string[];
  rawHeaders?: string[];
}

export interface AttackLabContextInput {
  missionId: string;
  providerId: string;
  quoteId: string;
  method: "GET" | "POST";
  challenge: {
    resource: string;
    amount: string;
    payTo: string;
    facilitatorUrl?: string;
    expiresAt: number;
    scheme?: string;
    network?: string;
    asset?: string;
    rawChallengeHash?: string;
    evidenceMode?: "live" | "fallback" | "mock";
  };
  metadata: {
    resourceUrl: string;
    description?: string;
    reason?: string;
  };
  merchantAddress: string;
  chainId: string;
  tokenId: string;
  amountDecimals: number;
  nonce: string;
  issuedAt: number;
  cawPactId: string;
  serviceMode: "caw-fetch" | "direct-transfer" | "escrowed-delivery";
  body?: unknown;
  clearSignDigest?: string;
}

export function createAttackLabDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  installAttackLabSchema(db);
  return db;
}

export function installAttackLabSchema(database: DatabaseSync): void {
  database.exec(`
    create table missions (
      id text primary key,
      user_prompt text,
      budget_usd text,
      status text,
      caw_wallet_uuid text,
      caw_wallet_address text,
      pact_id text,
      created_at integer,
      updated_at integer
    );
    create table provider_registry (
      provider_id text primary key,
      origin text,
      merchant_address text,
      facilitator_url text,
      chain_id text,
      token_id text,
      public_key text,
      allowed_resources text,
      caw_allowlist_status text,
      erc8004_agent_id text,
      erc8004_agent_uri text,
      reputation_threshold integer,
      validation_tags text,
      created_at integer,
      updated_at integer
    );
    create table x402_quotes (
      quote_id text primary key,
      mission_id text,
      provider_id text,
      resource_url text,
      amount_usd text,
      status text,
      raw_challenge_hash text,
      created_at integer,
      expires_at integer
    );
    create table payment_contexts (
      payment_context_hash text primary key,
      mission_id text,
      provider_id text,
      quote_id text,
      method text,
      origin text,
      resource_path text,
      canonical_url_hash text,
      body_hash text,
      sanitized_resource_hash text,
      merchant_address text,
      facilitator_url_hash text,
      chain_id text,
      token_id text,
      amount text,
      amount_decimals integer,
      nonce text unique,
      issued_at integer,
      expires_at integer,
      quote_terms_hash text,
      pii_policy_hash text,
      clear_sign_digest text,
      caw_pact_id text,
      service_mode text,
      raw_context_json text
    );
    create table quote_reservations (
      quote_id text unique,
      payment_context_hash text unique,
      nonce text unique,
      status text,
      reserved_budget text,
      reserved_at integer,
      expires_at integer
    );
    create table budget_ledger (
      id text primary key,
      mission_id text,
      entry_type text,
      amount_usd text,
      balance_after_usd text,
      status text,
      created_at integer
    );
    create table receipts (
      receipt_id text primary key,
      payment_context_hash text,
      caw_request_id text,
      tx_hash text,
      provider_response_hash text,
      provider_signature text,
      response_schema_hash text,
      status text,
      created_at integer
    );
    create table guard_events (
      id text primary key,
      mission_id text,
      layer text,
      decision text,
      reason text,
      evidence_json text,
      created_at integer
    );
    create table mission_timeline_events (
      timeline_id integer primary key autoincrement,
      event_id text not null unique,
      mission_id text not null,
      event_type text not null,
      created_at integer not null,
      payload_json text not null
    );
  `);
}

export function createDemoProviderEntry(overrides: Partial<ProviderRegistryEntry> = {}): ProviderRegistryEntry {
  return {
    providerId: "provider-1",
    origin: "https://provider.example",
    merchantAddress: "0x1111111111111111111111111111111111111111",
    facilitatorUrl: "https://fac.example",
    chainId: "84532",
    tokenId: "USDC",
    publicKey: "pk_provider_1",
    allowedResources: ["/paid/report"],
    cawAllowlistStatus: "allowed",
    erc8004AgentId: "agent-1",
    erc8004AgentUri: "https://provider.example/paid/report",
    reputationThreshold: 60,
    validationTags: [],
    ...overrides
  };
}

export function createDemoTrustRecord(
  provider: ProviderRegistryEntry,
  overrides: Partial<ERC8004TrustRecord> = {}
): ERC8004TrustRecord {
  return {
    agentId: provider.erc8004AgentId ?? "agent-1",
    agentUri: provider.erc8004AgentUri ?? `${provider.origin}/paid/report`,
    payTo: provider.merchantAddress,
    reputationScore: 95,
    deliverySuccessRate: 0.99,
    paidButDeniedReports: 0,
    identityVerified: true,
    validationAttestations: [],
    ...overrides
  };
}

export function createRawChallenge(input: {
  provider: ProviderRegistryEntry;
  resourceUrl: string;
  amount: string;
  issuedAt: number;
  description?: string;
  payTo?: string;
  facilitatorUrl?: string;
  expiresAt?: number;
  network?: string;
  asset?: string;
  scheme?: string;
}): unknown {
  const expiresAt = input.expiresAt ?? input.issuedAt + 60_000;

  return {
    accepts: [
      {
        scheme: input.scheme ?? "exact",
        network: input.network ?? "base-sepolia",
        asset: input.asset ?? "0x0000000000000000000000000000000000000001",
        amount: input.amount,
        payTo: input.payTo ?? input.provider.merchantAddress,
        resource: input.resourceUrl,
        description: input.description ?? "Clear402 paid report",
        expiresAt,
        ...(input.facilitatorUrl ?? input.provider.facilitatorUrl
          ? {
              facilitatorUrl: input.facilitatorUrl ?? input.provider.facilitatorUrl
            }
          : {})
      }
    ]
  };
}

export function createAttackRequest(input: AttackLabRequestInput): {
  method: "GET" | "POST";
  url: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  boundHeaders?: string[];
  rawHeaders?: string[];
} {
  return {
    method: input.method ?? "GET",
    url: input.url,
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.headers !== undefined ? { headers: input.headers } : {}),
    ...(input.boundHeaders !== undefined ? { boundHeaders: input.boundHeaders } : {}),
    ...(input.rawHeaders !== undefined ? { rawHeaders: input.rawHeaders } : {})
  };
}

export function buildAttackPaymentContext(input: AttackLabContextInput) {
  const challenge = {
    scheme: input.challenge.scheme ?? "exact",
    network: input.challenge.network ?? "base-sepolia",
    asset: input.challenge.asset ?? "0x0000000000000000000000000000000000000001",
    amount: input.challenge.amount,
    payTo: input.challenge.payTo,
    resource: input.challenge.resource,
    expiresAt: input.challenge.expiresAt,
    providerId: input.providerId,
    rawChallengeHash: input.challenge.rawChallengeHash ?? `0x${"0".repeat(64)}`,
    evidenceMode: input.challenge.evidenceMode ?? "mock",
    ...(input.challenge.facilitatorUrl !== undefined
      ? { facilitatorUrl: input.challenge.facilitatorUrl }
      : {})
  };

  const paymentContextInput: Parameters<typeof buildPaymentContext>[0] = {
    missionId: input.missionId,
    providerId: input.providerId,
    quoteId: input.quoteId,
    method: input.method,
    challenge,
    metadata: scanMetadata(input.metadata),
    merchantAddress: input.merchantAddress,
    chainId: input.chainId,
    tokenId: input.tokenId,
    amountDecimals: input.amountDecimals,
    nonce: input.nonce,
    issuedAt: input.issuedAt,
    cawPactId: input.cawPactId,
    serviceMode: input.serviceMode,
    ...(input.body !== undefined ? { body: input.body } : {})
  };

  if (input.clearSignDigest !== undefined) {
    paymentContextInput.clearSignDigest = input.clearSignDigest;
  }

  return buildPaymentContext(paymentContextInput);
}

export function encodeTransferCalldata(recipient: string, amount: string): string {
  const address = recipient.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const value = BigInt(amount).toString(16).padStart(64, "0");
  return `0xa9059cbb${address}${value}`;
}

export function encodeApproveCalldata(spender: string, amount: string): string {
  const address = spender.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const value = BigInt(amount).toString(16).padStart(64, "0");
  return `0x095ea7b3${address}${value}`;
}

export function encodeMulticallCalldata(nestedSelectors: string[]): string {
  return `0xac9650d8${nestedSelectors.map((selector) => selector.replace(/^0x/, "")).join("")}`;
}

export async function collectCawBoundaryEvidence(
  paymentContext: Record<string, unknown>,
  capabilityReport: unknown,
  now = Date.now()
) {
  const adapterPaymentContext = adaptPaymentContextForCawAdapter(paymentContext);
  const adapter = createCawAdapter({
    capabilities: capabilityReport as never,
    clock: () => now
  });
  const execution = await adapter.executePaymentIntent(adapterPaymentContext as never);

  return {
    capabilityReport: adapter.getCapabilities(),
    execution,
    adapterPaymentContext
  };
}

function adaptPaymentContextForCawAdapter(paymentContext: Record<string, unknown>) {
  const stripHexPrefix = (value: unknown) =>
    typeof value === "string" && value.startsWith("0x") ? value.slice(2) : value;

  return {
    ...paymentContext,
    canonicalUrlHash: stripHexPrefix(paymentContext.canonicalUrlHash),
    bodyHash: stripHexPrefix(paymentContext.bodyHash),
    sanitizedResourceHash: stripHexPrefix(paymentContext.sanitizedResourceHash),
    quoteTermsHash: stripHexPrefix(paymentContext.quoteTermsHash),
    piiPolicyHash: stripHexPrefix(paymentContext.piiPolicyHash)
  };
}
