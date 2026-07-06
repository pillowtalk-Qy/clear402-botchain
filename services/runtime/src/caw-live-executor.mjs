import { createCawPolicyDenialEvidence } from "./caw-adapter.mjs";

const REQUIRED_ENV = Object.freeze([
  "CLEAR402_CAW_API_URL",
  "CLEAR402_CAW_API_KEY",
  "CLEAR402_CAW_WALLET_UUID",
  "CLEAR402_CAW_WALLET_ADDRESS",
  "CLEAR402_CAW_PACT_ID",
  "CLEAR402_CAW_CHAIN_ID",
  "CLEAR402_CAW_TOKEN_ID"
]);

const SUCCESS_STATUSES = new Set([900]);
const PENDING_APPROVAL_STATUSES = new Set([100]);
const FAILED_STATUSES = new Set([901, 902, 903]);
const LIVE_EVIDENCE_SETTLE_TIMEOUT_MS = 30_000;
const LIVE_EVIDENCE_SETTLE_POLL_MS = 1_500;

export function getCawLivePrerequisites(env = process.env) {
  return REQUIRED_ENV.filter((name) => typeof env[name] !== "string" || env[name].length === 0);
}

export function createCawLiveExecutor({
  env = process.env,
  sdkLoader = loadCawSdk,
  auditLimit = 20,
  evidenceSettleTimeoutMs = LIVE_EVIDENCE_SETTLE_TIMEOUT_MS,
  evidenceSettlePollMs = LIVE_EVIDENCE_SETTLE_POLL_MS,
  cache = new Map()
} = {}) {
  const missing = getCawLivePrerequisites(env);
  if (missing.length > 0) {
    return createPrerequisiteExecutor(missing);
  }

  return async function cawLiveExecutor({
    paymentContext,
    paymentContextHash,
    attemptedOperation = "transfer",
    requestId,
    contractAddress,
    calldata,
    amount
  }) {
    const envCheck = validatePaymentContextAgainstEnv(paymentContext, env);
    if (envCheck.length > 0) {
      return createBlockedExecution({
        code: "CAW_ENV_PAYMENT_CONTEXT_MISMATCH",
        reason: "PaymentContext does not match the configured CAW testnet pact boundary.",
        details: {
          mismatches: envCheck,
          chainId: paymentContext.chainId,
          tokenId: paymentContext.tokenId,
          cawPactId: paymentContext.cawPactId
        },
        attemptedOperation,
        paymentContextHash,
        cawRequestId: requestId,
        evidenceMode: "fallback"
      });
    }

    if (cache.has(requestId)) {
      return cache.get(requestId);
    }

    if (!["transfer", "contract_call"].includes(attemptedOperation)) {
      const unsupported = createBlockedExecution({
        code: "CAW_UNSUPPORTED_OPERATION",
        reason: `The configured CAW live executor only supports transfer and contract_call; ${attemptedOperation} requires a dedicated live CAW API path.`,
        details: {
          attemptedOperation,
          supportedOperations: ["transfer", "contract_call"]
        },
        suggestion: "Wire and verify the official CAW API for this operation before claiming live evidence.",
        attemptedOperation,
        paymentContextHash,
        cawRequestId: requestId,
        evidenceMode: "fallback",
        decision: "fallback_required"
      });
      cache.set(requestId, unsupported);
      return unsupported;
    }

    const sdk = await sdkLoader();
    const configuration = new sdk.Configuration({
      apiKey: env.CLEAR402_CAW_API_KEY,
      basePath: env.CLEAR402_CAW_API_URL
    });
    const transactionsApi = new sdk.TransactionsApi(configuration);
    const transactionRecordsApi = new sdk.TransactionRecordsApi(configuration);
    const auditApi = new sdk.AuditApi(configuration);

    let submitResult;
    try {
      const response =
        attemptedOperation === "contract_call"
          ? await submitContractCall({
              transactionsApi,
              env,
              paymentContext,
              paymentContextHash,
              requestId,
              contractAddress,
              calldata,
              amount
            })
          : await submitTransfer({
              transactionsApi,
              env,
              paymentContext,
              paymentContextHash,
              requestId
            });
      submitResult = response.data?.result;
    } catch (error) {
      const blocked = createDeniedExecution({
        error,
        attemptedOperation,
        paymentContextHash,
        cawRequestId: requestId
      });
      cache.set(requestId, blocked);
      return blocked;
    }

    if (isPendingApproval(submitResult)) {
      const result = createBlockedExecution({
        code: "CAW_PENDING_APPROVAL",
        reason: "CAW returned pending_approval; owner approval is required before Clear402 can treat this as paid.",
        details: {
          status: submitResult?.status,
          statusDisplay: submitResult?.status_display,
          pendingOperationId: submitResult?.pending_operation_id,
          approvalId: submitResult?.approval_id
        },
        attemptedOperation,
        paymentContextHash,
        cawRequestId: submitResult?.request_id ?? requestId,
        auditLogId: submitResult?.pending_operation_id,
        evidenceMode: "live",
        decision: "require_approval"
      });
      cache.set(requestId, result);
      return result;
    }

    const { record, auditLog } = await settleTransferEvidence({
      transactionRecordsApi,
      auditApi,
      walletUuid: env.CLEAR402_CAW_WALLET_UUID,
      apiKey: env.CLEAR402_CAW_API_KEY,
      requestId,
      limit: auditLimit,
      timeoutMs: evidenceSettleTimeoutMs,
      pollMs: evidenceSettlePollMs
    });

    const normalized = normalizeSuccessfulTransaction({
      submitResult,
      record,
      auditLog,
      requestId,
      paymentContext,
      paymentContextHash,
      attemptedOperation
    });
    cache.set(requestId, normalized);
    return normalized;
  };
}

