import type { EvidenceMode, ServiceReceipt } from "../../../../packages/shared/src/index.mjs";
import { hashObject, timingSafeStringEqual } from "../guard/hash.ts";
import { buildServiceResultHash, signReceiptForDemo } from "./receipt_verifier.ts";

export interface PaymentReceipt {
  version: "clear402.payment-receipt.v2";
  paymentReceiptHash: string;
  paymentContextHash: string;
  requestId: string;
  amount: string;
  asset: string;
  merchantAddress: string;
  cawEvidenceRef: string;
  fallbackEvidenceRef?: string;
  cawWalletAddress: string;
  pactId: string;
  chainId: string;
  tokenId: string;
  txHash?: string;
  coboTransactionId?: string;
  auditLogIds: string[];
  status: "paid" | "refundable" | "refunded" | "failed";
  evidenceMode: EvidenceMode;
}

export interface DeliveryReceipt {
  version: "clear402.delivery-receipt.v2";
  deliveryReceiptHash: string;
  receiptId: string;
  paymentContextHash: string;
  serviceResultHash: string;
  resource: string;
  providerAddress: string;
  paymentReceiptHash: string;
  providerResponseHash: string;
  providerSignature: string;
  responseSchemaHash?: string;
  deliveryTimestamp: number;
  status: "delivered" | "paid_but_not_delivered" | "failed";
  redactionSummaryHash?: string;
  evidenceMode: EvidenceMode;
}

export interface DualReceiptVerifierMetadata {
  version: "clear402.dual-receipt-verifier.v1";
  providerPublicKeyHash?: string;
  providerSignatureVerified: boolean;
  paymentReceiptHash: string;
  deliveryReceiptHash: string;
  serviceResultHash: string;
  replayKey: string;
  verifiedAt: number;
  evidenceMode: EvidenceMode;
}

export interface DualReceipt {
  version: "clear402.dual-receipt.v2";
  paymentReceipt: PaymentReceipt;
  deliveryReceipt: DeliveryReceipt;
  verifierMetadata: DualReceiptVerifierMetadata;
  canonicalHash: string;
  dualReceiptHash: string;
  finalStatus: "delivered" | "paid_but_not_delivered" | "refunded" | "failed";
  evidenceMode: EvidenceMode;
}

export interface DualReceiptVerificationResult {
  decision: "allow" | "block";
  finalStatus: DualReceipt["finalStatus"];
  checks: Record<string, boolean>;
  reason?: string;
  receiptId?: string;
  replay?: boolean;
  idempotent?: boolean;
}

export interface DualReceiptReplayRecord {
  paymentContextHash: string;
  deliveryReceiptHash: string;
  dualReceiptHash: string;
  createdAt: number;
}

