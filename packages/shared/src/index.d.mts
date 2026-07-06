export type {
  CapabilityStatus,
  CawCapabilityRecord,
  CawPolicyDenialEvidence,
  EvidenceBundle,
  EvidenceMode,
  ERC8004TrustResult,
  GuardDecision,
  GuardEvent,
  HealthResponse,
  Mission,
  MissionCreateRequest,
  MissionStatus,
  PaymentOperation,
  PaymentContext,
  ProblemJSON,
  ProviderRegistryEntry,
  QuoteReservation,
  QuoteStatus,
  ReceiptStatus,
  ReservationStatus,
  ServiceMode,
  ServiceReceipt,
  SignedProviderQuote,
  X402Quote
} from "./contracts.js";
export type {
  MetadataFirewallResult,
  X402ChallengeNormalized
} from "./domain.js";

export declare const EVIDENCE_MODES: readonly ["live", "fallback", "mock"];
export declare const CAPABILITY_STATUSES: readonly [
  "verified",
  "needs_manual_step",
  "unavailable",
  "fallback_required"
];
export declare const RECEIPT_STATUSES: readonly [
  "paid",
  "delivered",
  "failed",
  "refundable",
  "refunded",
  "paid_but_not_delivered"
];

export declare function assertEvidenceMode(value: unknown): EvidenceMode;
export declare function assertCapabilityStatus(value: unknown): CapabilityStatus;
export declare function assertStringAmount(value: unknown, fieldName?: string): string;
export declare function canonicalJson(value: unknown): string;
export declare function sha256Hex(value: string | Uint8Array): string;
export declare function hashObject(value: unknown): string;
export declare function toBase64Url(value: unknown): string;
export declare function fromBase64Url(value: unknown): string;
export declare function createProblem(
  code: string,
  message: string,
  details?: Record<string, unknown>,
  requestId?: string
): ProblemJSON;
export declare function normalizeX402Challenge(
  rawChallenge: unknown,
  options?: {
    providerId?: string;
    evidenceMode?: EvidenceMode;
    expiresAt?: number;
  }
): X402ChallengeNormalized;
