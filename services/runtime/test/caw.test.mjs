import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CAW_CAPABILITIES,
  createCapabilityRecord,
  createCawAdapter,
  createCawCapabilityReport,
  createCawLiveExecutor,
  executePaymentIntent,
  probeCawCapabilities,
  renderCawCapabilityReportMarkdown,
  toCawDecimalAmount,
  validatePaymentContext
} from "../src/index.mjs";
import { sha256Hex } from "../../../packages/shared/src/index.mjs";

describe("CAW capability probing", () => {
  it("marks the CAW boundary unavailable without upgrading anything to live", () => {
    const records = probeCawCapabilities({
      command: "missing-caw",
      clock: () => 1_800_000_000_000,
      runner: () => ({
        ok: false,
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: "",
        errorCode: "ENOENT"
      })
    });

    assert.equal(records.length, CAW_CAPABILITIES.length);
    assert.equal(records[0].capability, "caw_cli");
    assert.equal(records[0].status, "unavailable");
    assert.equal(records[0].evidenceMode, "fallback");

    for (const record of records) {
      assert.notEqual(record.evidenceMode, "live");
      assert.match(record.rawEvidenceRef, /^caw-probe:[a-f0-9]{24}$/);
    }
  });

  it("treats a responding CAW CLI as only a partial verification", () => {
    const records = probeCawCapabilities({
      clock: () => 1_800_000_000_000,
      runner: () => ({
        ok: true,
        exitCode: 0,
        signal: null,
        stdout: "caw help",
        stderr: "",
        errorCode: undefined
      })
    });

    assert.equal(records.find((record) => record.capability === "caw_cli").status, "verified");
    assert.equal(records.find((record) => record.capability === "caw_cli").evidenceMode, "live");
    assert.equal(records.find((record) => record.capability === "payment_execution").status, "fallback_required");
    assert.equal(records.find((record) => record.capability === "audit_lookup").status, "needs_manual_step");
  });

  it("renders a report that tells operators when live CAW cannot be claimed", () => {
    const report = createCawCapabilityReport(
      CAW_CAPABILITIES.map((capability) =>
        createCapabilityRecord({
          capability,
          status: capability === "caw_cli" ? "unavailable" : "fallback_required",
          evidenceMode: "fallback",
          rawEvidenceRef: "caw-probe:test",
          notes: "test"
        })
      ),
      { createdAt: 1_800_000_000_000 }
    );
    const markdown = renderCawCapabilityReportMarkdown(report);

    assert.equal(report.liveReady, false);
    assert.match(markdown, /must not claim live CAW execution/);
    assert.match(markdown, /`fallback_required`/);
  });
});