export function createDualReceipt(input: {
  serviceReceipt: ServiceReceipt;
  providerPublicKey?: string;
  serviceResultHash?: string;
  resource: string;
  cawEvidenceRef: string;
  fallbackEvidenceRef?: string;
  paymentReceiptHash?: string;
  deliveryReceiptHash?: string;
  verifierMetadata?: Partial<DualReceiptVerifierMetadata>;
}): DualReceipt {
  const asset = input.serviceReceipt.asset ?? input.serviceReceipt.tokenId;
  const serviceResultHash =
    input.serviceResultHash ??
    buildServiceResultHash({
      receiptId: input.serviceReceipt.receiptId,
      providerResponseHash: input.serviceReceipt.providerResponseHash,
      ...(input.serviceReceipt.responseSchemaHash !== undefined
        ? { responseSchemaHash: input.serviceReceipt.responseSchemaHash }
        : {}),
      resource: input.resource,
      asset,
      deliveryTimestamp: input.serviceReceipt.deliveryTimestamp,
      status: input.serviceReceipt.status
    });
  const paymentReceiptBase = {
    version: "clear402.payment-receipt.v2" as const,
    paymentContextHash: input.serviceReceipt.paymentContextHash,
    requestId: input.serviceReceipt.cawRequestId ?? `missing:${input.serviceReceipt.receiptId}`,
    amount: input.serviceReceipt.amount,
    asset,
    merchantAddress: input.serviceReceipt.providerAddress,
    cawEvidenceRef: input.cawEvidenceRef,
    ...(input.fallbackEvidenceRef !== undefined ? { fallbackEvidenceRef: input.fallbackEvidenceRef } : {}),
    cawWalletAddress: input.serviceReceipt.cawWalletAddress,
    pactId: input.serviceReceipt.pactId,
    chainId: input.serviceReceipt.chainId,
    tokenId: input.serviceReceipt.tokenId,
    ...(input.serviceReceipt.txHash !== undefined ? { txHash: input.serviceReceipt.txHash } : {}),
    ...(input.serviceReceipt.coboTransactionId !== undefined
      ? { coboTransactionId: input.serviceReceipt.coboTransactionId }
      : {}),
    auditLogIds: [...input.serviceReceipt.auditLogIds],
    status: paymentStatusFor(input.serviceReceipt),
    evidenceMode: input.serviceReceipt.evidenceMode
  };
  const paymentReceiptHash = input.paymentReceiptHash ?? hashObject(paymentReceiptBase);
  const paymentReceipt: PaymentReceipt = {
    ...paymentReceiptBase,
    paymentReceiptHash
  };

  const deliveryReceiptBase = {
    version: "clear402.delivery-receipt.v2" as const,
    receiptId: input.serviceReceipt.receiptId,
    paymentContextHash: input.serviceReceipt.paymentContextHash,
    serviceResultHash,
    resource: input.resource,
    providerAddress: input.serviceReceipt.providerAddress,
    paymentReceiptHash,
    providerResponseHash: input.serviceReceipt.providerResponseHash,
    providerSignature: input.serviceReceipt.providerSignature,
    ...(input.serviceReceipt.responseSchemaHash !== undefined
      ? { responseSchemaHash: input.serviceReceipt.responseSchemaHash }
      : {}),
    deliveryTimestamp: input.serviceReceipt.deliveryTimestamp,
    status: deliveryStatusFor(input.serviceReceipt),
    ...(input.serviceReceipt.redactionSummaryHash !== undefined
      ? { redactionSummaryHash: input.serviceReceipt.redactionSummaryHash }
      : {}),
    evidenceMode: input.serviceReceipt.evidenceMode
  };
  const deliveryReceiptHash = input.deliveryReceiptHash ?? hashObject(deliveryReceiptBase);
  const deliveryReceipt: DeliveryReceipt = {
    ...deliveryReceiptBase,
    deliveryReceiptHash
  };
  const verifierMetadata = buildVerifierMetadata({
    serviceReceipt: input.serviceReceipt,
    resource: input.resource,
    cawEvidenceRef: input.cawEvidenceRef,
    ...(input.fallbackEvidenceRef !== undefined ? { fallbackEvidenceRef: input.fallbackEvidenceRef } : {}),
    paymentReceiptHash,
    deliveryReceiptHash,
    serviceResultHash,
    ...(input.providerPublicKey !== undefined ? { providerPublicKey: input.providerPublicKey } : {}),
    ...(input.verifierMetadata !== undefined ? { verifierMetadata: input.verifierMetadata } : {})
  });
  const finalStatus = finalStatusFor(paymentReceipt, deliveryReceipt);
  const unsigned = {
    version: "clear402.dual-receipt.v2" as const,
    paymentReceipt,
    deliveryReceipt,
    verifierMetadata,
    finalStatus,
    evidenceMode: input.serviceReceipt.evidenceMode
  };
  const canonicalHash = hashObject(unsigned);

  return {
    ...unsigned,
    canonicalHash,
    dualReceiptHash: canonicalHash
  };
}