async function submitTransfer({
  transactionsApi,
  env,
  paymentContext,
  paymentContextHash,
  requestId
}) {
  const transferBody = {
    pact_id: paymentContext.cawPactId,
    chain_id: paymentContext.chainId,
    token_id: paymentContext.tokenId,
    dst_addr: paymentContext.merchantAddress,
    amount: toCawDecimalAmount(paymentContext.amount, paymentContext.amountDecimals),
    request_id: requestId,
    description: `clear402:${paymentContextHash}`
  };
  if (typeof env.CLEAR402_CAW_WALLET_ADDRESS === "string" && env.CLEAR402_CAW_WALLET_ADDRESS.length > 0) {
    transferBody.src_addr = env.CLEAR402_CAW_WALLET_ADDRESS;
  }

  return transactionsApi.transferTokens(
    env.CLEAR402_CAW_WALLET_UUID,
    transferBody,
    env.CLEAR402_CAW_API_KEY
  );
}

async function submitContractCall({
  transactionsApi,
  env,
  paymentContext,
  paymentContextHash,
  requestId,
  contractAddress,
  calldata,
  amount
}) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(contractAddress ?? ""))) {
    return createLocalRejectedResponse({
      status: 400,
      code: "CONTRACT_ADDRESS_REQUIRED",
      reason: "CAW contract_call requires a 0x-prefixed contract address.",
      requestId
    });
  }
  if (!/^0x[0-9a-fA-F]+$/.test(String(calldata ?? ""))) {
    return createLocalRejectedResponse({
      status: 400,
      code: "CONTRACT_CALLDATA_REQUIRED",
      reason: "CAW contract_call requires ABI-encoded calldata.",
      requestId
    });
  }

  const body = {
    pact_id: paymentContext.cawPactId,
    chain_id: paymentContext.chainId,
    contract_addr: contractAddress,
    value: toCawDecimalAmount(amount ?? "0", paymentContext.amountDecimals),
    calldata,
    request_id: requestId,
    description: `clear402:${paymentContextHash}`
  };
  if (typeof env.CLEAR402_CAW_WALLET_ADDRESS === "string" && env.CLEAR402_CAW_WALLET_ADDRESS.length > 0) {
    body.src_addr = env.CLEAR402_CAW_WALLET_ADDRESS;
  }

  return transactionsApi.contractCall(
    env.CLEAR402_CAW_WALLET_UUID,
    body,
    env.CLEAR402_CAW_API_KEY
  );
}

function createLocalRejectedResponse({ status, code, reason, requestId }) {
  const error = new Error(reason);
  error.response = {
    status,
    data: {
      error: {
        code,
        reason,
        details: { request_id: requestId }
      }
    }
  };
  throw error;
}

export function toCawDecimalAmount(amount, decimals) {
  if (!/^[0-9]+$/.test(String(amount))) {
    throw new TypeError("PaymentContext amount must be an integer string");
  }

  if (!Number.isSafeInteger(decimals) || decimals < 0) {
    throw new TypeError("PaymentContext amountDecimals must be a non-negative safe integer");
  }

  const value = BigInt(amount);
  if (decimals === 0) {
    return value.toString();
  }

  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
}

async function loadCawSdk() {
  return import("@cobo/agentic-wallet");
}

