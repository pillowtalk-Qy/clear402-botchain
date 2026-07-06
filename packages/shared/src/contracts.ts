import { z } from "zod";

export const evidenceModeSchema = z.enum(["live", "fallback", "mock"]);

export const capabilityStatusSchema = z.enum([
  "verified",
  "needs_manual_step",
  "unavailable",
  "fallback_required"
]);

export const enforcementLevelSchema = z.enum([
  "CAW_ENFORCED",
  "CLEAR402_ENFORCED",
  "PROVIDER_ENFORCED",
  "EVIDENCE_ONLY"
]);

export const receiptStatusSchema = z.enum([
  "paid",
  "delivered",
  "failed",
  "refundable",
  "refunded",
  "paid_but_not_delivered"
]);

export const missionStatusSchema = z.enum([
  "draft",
  "active",
  "blocked",
  "complete",
  "failed"
]);

export const quoteStatusSchema = z.enum([
  "draft",
  "reserved",
  "accepted",
  "expired",
  "spent",
  "cancelled"
]);

export const reservationStatusSchema = z.enum([
  "reserved",
  "spent",
  "released",
  "disputed",
  "refunded"
]);

export const guardDecisionSchema = z.enum([
  "allow",
  "block",
  "require_approval",
  "fallback_required"
]);

export const serviceModeSchema = z.enum([
  "caw-fetch",
  "direct-transfer",
  "escrowed-delivery"
]);

export const paymentOperationSchema = z.enum([
  "transfer",
  "contract_call",
  "message_sign"
]);

export const problemJsonSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
  requestId: z.string().min(1).optional()
});

export const healthResponseSchema = z.object({
  service: z.string().min(1),
  status: z.literal("ok"),
  evidenceMode: evidenceModeSchema,
  timestamp: z.string().datetime(),
  version: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional()
});

export const missionCreateRequestSchema = z.object({
  userPrompt: z.string().trim().min(1),
  budgetUsd: z
    .string()
    .regex(/^\d+(?:\.\d{1,18})?$/, "budgetUsd must be a decimal string")
});

export const missionSchema = z.object({
  id: z.string().min(1),
  userPrompt: z.string().min(1),
  budgetUsd: z.string().min(1),
  status: missionStatusSchema,
  cawWalletUuid: z.string().min(1),
  cawWalletAddress: z.string().min(1).optional(),
  pactId: z.string().min(1).optional(),
  createdAt: z.number().int().nonnegative()
});

export const providerRegistryEntrySchema = z.object({
  providerId: z.string().min(1),
  origin: z.string().url(),
  merchantAddress: z.string().min(1),
  facilitatorUrl: z.string().url().optional(),
  chainId: z.string().min(1),
  tokenId: z.string().min(1),
  publicKey: z.string().min(1),
  allowedResources: z.array(z.string().min(1)),
  cawAllowlistStatus: z.enum(["allowed", "pending", "blocked"]),
  erc8004AgentId: z.string().min(1).optional(),
  erc8004AgentUri: z.string().url().optional(),
  reputationThreshold: z.number().min(0).max(100).optional(),
  validationTags: z.array(z.string().min(1)).optional()
});

export const x402QuoteSchema = z.object({
  quoteId: z.string().min(1),
  missionId: z.string().min(1),
  providerId: z.string().min(1),
  resourceUrl: z.string().url(),
  amountUsd: z.string().min(1),
  status: quoteStatusSchema,
  rawChallengeHash: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative()
});

export const paymentContextSchema = z.object({
  version: z.literal("clear402.payment.v1"),
  missionId: z.string().min(1),
  providerId: z.string().min(1),
  quoteId: z.string().min(1),
  operation: paymentOperationSchema.optional(),
  method: z.enum(["GET", "POST"]),
  origin: z.string().min(1),
  resourcePath: z.string().min(1),
  canonicalUrlHash: z.string().min(1),
  bodyHash: z.string().min(1),
  sanitizedResourceHash: z.string().min(1),
  merchantAddress: z.string().min(1),
  facilitatorUrlHash: z.string().min(1).optional(),
  chainId: z.string().min(1),
  tokenId: z.string().min(1),
  amount: z.string().min(1),
  amountDecimals: z.number().int().nonnegative(),
  nonce: z.string().min(1),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
  quoteTermsHash: z.string().min(1),
  piiPolicyHash: z.string().min(1),
  clearSignDigest: z.string().min(1).optional(),
  messageSignDigest: z.string().min(1).optional(),
  providerQuoteHash: z.string().min(1).optional(),
  providerQuoteSignature: z.string().min(1).optional(),
  policyBindingsHash: z.string().min(1).optional(),
  cawPactId: z.string().min(1),
  serviceMode: serviceModeSchema
});