export function verifyDualReceipt(input: {
  dualReceipt: DualReceipt;
  expectedPaymentContextHash: string;
  expectedRequestId: string;
  expectedPactId: string;
  expectedProviderAddress: string;
  expectedMerchantAddress: string;
  expectedProviderPublicKey: string;
  expectedAmount: string;
  expectedAsset: string;
  expectedChainId: string;
  expectedTokenId: string;
  expectedResource: string;
  expectedServiceResultHash?: string;
  expectedPaymentReceiptHash?: string;
  expectedDeliveryReceiptHash?: string;
  existingRecords?: DualReceiptReplayRecord[];
}): DualReceiptVerificationResult {
  const recomputedPaymentReceiptHash = hashObject(stripReceiptHash(input.dualReceipt.paymentReceipt));
  const recomputedDeliveryReceiptHash = hashObject(stripDeliveryHash(input.dualReceipt.deliveryReceipt));
  const replayKey = `${input.dualReceipt.paymentReceipt.paymentContextHash}::${recomputedDeliveryReceiptHash}`;
  const expectedServiceResultHash = buildServiceResultHash({
    receiptId: input.dualReceipt.deliveryReceipt.receiptId,
    providerResponseHash: input.dualReceipt.deliveryReceipt.providerResponseHash,
    ...(input.dualReceipt.deliveryReceipt.responseSchemaHash !== undefined
      ? { responseSchemaHash: input.dualReceipt.deliveryReceipt.responseSchemaHash }
      : {}),
    resource: input.dualReceipt.deliveryReceipt.resource,
    asset: input.dualReceipt.paymentReceipt.asset,
    deliveryTimestamp: input.dualReceipt.deliveryReceipt.deliveryTimestamp,
    status: input.dualReceipt.deliveryReceipt.status
  });
  const expectedProviderSignature = signReceiptForDemo(input.expectedProviderPublicKey, {
    paymentContextHash: input.dualReceipt.deliveryReceipt.paymentContextHash,
    providerResponseHash: input.dualReceipt.deliveryReceipt.providerResponseHash,
    resource: input.dualReceipt.deliveryReceipt.resource,
    asset: input.dualReceipt.paymentReceipt.asset,
    cawEvidenceRef: input.dualReceipt.paymentReceipt.cawEvidenceRef,
    ...(input.dualReceipt.paymentReceipt.fallbackEvidenceRef !== undefined
      ? { fallbackEvidenceRef: input.dualReceipt.paymentReceipt.fallbackEvidenceRef }
      : {}),
    serviceResultHash: input.dualReceipt.deliveryReceipt.serviceResultHash,
    ...(input.dualReceipt.deliveryReceipt.responseSchemaHash !== undefined
      ? { responseSchemaHash: input.dualReceipt.deliveryReceipt.responseSchemaHash }
      : {}),
    deliveryTimestamp: input.dualReceipt.deliveryReceipt.deliveryTimestamp,
    status: input.dualReceipt.deliveryReceipt.status
  });
  const providerSignatureVerified = timingSafeStringEqual(
    input.dualReceipt.deliveryReceipt.providerSignature,
    expectedProviderSignature
  );
  const recomputedDualReceiptHash = hashObject(stripDualHash(input.dualReceipt));
  const replayMatch = (input.existingRecords ?? []).find(
    (record) =>
      record.paymentContextHash === input.dualReceipt.paymentReceipt.paymentContextHash &&
      record.deliveryReceiptHash === recomputedDeliveryReceiptHash
  );
  const replay = replayMatch !== undefined;
  const replayConflict = replay && replayMatch.dualReceiptHash !== input.dualReceipt.dualReceiptHash;

  const checks = {
    version: input.dualReceipt.version === "clear402.dual-receipt.v2",
    paymentContextHash:
      input.dualReceipt.paymentReceipt.paymentContextHash === input.expectedPaymentContextHash &&
      input.dualReceipt.deliveryReceipt.paymentContextHash === input.expectedPaymentContextHash,
    requestId: input.dualReceipt.paymentReceipt.requestId === input.expectedRequestId,
    pactId: input.dualReceipt.paymentReceipt.pactId === input.expectedPactId,
    providerAddress:
      input.dualReceipt.deliveryReceipt.providerAddress.toLowerCase() ===
      input.expectedProviderAddress.toLowerCase(),
    merchantAddress:
      input.dualReceipt.paymentReceipt.merchantAddress.toLowerCase() ===
      input.expectedMerchantAddress.toLowerCase(),
    amount: input.dualReceipt.paymentReceipt.amount === input.expectedAmount,
    asset: input.dualReceipt.paymentReceipt.asset === input.expectedAsset,
    chainId: input.dualReceipt.paymentReceipt.chainId === input.expectedChainId,
    tokenId: input.dualReceipt.paymentReceipt.tokenId === input.expectedTokenId,
    resource: input.dualReceipt.deliveryReceipt.resource === input.expectedResource,
    paymentReceiptHash:
      input.dualReceipt.paymentReceipt.paymentReceiptHash === recomputedPaymentReceiptHash &&
      (input.expectedPaymentReceiptHash === undefined ||
        input.dualReceipt.paymentReceipt.paymentReceiptHash === input.expectedPaymentReceiptHash),
    deliveryReceiptHash:
      input.dualReceipt.deliveryReceipt.deliveryReceiptHash === recomputedDeliveryReceiptHash &&
      (input.expectedDeliveryReceiptHash === undefined ||
        input.dualReceipt.deliveryReceipt.deliveryReceiptHash === input.expectedDeliveryReceiptHash),
    serviceResultHash:
      input.dualReceipt.deliveryReceipt.serviceResultHash === expectedServiceResultHash &&
      (input.expectedServiceResultHash === undefined ||
        input.dualReceipt.deliveryReceipt.serviceResultHash === input.expectedServiceResultHash),
    providerSignature: providerSignatureVerified,
    verifierMetadataVersion: input.dualReceipt.verifierMetadata.version === "clear402.dual-receipt-verifier.v1",
    verifierMetadataPaymentReceiptHash:
      input.dualReceipt.verifierMetadata.paymentReceiptHash === input.dualReceipt.paymentReceipt.paymentReceiptHash,
    verifierMetadataDeliveryReceiptHash:
      input.dualReceipt.verifierMetadata.deliveryReceiptHash === input.dualReceipt.deliveryReceipt.deliveryReceiptHash,
    verifierMetadataServiceResultHash:
      input.dualReceipt.verifierMetadata.serviceResultHash === input.dualReceipt.deliveryReceipt.serviceResultHash,
    verifierMetadataReplayKey: input.dualReceipt.verifierMetadata.replayKey === replayKey,
    verifierMetadataVerifiedAt:
      input.dualReceipt.verifierMetadata.verifiedAt === input.dualReceipt.deliveryReceipt.deliveryTimestamp,
    verifierMetadataEvidenceMode:
      input.dualReceipt.verifierMetadata.evidenceMode === input.dualReceipt.evidenceMode,
    verifierMetadataProviderPublicKeyHash:
      input.dualReceipt.verifierMetadata.providerPublicKeyHash === hashObject(input.expectedProviderPublicKey),
    verifierMetadataProviderSignatureVerified:
      input.dualReceipt.verifierMetadata.providerSignatureVerified === providerSignatureVerified,
    finalStatus:
      input.dualReceipt.finalStatus ===
      finalStatusFor(input.dualReceipt.paymentReceipt, input.dualReceipt.deliveryReceipt),
    canonicalHash:
      input.dualReceipt.canonicalHash === recomputedDualReceiptHash &&
      input.dualReceipt.dualReceiptHash === recomputedDualReceiptHash,
    idempotent: !replay || replayMatch?.dualReceiptHash === input.dualReceipt.dualReceiptHash,
    replayFree: !replayConflict
  };
  const failed = Object.entries(checks).find(([, passed]) => !passed);

  if (failed) {
    return {
      decision: "block",
      finalStatus: input.dualReceipt.finalStatus,
      checks,
      reason: replayConflict
        ? "Dual receipt replay conflict detected"
        : `Dual receipt check failed: ${failed[0]}`,
      receiptId: input.dualReceipt.deliveryReceipt.receiptId,
      replay,
      idempotent: replay && !replayConflict
    };
  }

  return {
    decision: "allow",
    finalStatus: input.dualReceipt.finalStatus,
    checks,
    receiptId: input.dualReceipt.deliveryReceipt.receiptId,
    replay,
    idempotent: replay
  };
}