describe("CawAdapter", () => {
  it("validates the required PaymentContext contract", () => {
    const invalid = validatePaymentContext({
      version: "clear402.payment.v1",
      amount: 10
    });

    assert.equal(invalid.ok, false);
    assert.match(invalid.failures.join("\n"), /amount must be a non-empty string/);
    assert.match(invalid.failures.join("\n"), /missionId must be a non-empty string/);
  });

  it("blocks payment execution when CAW capabilities are not verified", async () => {
    const adapter = createCawAdapter({
      capabilities: fallbackCapabilityReport(),
      clock: () => 1_800_000_000_000,
      requestIdFactory: () => "caw_test_request"
    });

    const result = await adapter.executePaymentIntent(paymentContext());

    assert.equal(adapter.canExecuteLivePayments(), false);
    assert.equal(result.ok, false);
    assert.equal(result.decision, "fallback_required");
    assert.equal(result.evidenceMode, "fallback");
    assert.equal(result.denial.code, "CAW_CAPABILITY_UNVERIFIED");
    assert.equal(result.denial.evidenceMode, "fallback");
    assert.equal(result.denial.cawRequestId, "caw_test_request");
    assert.equal(result.guardEvent.layer, "caw-adapter");
  });

  it("blocks expired PaymentContexts before touching any executor", async () => {
    let called = false;
    const result = await executePaymentIntent(
      paymentContext({ expiresAt: 1_799_999_999_999 }),
      {
        report: liveCapabilityReport(),
        clock: () => 1_800_000_000_000,
        liveExecutor: async () => {
          called = true;
        }
      }
    );

    assert.equal(called, false);
    assert.equal(result.ok, false);
    assert.equal(result.decision, "block");
    assert.equal(result.denial.code, "PAYMENT_CONTEXT_EXPIRED");
  });

  it("requires raw evidence before returning a live CAW execution result", async () => {
    const result = await executePaymentIntent(paymentContext(), {
      report: liveCapabilityReport(),
      clock: () => 1_800_000_000_000,
      requestIdFactory: () => "caw_missing_evidence",
      liveExecutor: async () => ({
        cawRequestId: "caw_live_request"
      })
    });

    assert.equal(result.ok, false);
    assert.equal(result.decision, "fallback_required");
    assert.equal(result.denial.code, "CAW_LIVE_EVIDENCE_MISSING");
    assert.equal(result.evidenceMode, "fallback");
  });

  it("allows live execution only through CawAdapter with wallet, transaction, audit, and raw evidence", async () => {
    const result = await executePaymentIntent(paymentContext(), {
      report: liveCapabilityReport(),
      clock: () => 1_800_000_000_000,
      liveExecutor: async ({ paymentContextHash, requestId }) => ({
        evidenceMode: "live",
        cawRequestId: requestId,
        auditLogId: `audit:${paymentContextHash.slice(0, 16)}`,
        txHash: `0x${"1".repeat(64)}`,
        walletAddress: "0xCAW0000000000000000000000000000000000001",
        rawEvidenceRef: `caw-live:${paymentContextHash.slice(0, 16)}`
      })
    });

    assert.equal(result.ok, true);
    assert.equal(result.decision, "allow");
    assert.equal(result.evidenceMode, "live");
    assert.match(result.paymentContextHash, /^[a-f0-9]{64}$/);
    assert.match(result.rawEvidenceRef, /^caw-live:/);
  });

  it("treats pending approval as require_approval, not allow", async () => {
    const result = await executePaymentIntent(paymentContext(), {
      report: liveCapabilityReport(),
      requestIdFactory: () => "caw_pending",
      liveExecutor: async ({ requestId, paymentContextHash }) => ({
        ok: false,
        decision: "require_approval",
        evidenceMode: "live",
        cawRequestId: requestId,
        auditLogId: "approval-1",
        denial: {
          code: "CAW_PENDING_APPROVAL",
          reason: "owner approval required",
          details: { approvalId: "approval-1" },
          attemptedOperation: "transfer",
          paymentContextHash,
          cawRequestId: requestId,
          auditLogId: "approval-1",
          evidenceMode: "live"
        }
      })
    });

    assert.equal(result.ok, false);
    assert.equal(result.decision, "require_approval");
    assert.equal(result.denial.code, "CAW_PENDING_APPROVAL");
  });

  it("blocks live execution when transaction or audit evidence is missing", async () => {
    const result = await executePaymentIntent(paymentContext(), {
      report: liveCapabilityReport(),
      requestIdFactory: () => "caw_missing_tx_audit",
      liveExecutor: async ({ requestId }) => ({
        cawRequestId: requestId,
        walletAddress: "0xCAW0000000000000000000000000000000000001",
        rawEvidenceRef: "caw-live:missing"
      })
    });

    assert.equal(result.ok, false);
    assert.equal(result.decision, "fallback_required");
    assert.equal(result.denial.code, "CAW_LIVE_EVIDENCE_MISSING");
  });

  it("maps policy denial evidence to block", async () => {
    const result = await executePaymentIntent(paymentContext(), {
      report: liveCapabilityReport(),
      requestIdFactory: () => "caw_policy_denied",
      liveExecutor: async ({ requestId, paymentContextHash }) => ({
        ok: false,
        decision: "block",
        evidenceMode: "live",
        cawRequestId: requestId,
        auditLogId: "audit-denied",
        denial: {
          code: "CAW_POLICY_DENIED",
          reason: "amount over pact limit",
          details: { rule: "amount_gt" },
          attemptedOperation: "transfer",
          paymentContextHash,
          cawRequestId: requestId,
          auditLogId: "audit-denied",
          evidenceMode: "live"
        }
      })
    });

    assert.equal(result.ok, false);
    assert.equal(result.decision, "block");
    assert.equal(result.denial.code, "CAW_POLICY_DENIED");
    assert.equal(result.denial.auditLogId, "audit-denied");
  });

  it("returns message_sign fallback denial through the adapter boundary", async () => {
    const adapter = createCawAdapter({
      capabilities: fallbackCapabilityReport(),
      clock: () => 1_800_000_000_000,
      requestIdFactory: () => "caw_message_sign"
    });

    const result = await adapter.signMessage({
      requestId: "caw_message_sign",
      paymentContext: paymentContext({
        operation: "message_sign",
        messageSignDigest: sha256Hex("message")
      })
    });

    assert.equal(result.decision, "fallback_required");
    assert.equal(result.denial.attemptedOperation, "message_sign");
    assert.equal(result.denial.code, "CAW_CAPABILITY_UNVERIFIED");
  });
});