function createPrerequisiteExecutor(missing) {
  return async function prerequisiteExecutor({
    paymentContextHash,
    attemptedOperation = "transfer",
    requestId
  }) {
    return createBlockedExecution({
      code: "CAW_LIVE_PREREQUISITES_MISSING",
      reason: "CAW live executor is not configured for testnet execution.",
      details: {
        missingEnv: missing,
        prerequisites: [
          "Install official caw CLI",
          "Complete wallet onboarding and pairing outside Codex",
          "Configure a testnet pact with tiny amount and merchant allowlist",
          "Inject CAW credentials through runtime environment only"
        ]
      },
      suggestion: "Complete CAW manual setup without sharing secrets, then restart the runtime with env vars set.",
      attemptedOperation,
      paymentContextHash,
      cawRequestId: requestId,
      evidenceMode: "fallback"
    });
  };
}

function validatePaymentContextAgainstEnv(paymentContext, env) {
  const mismatches = [];
  if (paymentContext.cawPactId !== env.CLEAR402_CAW_PACT_ID) {
    mismatches.push("cawPactId");
  }
  if (paymentContext.chainId !== env.CLEAR402_CAW_CHAIN_ID) {
    mismatches.push("chainId");
  }
  if (paymentContext.tokenId !== env.CLEAR402_CAW_TOKEN_ID) {
    mismatches.push("tokenId");
  }
  return mismatches;
}

function isPendingApproval(result) {
  return (
    PENDING_APPROVAL_STATUSES.has(Number(result?.status)) ||
    typeof result?.pending_operation_id === "string" ||
    typeof result?.approval_id === "string" ||
    /pending[_ -]?approval/i.test(String(result?.status_display ?? ""))
  );
}

async function lookupTransactionByRequestId({ transactionRecordsApi, walletUuid, apiKey, requestId }) {
  try {
    return (
      await transactionRecordsApi.getUserTransactionByRequestId(
        walletUuid,
        requestId,
        true,
        apiKey
      )
    ).data?.result;
  } catch {
    return undefined;
  }
}

async function lookupAuditLogByRequestId({ auditApi, walletUuid, apiKey, requestId, limit }) {
  try {
    const logs = (await auditApi.listAuditLogs(
      walletUuid,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      limit,
      apiKey
    )).data?.result?.items ?? [];
    return logs.find((item) => auditLogContainsRequestId(item, requestId));
  } catch {
    return undefined;
  }
}