export function extractDualReceiptReplayKey(dualReceipt: DualReceipt): string {
  return `${dualReceipt.paymentReceipt.paymentContextHash}::${dualReceipt.deliveryReceipt.deliveryReceiptHash}`;
}

function buildVerifierMetadata(input: {
  serviceReceipt: ServiceReceipt;
  resource: string;
  cawEvidenceRef: string;
  fallbackEvidenceRef?: string;
  paymentReceiptHash: string;
  deliveryReceiptHash: string;
  serviceResultHash: string;
  providerPublicKey?: string;
  verifierMetadata?: Partial<DualReceiptVerifierMetadata>;
}): DualReceiptVerifierMetadata {
  const asset = input.serviceReceipt.asset ?? input.serviceReceipt.tokenId;
  const signatureInput = {
    paymentContextHash: input.serviceReceipt.paymentContextHash,
    providerResponseHash: input.serviceReceipt.providerResponseHash,
    resource: input.resource,
    asset,
    cawEvidenceRef: input.cawEvidenceRef,
    ...(input.fallbackEvidenceRef !== undefined ? { fallbackEvidenceRef: input.fallbackEvidenceRef } : {}),
    serviceResultHash: input.serviceResultHash,
    ...(input.serviceReceipt.responseSchemaHash !== undefined
      ? { responseSchemaHash: input.serviceReceipt.responseSchemaHash }
      : {}),
    deliveryTimestamp: input.serviceReceipt.deliveryTimestamp,
    status: input.serviceReceipt.status
  };
  const providerSignatureVerified =
    input.providerPublicKey !== undefined
      ? timingSafeStringEqual(
          input.serviceReceipt.providerSignature,
          signReceiptForDemo(input.providerPublicKey, signatureInput)
        )
      : input.verifierMetadata?.providerSignatureVerified ?? false;

  return {
    version: "clear402.dual-receipt-verifier.v1",
    ...(input.providerPublicKey !== undefined
      ? { providerPublicKeyHash: hashObject(input.providerPublicKey) }
      : input.verifierMetadata?.providerPublicKeyHash !== undefined
        ? { providerPublicKeyHash: input.verifierMetadata.providerPublicKeyHash }
        : {}),
    providerSignatureVerified,
    paymentReceiptHash: input.paymentReceiptHash,
    deliveryReceiptHash: input.deliveryReceiptHash,
    serviceResultHash: input.serviceResultHash,
    replayKey: `${input.serviceReceipt.paymentContextHash}::${input.deliveryReceiptHash}`,
    verifiedAt: input.serviceReceipt.deliveryTimestamp,
    evidenceMode: input.serviceReceipt.evidenceMode
  };
}

