import { randomUUID } from "node:crypto";
import {
  assertStringAmount,
  createProblem,
  hashObject
} from "../../../packages/shared/src/index.mjs";
import {
  CAW_CAPABILITIES,
  createCawCapabilityReport,
  probeCawCapabilities
} from "./caw-capabilities.mjs";

const REQUIRED_LIVE_CAPABILITIES = CAW_CAPABILITIES;

export function createCawAdapter({
  capabilities = probeCawCapabilities(),
  clock = () => Date.now(),
  requestIdFactory = () => `caw_${randomUUID()}`,
  liveExecutor
} = {}) {
  const report = Array.isArray(capabilities)
    ? createCawCapabilityReport(capabilities, { createdAt: clock() })
    : capabilities;

  return {
    capabilityReport: report,
    getCapabilities() {
      return structuredClone(report);
    },
    canExecuteLivePayments() {
      return canExecuteLivePayments(report.records);
    },
    async executePaymentIntent(paymentContext, options = {}) {
      return executePaymentIntent(paymentContext, {
        report,
        clock,
        requestIdFactory,
        liveExecutor,
        ...options
      });
    },
    async transferTokens(input, options = {}) {
      if (!input?.paymentContext) {
        const requestId = input?.requestId ?? requestIdFactory();
        return {
          evidenceMode: "fallback",
          requestId,
          decision: "fallback_required",
          denial: createCawPolicyDenialEvidence({
            code: "PAYMENT_CONTEXT_REQUIRED",
            reason: "CawAdapter.transferTokens requires the guarded PaymentContext.",
            details: {
              required: "paymentContext"
            },
            attemptedOperation: "transfer",
            cawRequestId: requestId,
            evidenceMode: "fallback"
          })
        };
      }

      const result = await executePaymentIntent(
        input.paymentContext,
        {
          report,
          clock,
          requestIdFactory: () => input.requestId,
          liveExecutor,
          attemptedOperation: "transfer",
          ...options
        }
      );

      if (result.ok) {
        return {
          evidenceMode: result.evidenceMode,
          requestId: result.cawRequestId,
          walletAddress: result.walletAddress,
          txHash: result.txHash,
          coboTransactionId: result.coboTransactionId,
          auditLogId: result.auditLogId,
          rawEvidenceRef: result.rawEvidenceRef,
          decision: "allow"
        };
      }

      return {
        evidenceMode: result.evidenceMode,
        requestId: result.denial?.cawRequestId ?? input.requestId,
        walletAddress: result.walletAddress,
        auditLogId: result.denial?.auditLogId,
        rawEvidenceRef: result.rawEvidenceRef,
        decision: result.decision,
        denial: result.denial
      };
    },
    async contractCall(input, options = {}) {
      if (!input?.paymentContext) {
        const requestId = input?.requestId ?? requestIdFactory();
        return {
          evidenceMode: "fallback",
          requestId,
          decision: "fallback_required",
          denial: createCawPolicyDenialEvidence({
            code: "PAYMENT_CONTEXT_REQUIRED",
            reason: "CawAdapter.contractCall requires the guarded PaymentContext.",
            details: {
              required: "paymentContext"
            },
            attemptedOperation: "contract_call",
            cawRequestId: requestId,
            evidenceMode: "fallback"
          })
        };
      }

      return adaptIntentResult(
        await executePaymentIntent(input.paymentContext, {
          report,
          clock,
          requestIdFactory: () => input.requestId,
          liveExecutor: enrichLiveExecutor(liveExecutor, {
            contractAddress: input.contractAddress,
            calldata: input.calldata,
            amount: input.amount
          }),
          attemptedOperation: "contract_call",
          ...options
        }),
        input.requestId
      );
    },
    async signMessage(input, options = {}) {
      if (!input?.paymentContext) {
        const requestId = input?.requestId ?? requestIdFactory();
        return {
          evidenceMode: "fallback",
          requestId,
          decision: "fallback_required",
          denial: createCawPolicyDenialEvidence({
            code: "PAYMENT_CONTEXT_REQUIRED",
            reason: "CawAdapter.signMessage requires the guarded PaymentContext.",
            details: {
              required: "paymentContext"
            },
            attemptedOperation: "message_sign",
            cawRequestId: requestId,
            evidenceMode: "fallback"
          })
        };
      }

      return adaptIntentResult(
        await executePaymentIntent(input.paymentContext, {
          report,
          clock,
          requestIdFactory: () => input.requestId,
          liveExecutor,
          attemptedOperation: "message_sign",
          ...options
        }),
        input.requestId
      );
    }
  };
}