async function settleTransferEvidence({
  transactionRecordsApi,
  auditApi,
  walletUuid,
  apiKey,
  requestId,
  limit,
  timeoutMs,
  pollMs
}) {
  const deadline = Date.now() + timeoutMs;
  let record;
  let auditLog;

  do {
    record = await lookupTransactionByRequestId({
      transactionRecordsApi,
      walletUuid,
      apiKey,
      requestId
    });
    auditLog = await lookupAuditLogByRequestId({
      auditApi,
      walletUuid,
      apiKey,
      requestId,
      limit
    });

    if (record && auditLog) {
      return { record, auditLog };
    }

    if (Date.now() >= deadline) {
      break;
    }

    await delay(Math.min(pollMs, Math.max(250, deadline - Date.now())));
  } while (Date.now() < deadline);

  return { record, auditLog };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function auditLogContainsRequestId(item, requestId) {
  return JSON.stringify({
    resourceId: item?.resource_id,
    request: item?.request,
    authzDetails: item?.authz_details,
    error: item?.error
  }).includes(requestId);
}

function normalizeSuccessfulTransaction({
  submitResult,
  record,
  auditLog,
  requestId,
  paymentContext,
  paymentContextHash,
  attemptedOperation
}) {
  const status = Number(record?.status ?? submitResult?.status);
  if (FAILED_STATUSES.has(status)) {
    return createBlockedExecution({
      code: attemptedOperation === "contract_call" ? "CAW_CONTRACT_CALL_FAILED" : "CAW_TRANSFER_FAILED",
      reason: "CAW transaction reached a failed, rejected, or cancelled status.",
      details: {
        status,
        statusDisplay: record?.status_display ?? submitResult?.status_display,
        coboTransactionId: record?.cobo_transaction_id
      },
      attemptedOperation,
      paymentContextHash,
      cawRequestId: record?.request_id ?? submitResult?.request_id ?? requestId,
      auditLogId: auditLog?.id === undefined ? undefined : String(auditLog.id),
      evidenceMode: "live"
    });
  }

  const txHash = record?.transaction_hash ?? submitResult?.transaction_hash;
  const coboTransactionId = record?.cobo_transaction_id ?? submitResult?.id;
  const walletAddress = record?.src_address;
  const auditLogId = auditLog?.id === undefined ? undefined : String(auditLog.id);

  if (!SUCCESS_STATUSES.has(status) && !txHash && !coboTransactionId) {
    return createBlockedExecution({
      code:
        attemptedOperation === "contract_call"
          ? "CAW_CONTRACT_CALL_NOT_CONFIRMED"
          : "CAW_TRANSFER_NOT_CONFIRMED",
      reason: "CAW did not return submitted or confirmed transaction evidence.",
      details: {
        status,
        statusDisplay: record?.status_display ?? submitResult?.status_display,
        coboTransactionId,
        txHash
      },
      attemptedOperation,
      paymentContextHash,
      cawRequestId: record?.request_id ?? submitResult?.request_id ?? requestId,
      auditLogId,
      evidenceMode: "fallback",
      decision: "fallback_required"
    });
  }

  if (!walletAddress || (!txHash && !coboTransactionId) || !auditLogId) {
    return createBlockedExecution({
      code: "CAW_LIVE_EVIDENCE_MISSING",
      reason: "CAW execution did not include wallet, transaction, and audit evidence required for live mode.",
      details: {
        walletAddress: Boolean(walletAddress),
        txHash: Boolean(txHash),
        coboTransactionId: Boolean(coboTransactionId),
        auditLogId: Boolean(auditLogId),
        requestId: record?.request_id ?? submitResult?.request_id ?? requestId
      },
      attemptedOperation,
      paymentContextHash,
      cawRequestId: record?.request_id ?? submitResult?.request_id ?? requestId,
      auditLogId,
      evidenceMode: "fallback",
      decision: "fallback_required"
    });
  }

  return {
    ok: true,
    decision: "allow",
    evidenceMode: "live",
    cawRequestId: record?.request_id ?? submitResult?.request_id ?? requestId,
    requestId: record?.request_id ?? submitResult?.request_id ?? requestId,
    walletAddress,
    walletAddressSource: "caw_transaction_record",
    txHash,
    coboTransactionId,
    auditLogId,
    rawEvidenceRef: `caw-live:${record?.id ?? submitResult?.id ?? coboTransactionId}:${auditLogId}`,
    paymentContextHash,
    chainId: paymentContext.chainId,
    tokenId: paymentContext.tokenId,
    amount: paymentContext.amount
  };
}

function createDeniedExecution({ error, attemptedOperation, paymentContextHash, cawRequestId }) {
  const parsed = parseApiError(error);
  const result = parsed.result ?? parsed.error?.result;
  const decision =
    result === "pending" || parsed.status === 200 || /pending/i.test(parsed.reason)
      ? "require_approval"
      : "block";
  const code =
    decision === "require_approval"
      ? "CAW_PENDING_APPROVAL"
      : parsed.code ?? "CAW_POLICY_DENIED";

  return createBlockedExecution({
    code,
    reason:
      parsed.reason ??
      (decision === "require_approval"
        ? "CAW operation requires owner approval."
        : "CAW policy denied the transfer."),
    details: {
      httpStatus: parsed.status,
      cawCode: parsed.code,
      cawDetails: parsed.details,
      cawResponse: parsed.responseData
    },
    suggestion: parsed.suggestion,
    attemptedOperation,
    paymentContextHash,
    cawRequestId,
    auditLogId: parsed.auditLogId,
    evidenceMode: "live",
    decision
  });
}

function parseApiError(error) {
  const response = error?.response;
  const data = response?.data ?? {};
  const payloadError = data.error ?? data;
  return {
    status: response?.status,
    code: payloadError?.code,
    reason: payloadError?.reason ?? data.message ?? error?.message,
    details: payloadError?.details,
    suggestion: data.suggestion,
    auditLogId:
      payloadError?.details?.audit_log_id ??
      payloadError?.details?.auditLogId ??
      data.audit_log_id ??
      data.auditLogId,
    result: payloadError?.result ?? data.result,
    responseData: redactSensitive(data)
  };
}

function redactSensitive(value) {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (/api[_-]?key|authorization|token|secret|credential/i.test(key)) {
        return [key, "[REDACTED]"];
      }
      return [key, redactSensitive(item)];
    })
  );
}

function createBlockedExecution({
  code,
  reason,
  details,
  suggestion,
  attemptedOperation,
  paymentContextHash,
  cawRequestId,
  auditLogId,
  evidenceMode,
  decision = "block"
}) {
  return {
    ok: false,
    decision,
    evidenceMode,
    paymentContextHash,
    requestId: cawRequestId,
    cawRequestId,
    auditLogId,
    rawEvidenceRef: auditLogId ? `caw-audit:${auditLogId}` : undefined,
    denial: createCawPolicyDenialEvidence({
      code,
      reason,
      details,
      suggestion,
      attemptedOperation,
      paymentContextHash,
      cawRequestId,
      auditLogId,
      evidenceMode
    })
  };
}