function stripReceiptHash(receipt: PaymentReceipt): Omit<PaymentReceipt, "paymentReceiptHash"> {
  const { paymentReceiptHash: _paymentReceiptHash, ...rest } = receipt;
  return rest;
}

function stripDeliveryHash(receipt: DeliveryReceipt): Omit<DeliveryReceipt, "deliveryReceiptHash"> {
  const { deliveryReceiptHash: _deliveryReceiptHash, ...rest } = receipt;
  return rest;
}

function stripDualHash(receipt: DualReceipt): Omit<DualReceipt, "dualReceiptHash" | "canonicalHash"> {
  const { dualReceiptHash: _dualReceiptHash, canonicalHash: _canonicalHash, ...rest } = receipt;
  return rest;
}

function paymentStatusFor(receipt: ServiceReceipt): PaymentReceipt["status"] {
  if (receipt.status === "refunded") {
    return "refunded";
  }
  if (receipt.status === "refundable" || receipt.status === "paid_but_not_delivered") {
    return "refundable";
  }
  if (receipt.status === "failed") {
    return "failed";
  }
  return "paid";
}

function deliveryStatusFor(receipt: ServiceReceipt): DeliveryReceipt["status"] {
  if (receipt.status === "delivered") {
    return "delivered";
  }
  if (receipt.status === "paid_but_not_delivered" || receipt.status === "refundable") {
    return "paid_but_not_delivered";
  }
  return "failed";
}

function finalStatusFor(
  paymentReceipt: PaymentReceipt,
  deliveryReceipt: DeliveryReceipt
): DualReceipt["finalStatus"] {
  if (paymentReceipt.status === "refunded") {
    return "refunded";
  }
  if (deliveryReceipt.status === "delivered" && paymentReceipt.status === "paid") {
    return "delivered";
  }
  if (paymentReceipt.status === "refundable" || deliveryReceipt.status === "paid_but_not_delivered") {
    return "paid_but_not_delivered";
  }
  return "failed";
}