export const signedProviderQuoteSchema = z.object({
  version: z.literal("clear402.provider-quote.v1"),
  quoteId: z.string().min(1),
  providerId: z.string().min(1),
  resource: z.string().url(),
  scheme: z.string().min(1),
  network: z.string().min(1),
  asset: z.string().min(1),
  amount: z.string().min(1),
  payTo: z.string().min(1),
  chainId: z.string().min(1),
  tokenId: z.string().min(1),
  expiresAt: z.number().int().nonnegative(),
  issuedAt: z.number().int().nonnegative(),
  quoteTermsHash: z.string().min(1),
  paymentContextHash: z.string().min(1).optional(),
  signer: z.string().min(1),
  signatureScheme: z.enum(["debug-hmac-sha256", "eip712", "jws"]),
  signature: z.string().min(1),
  evidenceMode: evidenceModeSchema
});

export const quoteReservationSchema = z.object({
  quoteId: z.string().min(1),
  paymentContextHash: z.string().min(1),
  nonce: z.string().min(1),
  status: reservationStatusSchema,
  reservedBudget: z.string().min(1),
  reservedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative()
});

export const guardEventSchema = z.object({
  id: z.string().min(1),
  missionId: z.string().min(1),
  layer: z.string().min(1),
  decision: guardDecisionSchema,
  reason: z.string().min(1).optional(),
  evidenceJson: z.record(z.string(), z.unknown()),
  createdAt: z.number().int().nonnegative()
});

export const cawCapabilityRecordSchema = z.object({
  capability: z.string().min(1),
  status: capabilityStatusSchema,
  evidenceMode: evidenceModeSchema,
  rawEvidenceRef: z.string().min(1).optional(),
  notes: z.string().min(1).optional()
});

export const cawPolicyDenialEvidenceSchema = z.object({
  code: z.string().min(1),
  reason: z.string().min(1),
  details: z.record(z.string(), z.unknown()),
  suggestion: z.string().min(1).optional(),
  attemptedOperation: z.enum(["transfer", "contract_call", "message_sign"]),
  paymentContextHash: z.string().min(1).optional(),
  cawRequestId: z.string().min(1).optional(),
  auditLogId: z.string().min(1).optional(),
  evidenceMode: evidenceModeSchema
});

export const serviceReceiptSchema = z.object({
  receiptId: z.string().min(1),
  paymentContextHash: z.string().min(1),
  cawRequestId: z.string().min(1).optional(),
  cawWalletAddress: z.string().min(1),
  pactId: z.string().min(1),
  providerAddress: z.string().min(1),
  resource: z.string().min(1).optional(),
  asset: z.string().min(1).optional(),
  serviceResultHash: z.string().min(1).optional(),
  cawEvidenceRef: z.string().min(1).optional(),
  fallbackEvidenceRef: z.string().min(1).optional(),
  facilitatorUrlHash: z.string().min(1).optional(),
  txHash: z.string().min(1).optional(),
  coboTransactionId: z.string().min(1).optional(),
  chainId: z.string().min(1),
  tokenId: z.string().min(1),
  amount: z.string().min(1),
  providerResponseHash: z.string().min(1),
  providerSignature: z.string().min(1),
  responseSchemaHash: z.string().min(1).optional(),
  deliveryTimestamp: z.number().int().nonnegative(),
  status: receiptStatusSchema,
  clearsigDigest: z.string().min(1).optional(),
  auditLogIds: z.array(z.string().min(1)),
  redactionSummaryHash: z.string().min(1).optional(),
  evidenceMode: evidenceModeSchema
});