function enrichLiveExecutor(liveExecutor, extra) {
  if (typeof liveExecutor !== "function") {
    return liveExecutor;
  }

  return (input) => liveExecutor({ ...input, ...extra });
}

function adaptIntentResult(result, fallbackRequestId) {
  if (result.ok) {
    return {
      evidenceMode: result.evidenceMode,
      requestId: result.cawRequestId,
      walletAddress: result.walletAddress,
      txHash: result.txHash,
      coboTransactionId: result.coboTransactionId,
      auditLogId: result.auditLogId,
      rawEvidenceRef: result.rawEvidenceRef,
      decision: "allow"
    };
  }

  return {
    evidenceMode: result.evidenceMode,
    requestId: result.denial?.cawRequestId ?? fallbackRequestId,
    walletAddress: result.walletAddress,
    auditLogId: result.denial?.auditLogId,
    rawEvidenceRef: result.rawEvidenceRef,
    decision: result.decision,
    denial: result.denial
  };
}

export async function executePaymentIntent(
  paymentContext,
  {
    report = createCawCapabilityReport(probeCawCapabilities()),
    attemptedOperation = "transfer",
    clock = () => Date.now(),
    requestIdFactory = () => `caw_${randomUUID()}`,
    requestId,
    liveExecutor
  } = {}
) {
  const validation = validatePaymentContext(paymentContext);

  if (!validation.ok) {
    return {
      ok: false,
      decision: "block",
      problem: createProblem("INVALID_PAYMENT_CONTEXT", "Payment context failed CAW adapter validation.", {
        failures: validation.failures
      })
    };
  }

  const paymentContextHash = hashObject(paymentContext);
  const now = clock();
  const cawRequestId = requestId ?? requestIdFactory();

  if (paymentContext.expiresAt <= now) {
    return createBlockedCawResult({
      code: "PAYMENT_CONTEXT_EXPIRED",
      reason: "Payment context expired before CAW execution.",
      suggestion: "Request a fresh quote and rebuild the PaymentContext.",
      attemptedOperation,
      paymentContext,
      paymentContextHash,
      report,
      now,
      requestId: cawRequestId,
      evidenceMode: "fallback"
    });
  }

  if (!canExecuteLivePayments(report.records)) {
    return createBlockedCawResult({
      code: "CAW_CAPABILITY_UNVERIFIED",
      reason: "CAW payment execution is not verified in this environment.",
      suggestion: "Complete CAW capability verification before attempting a live payment.",
      attemptedOperation,
      paymentContext,
      paymentContextHash,
      report,
      now,
      requestId: cawRequestId,
      evidenceMode: "fallback"
    });
  }

  if (typeof liveExecutor !== "function") {
    return createBlockedCawResult({
      code: "CAW_EXECUTOR_NOT_CONFIGURED",
      reason: "Verified CAW capabilities exist, but no live executor is configured behind CawAdapter.",
      suggestion: "Wire the official CAW SDK or CLI through CawAdapter only.",
      attemptedOperation,
      paymentContext,
      paymentContextHash,
      report,
      now,
      requestId: cawRequestId,
      evidenceMode: "fallback"
    });
  }

  const execution = await liveExecutor({
    paymentContext,
    paymentContextHash,
    attemptedOperation,
    requestId: cawRequestId
  });

  if (execution?.ok === false || execution?.denial || execution?.decision === "block" || execution?.decision === "require_approval") {
    return createExecutorBlockedCawResult({
      execution,
      paymentContext,
      paymentContextHash,
      attemptedOperation,
      now,
      requestId: cawRequestId
    });
  }

  if (!hasRequiredLiveEvidence(execution)) {
    return createBlockedCawResult({
      code: "CAW_LIVE_EVIDENCE_MISSING",
      reason: "CAW execution returned without wallet, transaction, audit, and raw evidence references.",
      suggestion: "Preserve CAW request id, wallet address, tx hash or Cobo transaction id, audit id, and raw evidence before calling this live.",
      attemptedOperation,
      paymentContext,
      paymentContextHash,
      report,
      now,
      requestId: cawRequestId,
      evidenceMode: "fallback"
    });
  }

  return {
    ok: true,
    decision: "allow",
    paymentContextHash,
    cawRequestId: execution.cawRequestId ?? execution.requestId ?? cawRequestId,
    auditLogId: execution.auditLogId,
    txHash: execution.txHash,
    coboTransactionId: execution.coboTransactionId ?? execution.cobo_transaction_id,
    walletAddress: execution.walletAddress,
    rawEvidenceRef: execution.rawEvidenceRef,
    evidenceMode: "live"
  };
}