describe("CAW live executor", () => {
  it("converts PaymentContext integer amounts into CAW decimal amounts", () => {
    assert.equal(toCawDecimalAmount("10000", 6), "0.01");
    assert.equal(toCawDecimalAmount("5", 0), "5");
    assert.equal(toCawDecimalAmount("1234500", 4), "123.45");
  });

  it("executes the success path through a fake SDK without touching real funds", async () => {
    const calls = [];
    const executor = createCawLiveExecutor({
      env: cawEnv(),
      sdkLoader: async () => fakeCawSdk({ calls })
    });

    const result = await executor({
      paymentContext: paymentContext({
        cawPactId: "pact_test",
        chainId: "BASE_SEPOLIA",
        tokenId: "BASE_SEPOLIA_USDC",
        amount: "10000",
        amountDecimals: 6
      }),
      paymentContextHash: "0x" + "a".repeat(64),
      attemptedOperation: "transfer",
      requestId: "clear402:test-request"
    });

    assert.equal(result.ok, true);
    assert.equal(result.evidenceMode, "live");
    assert.equal(result.cawRequestId, "clear402:test-request");
    assert.equal(result.walletAddress, "0xCAW0000000000000000000000000000000000001");
    assert.equal(result.txHash, "0x" + "9".repeat(64));
    assert.equal(result.auditLogId, "101");
    assert.equal(calls.filter((call) => call.method === "transferTokens").length, 1);
    assert.equal(calls.filter((call) => call.method === "getUserTransactionByRequestId").length, 1);
    assert.equal(calls.filter((call) => call.method === "listAuditLogs").length, 1);

    const transferCall = calls.find((call) => call.method === "transferTokens");
    assert.equal(transferCall.body.pact_id, "pact_test");
    assert.equal(transferCall.body.chain_id, "BASE_SEPOLIA");
    assert.equal(transferCall.body.token_id, "BASE_SEPOLIA_USDC");
    assert.equal(transferCall.body.dst_addr, "0x1111111111111111111111111111111111111111");
    assert.equal(transferCall.body.src_addr, "0xCAW0000000000000000000000000000000000001");
    assert.equal(transferCall.body.amount, "0.01");
    assert.equal(transferCall.body.request_id, "clear402:test-request");
    assert.equal(transferCall.apiKey, "redacted-test-key");

    assert.equal(calls.find((call) => call.method === "getUserTransactionByRequestId").apiKey, "redacted-test-key");
    assert.equal(calls.find((call) => call.method === "listAuditLogs").apiKey, "redacted-test-key");
  });

  it("does not count pending_approval as allow", async () => {
    const executor = createCawLiveExecutor({
      env: cawEnv(),
      sdkLoader: async () => fakeCawSdk({ transferResult: { status: 100, status_display: "PENDING_APPROVAL", pending_operation_id: "pending-1" } })
    });

    const result = await executor({
      paymentContext: paymentContext({
        cawPactId: "pact_test",
        chainId: "BASE_SEPOLIA",
        tokenId: "BASE_SEPOLIA_USDC"
      }),
      paymentContextHash: "0x" + "b".repeat(64),
      requestId: "clear402:pending"
    });

    assert.equal(result.ok, false);
    assert.equal(result.decision, "require_approval");
    assert.equal(result.denial.code, "CAW_PENDING_APPROVAL");
  });

  it("does not count missing tx or audit evidence as live", async () => {
    const executor = createCawLiveExecutor({
      env: cawEnv(),
      evidenceSettleTimeoutMs: 20,
      evidenceSettlePollMs: 5,
      sdkLoader: async () =>
        fakeCawSdk({
          transactionRecord: {
            id: "tx-1",
            status: 900,
            request_id: "clear402:no-audit",
            src_address: "0xCAW0000000000000000000000000000000000001"
          },
          auditItems: []
        })
    });

    const result = await executor({
      paymentContext: paymentContext({
        cawPactId: "pact_test",
        chainId: "BASE_SEPOLIA",
        tokenId: "BASE_SEPOLIA_USDC"
      }),
      paymentContextHash: "0x" + "c".repeat(64),
      requestId: "clear402:no-audit"
    });

    assert.equal(result.ok, false);
    assert.equal(result.decision, "fallback_required");
    assert.equal(result.denial.code, "CAW_LIVE_EVIDENCE_MISSING");
  });

  it("turns CAW policy denial into block evidence", async () => {
    const executor = createCawLiveExecutor({
      env: cawEnv(),
      sdkLoader: async () =>
        fakeCawSdk({
          transferError: {
            response: {
              status: 403,
              data: {
                error: {
                  code: "policy_violation",
                  reason: "amount_gt",
                  details: {
                    audit_log_id: "audit-denial",
                    api_key: "should-not-leak"
                  }
                },
                suggestion: "lower amount"
              }
            }
          }
        })
    });

    const result = await executor({
      paymentContext: paymentContext({
        cawPactId: "pact_test",
        chainId: "BASE_SEPOLIA",
        tokenId: "BASE_SEPOLIA_USDC"
      }),
      paymentContextHash: "0x" + "d".repeat(64),
      requestId: "clear402:denied"
    });

    assert.equal(result.ok, false);
    assert.equal(result.decision, "block");
    assert.equal(result.denial.code, "policy_violation");
    assert.equal(result.denial.auditLogId, "audit-denial");
    assert.equal(result.denial.details.cawResponse.error.details.api_key, "[REDACTED]");
  });

  it("does not route unsupported live CAW operations through transferTokens", async () => {
    const calls = [];
    const executor = createCawLiveExecutor({
      env: cawEnv(),
      sdkLoader: async () => fakeCawSdk({ calls })
    });

    const result = await executor({
      paymentContext: paymentContext({
        cawPactId: "pact_test",
        chainId: "BASE_SEPOLIA",
        tokenId: "BASE_SEPOLIA_USDC",
        operation: "message_sign",
        messageSignDigest: sha256Hex("message")
      }),
      paymentContextHash: "0x" + "f".repeat(64),
      attemptedOperation: "message_sign",
      requestId: "clear402:message-sign"
    });

    assert.equal(result.ok, false);
    assert.equal(result.decision, "fallback_required");
    assert.equal(result.denial.code, "CAW_UNSUPPORTED_OPERATION");
    assert.equal(result.denial.attemptedOperation, "message_sign");
    assert.equal(calls.filter((call) => call.method === "transferTokens").length, 0);
  });

  it("routes contract_call through CAW contractCall with calldata and value", async () => {
    const calls = [];
    const executor = createCawLiveExecutor({
      env: cawEnv(),
      sdkLoader: async () =>
        fakeCawSdk({
          calls,
          auditItems: [
            {
              id: 103,
              request: { request_id: "clear402:contract-call" },
              resource_id: "clear402:contract-call",
              result: "allowed"
            }
          ]
        })
    });

    const result = await executor({
      paymentContext: paymentContext({
        cawPactId: "pact_test",
        chainId: "BASE_SEPOLIA",
        tokenId: "BASE_SEPOLIA_USDC",
        operation: "contract_call",
        serviceMode: "escrowed-delivery",
        amount: "10000",
        amountDecimals: 6
      }),
      paymentContextHash: "0x" + "a".repeat(64),
      attemptedOperation: "contract_call",
      requestId: "clear402:contract-call",
      contractAddress: "0x3333333333333333333333333333333333333333",
      calldata: "0xf8388f0f" + "a".repeat(64),
      amount: "10000"
    });

    const contractCall = calls.find((call) => call.method === "contractCall");

    assert.equal(result.ok, true);
    assert.equal(calls.filter((call) => call.method === "transferTokens").length, 0);
    assert.equal(contractCall.body.pact_id, "pact_test");
    assert.equal(contractCall.body.chain_id, "BASE_SEPOLIA");
    assert.equal(contractCall.body.contract_addr, "0x3333333333333333333333333333333333333333");
    assert.equal(contractCall.body.value, "0.01");
    assert.equal(contractCall.body.calldata, "0xf8388f0f" + "a".repeat(64));
    assert.equal(contractCall.body.request_id, "clear402:contract-call");
  });

  it("reuses the stable request_id result for idempotency", async () => {
    const calls = [];
    const executor = createCawLiveExecutor({
      env: cawEnv(),
      sdkLoader: async () => fakeCawSdk({ calls })
    });
    const input = {
      paymentContext: paymentContext({
        cawPactId: "pact_test",
        chainId: "BASE_SEPOLIA",
        tokenId: "BASE_SEPOLIA_USDC"
      }),
      paymentContextHash: "0x" + "e".repeat(64),
      requestId: "clear402:idempotent"
    };

    const first = await executor(input);
    const second = await executor(input);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(calls.filter((call) => call.method === "transferTokens").length, 1);
    assert.equal(calls.filter((call) => call.method === "getUserTransactionByRequestId").length, 1);
    assert.equal(calls.filter((call) => call.method === "listAuditLogs").length, 1);
    assert.equal(second.cawRequestId, "clear402:idempotent");
  });
});