export const erc8004TrustResultSchema = z.object({
  agentId: z.string().min(1),
  trustSource: z.enum(["live_erc8004", "demo_erc8004", "unavailable"]),
  registrationStatus: z.enum(["registered", "needs_registration", "unavailable"]),
  identityVerified: z.boolean(),
  endpointMatches: z.boolean(),
  payToMatches: z.boolean(),
  reputationScore: z.number().min(0).max(100),
  deliverySuccessRate: z.number().min(0).max(1).optional(),
  paidButDeniedReports: z.number().int().nonnegative().optional(),
  validationAttestations: z.array(
    z.object({
      tag: z.enum([
        "x402_endpoint_verified",
        "delivery_receipt_verified",
        "pii_safe_metadata",
        "schema_validated"
      ]),
      issuer: z.string().min(1),
      evidenceUri: z.string().url().optional()
    })
  ),
  decision: z.enum(["allow", "require_approval", "block", "fallback_required"]),
  reason: z.string().min(1).optional(),
  liveSource: z.object({
    source: z.enum(["registry_contract", "8004scan", "official_indexer"]),
    status: z.enum(["verified", "unavailable", "needs_registration"]),
    reference: z.string().min(1).optional(),
    checkedAt: z.number().int().nonnegative().optional()
  }).optional(),
  demoFallbackUsed: z.boolean(),
  evidenceMode: evidenceModeSchema
});

export const evidenceBundleSchema = z.object({
  missionId: z.string().min(1),
  live: z.array(z.unknown()),
  fallback: z.array(z.unknown()),
  mock: z.array(z.unknown()),
  redactions: z.array(z.string().min(1)),
  createdAt: z.number().int().nonnegative()
});

export const apiContracts = {
  problem: problemJsonSchema,
  health: healthResponseSchema,
  missionCreate: missionCreateRequestSchema,
  mission: missionSchema,
  providerRegistryEntry: providerRegistryEntrySchema,
  x402Quote: x402QuoteSchema,
  paymentContext: paymentContextSchema,
  signedProviderQuote: signedProviderQuoteSchema,
  quoteReservation: quoteReservationSchema,
  guardEvent: guardEventSchema,
  serviceReceipt: serviceReceiptSchema,
  erc8004TrustResult: erc8004TrustResultSchema,
  evidenceBundle: evidenceBundleSchema
} as const;

export type EvidenceMode = z.infer<typeof evidenceModeSchema>;
export type CapabilityStatus = z.infer<typeof capabilityStatusSchema>;
export type EnforcementLevel = z.infer<typeof enforcementLevelSchema>;
export type ReceiptStatus = z.infer<typeof receiptStatusSchema>;
export type MissionStatus = z.infer<typeof missionStatusSchema>;
export type QuoteStatus = z.infer<typeof quoteStatusSchema>;
export type ReservationStatus = z.infer<typeof reservationStatusSchema>;
export type GuardDecision = z.infer<typeof guardDecisionSchema>;
export type ServiceMode = z.infer<typeof serviceModeSchema>;
export type PaymentOperation = z.infer<typeof paymentOperationSchema>;
export type ProblemJSON = z.infer<typeof problemJsonSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type MissionCreateRequest = z.infer<typeof missionCreateRequestSchema>;
export type Mission = z.infer<typeof missionSchema>;
export type ProviderRegistryEntry = z.infer<typeof providerRegistryEntrySchema>;
export type X402Quote = z.infer<typeof x402QuoteSchema>;
export type PaymentContext = z.infer<typeof paymentContextSchema>;
export type SignedProviderQuote = z.infer<typeof signedProviderQuoteSchema>;
export type QuoteReservation = z.infer<typeof quoteReservationSchema>;
export type GuardEvent = z.infer<typeof guardEventSchema>;
export type CawCapabilityRecord = z.infer<typeof cawCapabilityRecordSchema>;
export type CawPolicyDenialEvidence = z.infer<
  typeof cawPolicyDenialEvidenceSchema
>;
export type ServiceReceipt = z.infer<typeof serviceReceiptSchema>;
export type ERC8004TrustResult = z.infer<typeof erc8004TrustResultSchema>;
export type EvidenceBundle = z.infer<typeof evidenceBundleSchema>;