export function createCawPolicyDenialEvidence({
  code,
  reason,
  details,
  suggestion,
  attemptedOperation,
  paymentContextHash,
  cawRequestId,
  auditLogId,
  evidenceMode
}) {
  return {
    code,
    reason,
    details,
    ...(suggestion ? { suggestion } : {}),
    attemptedOperation,
    ...(paymentContextHash ? { paymentContextHash } : {}),
    ...(cawRequestId ? { cawRequestId } : {}),
    ...(auditLogId ? { auditLogId } : {}),
    evidenceMode
  };
}

export function validatePaymentContext(paymentContext) {
  const failures = [];

  if (!paymentContext || typeof paymentContext !== "object") {
    return { ok: false, failures: ["paymentContext must be an object"] };
  }

  for (const field of [
    "missionId",
    "providerId",
    "quoteId",
    "origin",
    "resourcePath",
    "merchantAddress",
    "chainId",
    "tokenId",
    "nonce",
    "quoteTermsHash",
    "piiPolicyHash",
    "cawPactId"
  ]) {
    if (typeof paymentContext[field] !== "string" || paymentContext[field].length === 0) {
      failures.push(`${field} must be a non-empty string`);
    }
  }

  if (paymentContext.version !== "clear402.payment.v1") {
    failures.push("version must be clear402.payment.v1");
  }

  try {
    assertStringAmount(paymentContext.amount);
  } catch (error) {
    failures.push(error.message);
  }

  for (const field of ["issuedAt", "expiresAt", "amountDecimals"]) {
    if (!Number.isSafeInteger(paymentContext[field]) || paymentContext[field] < 0) {
      failures.push(`${field} must be a non-negative safe integer`);
    }
  }

  if (!["GET", "POST"].includes(paymentContext.method)) {
    failures.push("method must be GET or POST");
  }

  if (!["caw-fetch", "direct-transfer", "escrowed-delivery"].includes(paymentContext.serviceMode)) {
    failures.push("serviceMode must be caw-fetch, direct-transfer, or escrowed-delivery");
  }

  for (const hashField of [
    "canonicalUrlHash",
    "bodyHash",
    "sanitizedResourceHash",
    "quoteTermsHash",
    "piiPolicyHash",
    "messageSignDigest",
    "providerQuoteHash",
    "policyBindingsHash"
  ]) {
    if (
      paymentContext[hashField] !== undefined &&
      !/^(?:0x)?[a-f0-9]{64}$/.test(paymentContext[hashField] ?? "")
    ) {
      failures.push(`${hashField} must be a sha256 hex digest`);
    }
  }

  if (paymentContext.operation === "message_sign" && typeof paymentContext.messageSignDigest !== "string") {
    failures.push("messageSignDigest must be present for message_sign operations");
  }

  if (
    paymentContext.providerQuoteHash !== undefined &&
    typeof paymentContext.providerQuoteSignature !== "string"
  ) {
    failures.push("providerQuoteSignature must be present when providerQuoteHash is set");
  }

  return {
    ok: failures.length === 0,
    failures
  };
}