function fallbackCapabilityReport() {
  return createCawCapabilityReport(
    CAW_CAPABILITIES.map((capability) =>
      createCapabilityRecord({
        capability,
        status: capability === "caw_cli" ? "unavailable" : "fallback_required",
        evidenceMode: "fallback",
        rawEvidenceRef: "caw-probe:test",
        notes: "test fallback"
      })
    ),
    { createdAt: 1_800_000_000_000 }
  );
}

function liveCapabilityReport() {
  return createCawCapabilityReport(
    CAW_CAPABILITIES.map((capability) =>
      createCapabilityRecord({
        capability,
        status: "verified",
        evidenceMode: "live",
        rawEvidenceRef: `caw-live:${capability}`,
        notes: "test live verification"
      })
    ),
    { createdAt: 1_800_000_000_000 }
  );
}

function paymentContext(overrides = {}) {
  return {
    version: "clear402.payment.v1",
    missionId: "mission_test",
    providerId: "provider_test",
    quoteId: "quote_test",
    method: "GET",
    origin: "http://localhost:4010",
    resourcePath: "/paid/report",
    canonicalUrlHash: sha256Hex("http://localhost:4010/paid/report"),
    bodyHash: sha256Hex(""),
    sanitizedResourceHash: sha256Hex("/paid/report"),
    merchantAddress: "0x1111111111111111111111111111111111111111",
    facilitatorUrlHash: sha256Hex("http://localhost:4020"),
    chainId: "base-sepolia",
    tokenId: "usdc",
    amount: "10000",
    amountDecimals: 6,
    nonce: "nonce_test",
    issuedAt: 1_800_000_000_000,
    expiresAt: 1_800_000_060_000,
    quoteTermsHash: sha256Hex("quote terms"),
    piiPolicyHash: sha256Hex("pii policy"),
    cawPactId: "pact_test",
    serviceMode: "caw-fetch",
    ...overrides
  };
}