function createExecutorBlockedCawResult({
  execution,
  paymentContext,
  paymentContextHash,
  attemptedOperation,
  now,
  requestId
}) {
  const denial =
    execution.denial ??
    createCawPolicyDenialEvidence({
      code: execution.decision === "require_approval" ? "CAW_PENDING_APPROVAL" : "CAW_POLICY_DENIED",
      reason:
        execution.decision === "require_approval"
          ? "CAW operation requires owner approval."
          : "CAW denied payment execution.",
      details: {
        cawPactId: paymentContext.cawPactId,
        serviceMode: paymentContext.serviceMode
      },
      attemptedOperation,
      paymentContextHash,
      cawRequestId: execution.cawRequestId ?? execution.requestId ?? requestId,
      auditLogId: execution.auditLogId,
      evidenceMode: execution.evidenceMode ?? "live"
    });

  return {
    ok: false,
    decision: execution.decision === "require_approval" ? "require_approval" : "block",
    paymentContextHash,
    denial,
    guardEvent: {
      id: `guard_${hashObject({ code: denial.code, paymentContextHash, now }).slice(0, 16)}`,
      missionId: paymentContext.missionId,
      layer: "caw-adapter",
      decision: execution.decision === "require_approval" ? "require_approval" : "block",
      reason: denial.reason,
      evidenceJson: denial,
      createdAt: now
    },
    rawEvidenceRef: execution.rawEvidenceRef,
    walletAddress: execution.walletAddress,
    evidenceMode: execution.evidenceMode ?? denial.evidenceMode
  };
}

function hasRequiredLiveEvidence(execution) {
  return Boolean(
    execution?.evidenceMode === "live" &&
      execution?.rawEvidenceRef &&
      (execution?.cawRequestId || execution?.requestId) &&
      execution?.walletAddress &&
      (execution?.txHash || execution?.coboTransactionId || execution?.cobo_transaction_id) &&
      execution?.auditLogId
  );
}

function createBlockedCawResult({
  code,
  reason,
  suggestion,
  attemptedOperation,
  paymentContext,
  paymentContextHash,
  report,
  now,
  requestId,
  evidenceMode
}) {
  const denial = createCawPolicyDenialEvidence({
    code,
    reason,
    details: {
      capabilityStatuses: summarizeCapabilities(report.records),
      cawPactId: paymentContext.cawPactId,
      serviceMode: paymentContext.serviceMode
    },
    suggestion,
    attemptedOperation,
    paymentContextHash,
    cawRequestId: requestId,
    auditLogId: `local-denial:${paymentContextHash.slice(0, 16)}`,
    evidenceMode
  });

  return {
    ok: false,
    decision: code === "PAYMENT_CONTEXT_EXPIRED" ? "block" : "fallback_required",
    paymentContextHash,
    denial,
    guardEvent: {
      id: `guard_${hashObject({ code, paymentContextHash, now }).slice(0, 16)}`,
      missionId: paymentContext.missionId,
      layer: "caw-adapter",
      decision: code === "PAYMENT_CONTEXT_EXPIRED" ? "block" : "fallback_required",
      reason,
      evidenceJson: denial,
      createdAt: now
    },
    evidenceMode
  };
}

function canExecuteLivePayments(records) {
  return REQUIRED_LIVE_CAPABILITIES.every((capability) =>
    records.some((record) => record.capability === capability && record.status === "verified")
  );
}

function summarizeCapabilities(records) {
  const byCapability = Object.fromEntries(CAW_CAPABILITIES.map((capability) => [capability, "missing"]));

  for (const record of records) {
    byCapability[record.capability] = record.status;
  }

  return byCapability;
}