function cawEnv() {
  return {
    CLEAR402_CAW_API_URL: "https://api.testnet.invalid",
    CLEAR402_CAW_API_KEY: "redacted-test-key",
    CLEAR402_CAW_WALLET_UUID: "wallet-test",
    CLEAR402_CAW_WALLET_ADDRESS: "0xCAW0000000000000000000000000000000000001",
    CLEAR402_CAW_PACT_ID: "pact_test",
    CLEAR402_CAW_CHAIN_ID: "BASE_SEPOLIA",
    CLEAR402_CAW_TOKEN_ID: "BASE_SEPOLIA_USDC"
  };
}

function fakeCawSdk({
  calls = [],
  transferResult,
  transferError,
  contractCallResult,
  contractCallError,
  transactionRecord,
  auditItems
} = {}) {
  return {
    Configuration: class Configuration {
      constructor(config) {
        this.config = config;
      }
    },
    TransactionsApi: class TransactionsApi {
      async transferTokens(walletUuid, body, apiKey) {
        if (transferError) {
          throw transferError;
        }
        calls.push({ walletUuid, body, apiKey, method: "transferTokens" });
        return {
          data: {
            result: {
              id: "submit-1",
              request_id: body.request_id,
              transaction_hash: "0x" + "9".repeat(64),
              status: 900,
              status_display: "Success",
              ...transferResult
            }
          }
        };
      }
      async contractCall(walletUuid, body, apiKey) {
        if (contractCallError) {
          throw contractCallError;
        }
        calls.push({ walletUuid, body, apiKey, method: "contractCall" });
        return {
          data: {
            result: {
              id: "contract-call-submit-1",
              request_id: body.request_id,
              transaction_hash: "0x" + "9".repeat(64),
              status: 900,
              status_display: "Success",
              ...contractCallResult
            }
          }
        };
      }
    },
    TransactionRecordsApi: class TransactionRecordsApi {
      async getUserTransactionByRequestId(walletUuid, requestId, ext, apiKey) {
        calls.push({ walletUuid, requestId, ext, apiKey, method: "getUserTransactionByRequestId" });
        return {
          data: {
            result: {
              id: "tx-record-1",
              wallet_id: walletUuid,
              pact_id: "pact_test",
              type: "transfer",
              chain_id: "BASE_SEPOLIA",
              token_id: "BASE_SEPOLIA_USDC",
              src_address: "0xCAW0000000000000000000000000000000000001",
              dst_address: "0x1111111111111111111111111111111111111111",
              amount: "0.01",
              status: 900,
              status_display: "success",
              transaction_hash: "0x" + "9".repeat(64),
              request_id: requestId,
              cobo_transaction_id: "cobo-tx-1",
              data: {},
              created_at: "2026-06-12T00:00:00Z",
              updated_at: "2026-06-12T00:00:01Z",
              ...transactionRecord
            }
          }
        };
      }
    },
    AuditApi: class AuditApi {
      async listAuditLogs(walletUuid, principalId, action, result, startTime, endTime, after, before, cursor, limit, apiKey) {
        calls.push({ walletUuid, limit, apiKey, method: "listAuditLogs" });
        return {
          data: {
            result: {
              items: auditItems ?? [
                {
                  id: 101,
                  request: { request_id: "clear402:test-request" },
                  resource_id: "clear402:test-request",
                  result: "allowed"
                },
                {
                  id: 102,
                  request: { request_id: "clear402:idempotent" },
                  resource_id: "clear402:idempotent",
                  result: "allowed"
                }
              ]
            }
          }
        };
      }
    }
  };
}
