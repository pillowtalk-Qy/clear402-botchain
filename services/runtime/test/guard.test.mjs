import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPaymentContext,
  buildServiceEscrowFundCalldata,
  buildServiceEscrowRefundCalldata,
  clearSign,
  createDualReceipt,
  createServiceEscrow,
  createSignedProviderQuote,
  fundServiceEscrow,
  markServiceEscrowDelivered,
  normalizeX402Challenge,
  refundServiceEscrow,
  runGuardPipeline,
  scanMetadata,
  serviceEscrowAmountFromPaymentContext,
  signReceiptForDemo,
  verifyDualReceipt,
  validateERC8004Trust,
  validateProviderRegistry,
  verifySignedProviderQuote,
  verifyServiceReceipt
} from "../src/index.mjs";
import { sha256Hex as guardSha256Hex } from "../src/guard/hash.ts";
import { buildServiceResultHash } from "../src/receipt/receipt_verifier.ts";

describe("guard primitives", () => {
  const providerEntry = makeProviderEntry();

  it("blocks provider registry origin mismatch", () => {
    const result = validateProviderRegistry({
      entries: [providerEntry],
      providerId: providerEntry.providerId,
      origin: "https://wrong.example",
      resourcePath: "/paid/report",
      payTo: providerEntry.merchantAddress,
      facilitatorUrl: providerEntry.facilitatorUrl,
      chainId: providerEntry.chainId,
      tokenId: providerEntry.tokenId,
      cawAllowedMerchantAddresses: [providerEntry.merchantAddress]
    });

    assert.equal(result.decision, "block");
    assert.match(result.reason ?? "", /Provider origin is not registered/);
  });

  it("blocks ERC-8004 payTo mismatch", () => {
    const result = validateERC8004Trust({
      entry: providerEntry,
      records: [
        {
          agentId: providerEntry.erc8004AgentId,
          agentUri: providerEntry.erc8004AgentUri,
          payTo: "0x2222222222222222222222222222222222222222",
          reputationScore: 95,
          identityVerified: true,
          validationAttestations: []
        }
      ],
      endpoint: providerEntry.erc8004AgentUri,
      payTo: providerEntry.merchantAddress,
      amount: "5"
    });

    assert.equal(result.decision, "block");
    assert.match(result.reason ?? "", /payTo does not match/);
  });

  it("marks unavailable live ERC-8004 source as fallback_required needs_registration", () => {
    const result = validateERC8004Trust({
      entry: providerEntry,
      records: [],
      endpoint: providerEntry.erc8004AgentUri,
      payTo: providerEntry.merchantAddress,
      amount: "5",
      liveSource: {
        source: "8004scan",
        status: "unavailable",
        reference: "https://8004scan.io/api/v1/public/agents/search?q=clear402",
        checkedAt: 1_800_000_000_000,
        reason: "Clear402 provider was not found in the live ERC-8004 index."
      },
      requireLiveForRegisteredAgent: true
    });

    assert.equal(result.decision, "fallback_required");
    assert.equal(result.trustSource, "unavailable");
    assert.equal(result.registrationStatus, "needs_registration");
    assert.equal(result.evidenceMode, "fallback");
    assert.equal(result.liveSource.status, "unavailable");
    assert.match(result.reason ?? "", /not found/);
  });

  it("does not mark demo ERC-8004 records as live trust", () => {
    const result = validateERC8004Trust({
      entry: providerEntry,
      records: [
        {
          agentId: providerEntry.erc8004AgentId,
          agentUri: providerEntry.erc8004AgentUri,
          payTo: providerEntry.merchantAddress,
          reputationScore: 95,
          deliverySuccessRate: 0.99,
          identityVerified: true,
          validationAttestations: []
        }
      ],
      endpoint: providerEntry.erc8004AgentUri,
      payTo: providerEntry.merchantAddress,
      amount: "5",
      liveSource: {
        source: "registry_contract",
        status: "needs_registration",
        reason: "No live agent token is registered for this provider."
      }
    });

    assert.equal(result.decision, "require_approval");
    assert.equal(result.trustSource, "demo_erc8004");
    assert.equal(result.registrationStatus, "needs_registration");
    assert.equal(result.demoFallbackUsed, true);
    assert.equal(result.evidenceMode, "mock");
    assert.notEqual(result.evidenceMode, "live");
    assert.match(result.reason ?? "", /demo-backed/);
  });

  it("allows verified live ERC-8004 records with matching endpoint and payTo", () => {
    const result = validateERC8004Trust({
      entry: providerEntry,
      records: [
        {
          agentId: providerEntry.erc8004AgentId,
          agentUri: "https://evil.example/paid/report",
          payTo: "0x2222222222222222222222222222222222222222",
          reputationScore: 99,
          identityVerified: true,
          validationAttestations: []
        }
      ],
      endpoint: providerEntry.erc8004AgentUri,
      payTo: providerEntry.merchantAddress,
      amount: "5",
      liveSource: {
        source: "registry_contract",
        status: "verified",
        reference: "eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:123",
        record: {
          agentId: providerEntry.erc8004AgentId,
          agentUri: providerEntry.erc8004AgentUri,
          payTo: providerEntry.merchantAddress,
          reputationScore: 95,
          deliverySuccessRate: 0.99,
          identityVerified: true,
          validationAttestations: []
        }
      }
    });

    assert.equal(result.decision, "allow");
    assert.equal(result.trustSource, "live_erc8004");
    assert.equal(result.registrationStatus, "registered");
    assert.equal(result.demoFallbackUsed, false);
    assert.equal(result.evidenceMode, "live");
  });

  it("blocks ERC-8004 endpoint mismatch before any live trust claim", () => {
    const result = validateERC8004Trust({
      entry: providerEntry,
      records: [],
      endpoint: providerEntry.erc8004AgentUri,
      payTo: providerEntry.merchantAddress,
      amount: "5",
      liveSource: {
        source: "registry_contract",
        status: "verified",
        record: {
          agentId: providerEntry.erc8004AgentId,
          agentUri: "https://evil.example/paid/report",
          payTo: providerEntry.merchantAddress,
          reputationScore: 95,
          identityVerified: true,
          validationAttestations: []
        }
      }
    });

    assert.equal(result.decision, "block");
    assert.equal(result.trustSource, "live_erc8004");
    assert.equal(result.endpointMatches, false);
    assert.match(result.reason ?? "", /endpoint does not match/);
  });

  it("redacts, hashes, and blocks metadata as required", () => {
    const redact = scanMetadata({
      resourceUrl: "https://provider.example/paid/report?email=test@example.com",
      description: "reach me at test@example.com"
    });
    const hashOnly = scanMetadata({
      resourceUrl: "https://provider.example/paid/report",
      description: "passport: A1234567"
    });
    const blocked = scanMetadata({
      resourceUrl: "https://provider.example/paid/report",
      description: "api_key=supersecretvalue123456"
    });

    assert.equal(redact.decision, "redact");
    assert.match(redact.sanitized.description ?? "", /\[redacted:/);
    assert.equal(hashOnly.decision, "hash_only");
    assert.equal(blocked.decision, "block");
  });

  it("canonicalizes PaymentContext inputs", () => {
    const challenge = makeChallenge(providerEntry, 1_800_000_000_000).normalized;
    const metadata = scanMetadata({
      resourceUrl: "https://provider.example/paid/report",
      description: "ok",
      reason: "MARKET_DATA_REQUEST"
    });

    const built = buildPaymentContext({
      missionId: "mission-1",
      providerId: providerEntry.providerId,
      quoteId: "quote-1",
      method: "GET",
      challenge,
      metadata,
      merchantAddress: providerEntry.merchantAddress,
      chainId: providerEntry.chainId,
      tokenId: providerEntry.tokenId,
      amountDecimals: 6,
      nonce: "nonce-1",
      issuedAt: 1_800_000_000_000,
      cawPactId: "pact-1",
      serviceMode: "caw-fetch"
    });

    assert.equal(built.context.version, "clear402.payment.v1");
    assert.equal(built.canonicalRequest.canonicalUrl, "https://provider.example/paid/report");
    assert.match(built.paymentContextHash, /^0x[a-f0-9]{64}$/);
  });

  it("binds PaymentContext resources to the challenge instead of metadata", () => {
    const challenge = makeChallenge(providerEntry, 1_800_000_000_000).normalized;
    const metadata = scanMetadata({
      resourceUrl: "https://evil.example/paid/report",
      description: "ok",
      reason: "MARKET_DATA_REQUEST"
    });

    const built = buildPaymentContext({
      missionId: "mission-1",
      providerId: providerEntry.providerId,
      quoteId: "quote-1",
      method: "GET",
      challenge,
      metadata,
      merchantAddress: providerEntry.merchantAddress,
      chainId: providerEntry.chainId,
      tokenId: providerEntry.tokenId,
      amountDecimals: 6,
      nonce: "nonce-1",
      issuedAt: 1_800_000_000_000,
      cawPactId: "pact-1",
      serviceMode: "caw-fetch"
    });

    assert.equal(built.canonicalRequest.canonicalUrl, "https://provider.example/paid/report");
    assert.equal(built.canonicalRequest.origin, "https://provider.example");
    assert.equal(built.canonicalRequest.resourcePath, "/paid/report");
    assert.equal(built.context.origin, "https://provider.example");
    assert.equal(built.context.resourcePath, "/paid/report");
    assert.equal(
      built.context.sanitizedResourceHash,
      guardSha256Hex("https://evil.example/paid/report")
    );
  });

  it("blocks malicious approve calldata", () => {
    const challenge = makeChallenge(providerEntry, 1_800_000_000_000).normalized;
    const metadata = scanMetadata({
      resourceUrl: "https://provider.example/paid/report",
      description: "ok",
      reason: "MARKET_DATA_REQUEST"
    });
    const built = buildPaymentContext({
      missionId: "mission-1",
      providerId: providerEntry.providerId,
      quoteId: "quote-1",
      method: "GET",
      challenge,
      metadata,
      merchantAddress: providerEntry.merchantAddress,
      chainId: providerEntry.chainId,
      tokenId: providerEntry.tokenId,
      amountDecimals: 6,
      nonce: "nonce-1",
      issuedAt: 1_800_000_000_000,
      cawPactId: "pact-1",
      serviceMode: "caw-fetch"
    });

    const result = clearSign({
      chainId: providerEntry.chainId,
      to: providerEntry.merchantAddress,
      calldata:
        "0x095ea7b3" +
        "0".repeat(24) +
        "2222222222222222222222222222222222222222" +
        "f".repeat(64),
      expected: {
        merchantAddress: providerEntry.merchantAddress,
        amount: "5",
        tokenId: providerEntry.tokenId,
        allowedSelectors: ["0xa9059cbb"],
        paymentContextHash: built.paymentContextHash,
        allowedSpenders: ["0x3333333333333333333333333333333333333333"]
      }
    });

    assert.equal(result.decision, "block");
    assert.match(result.reason ?? "", /clearsig blocked calldata/);
  });

  it("blocks known selectors that are not on the allowed list", () => {
    const result = clearSign({
      chainId: providerEntry.chainId,
      to: providerEntry.merchantAddress,
      calldata:
        "0x40c10f19" +
        "0".repeat(24) +
        "2222222222222222222222222222222222222222" +
        "1".padStart(64, "0"),
      expected: {
        merchantAddress: providerEntry.merchantAddress,
        amount: "1",
        tokenId: providerEntry.tokenId,
        allowedSelectors: ["0xa9059cbb"]
      }
    });

    assert.equal(result.decision, "block");
    assert.match(result.reason ?? "", /selector_not_allowed/);
  });

  it("enforces function_abis and params_match policies", () => {
    const allowed = clearSign({
      chainId: providerEntry.chainId,
      to: providerEntry.merchantAddress,
      calldata: encodeTransferCalldata(providerEntry.merchantAddress, "5"),
      expected: {
        merchantAddress: providerEntry.merchantAddress,
        amount: "5",
        tokenId: providerEntry.tokenId,
        allowedSelectors: ["0xa9059cbb"],
        functionAbis: [
          {
            selector: "0xa9059cbb",
            signature: "transfer(address,uint256)"
          }
        ],
        paramsMatch: {
          recipient: providerEntry.merchantAddress,
          amount: "5"
        }
      }
    });
    const blocked = clearSign({
      chainId: providerEntry.chainId,
      to: providerEntry.merchantAddress,
      calldata: encodeTransferCalldata(providerEntry.merchantAddress, "6"),
      expected: {
        merchantAddress: providerEntry.merchantAddress,
        amount: "6",
        tokenId: providerEntry.tokenId,
        allowedSelectors: ["0xa9059cbb"],
        functionAbis: [
          {
            selector: "0xa9059cbb",
            signature: "transfer(address,uint256)"
          }
        ],
        paramsMatch: {
          recipient: providerEntry.merchantAddress,
          amount: "5"
        }
      }
    });

    assert.equal(allowed.decision, "allow");
    assert.equal(blocked.decision, "block");
    assert.match(blocked.reason ?? "", /params_match_failed/);
  });

  it("enforces message_match policies for message_sign typed data", () => {
    const typedData = {
      domain: { name: "Clear402" },
      message: {
        paymentContextHash: "0x" + "a".repeat(64),
        intent: "pay_for_report"
      }
    };
    const allowed = clearSign({
      chainId: providerEntry.chainId,
      to: providerEntry.merchantAddress,
      typedData,
      expected: {
        allowedSelectors: [],
        paymentContextHash: typedData.message.paymentContextHash,
        messageMatch: {
          requiredFields: ["message.paymentContextHash", "message.intent"],
          contains: {
            "message.intent": "pay_for_report"
          },
          paymentContextHash: typedData.message.paymentContextHash
        }
      }
    });
    const blocked = clearSign({
      chainId: providerEntry.chainId,
      to: providerEntry.merchantAddress,
      typedData: {
        domain: { name: "Clear402" },
        message: {
          paymentContextHash: "0x" + "b".repeat(64),
          intent: "sign_unbounded_session"
        }
      },
      expected: {
        allowedSelectors: [],
        paymentContextHash: typedData.message.paymentContextHash,
        messageMatch: {
          requiredFields: ["message.paymentContextHash", "message.intent"],
          contains: {
            "message.intent": "pay_for_report"
          },
          paymentContextHash: typedData.message.paymentContextHash
        }
      }
    });

    assert.equal(allowed.decision, "allow");
    assert.equal(blocked.decision, "block");
    assert.match(blocked.reason ?? "", /message_match_failed|context_hash_mismatch/);
  });

  it("builds message_sign PaymentContext evidence and blocks unsigned ProviderQuote tampering", () => {
    const challenge = makeChallenge(providerEntry, 1_800_000_000_000).normalized;
    const metadata = scanMetadata({
      resourceUrl: "https://provider.example/paid/report",
      description: "ok",
      reason: "MARKET_DATA_REQUEST"
    });
    const messageToSign = {
      paymentContextHash: "pending",
      intent: "pay_for_report"
    };
    const quote = createSignedProviderQuote({
      quoteId: "quote-message-sign",
      providerId: providerEntry.providerId,
      challenge,
      chainId: providerEntry.chainId,
      tokenId: providerEntry.tokenId,
      signer: providerEntry.publicKey,
      secret: providerEntry.publicKey,
      issuedAt: 1_800_000_000_000,
      evidenceMode: "fallback"
    });
    const built = buildPaymentContext({
      missionId: "mission-message-sign",
      providerId: providerEntry.providerId,
      quoteId: "quote-message-sign",
      method: "POST",
      challenge,
      metadata,
      merchantAddress: providerEntry.merchantAddress,
      chainId: providerEntry.chainId,
      tokenId: providerEntry.tokenId,
      amountDecimals: 6,
      nonce: "nonce-message-sign",
      issuedAt: 1_800_000_000_000,
      cawPactId: "pact-1",
      serviceMode: "caw-fetch",
      operation: "message_sign",
      messageToSign,
      providerQuote: quote,
      policyBindings: {
        allowedSelectors: [],
        messageMatch: {
          requiredFields: ["message.paymentContextHash"]
        }
      }
    });
    const tampered = {
      ...quote,
      amount: "6"
    };

    const quoteResult = verifySignedProviderQuote({
      quote,
      challenge,
      providerPublicKey: providerEntry.publicKey,
      now: 1_800_000_000_000
    });
    const tamperedResult = verifySignedProviderQuote({
      quote: tampered,
      challenge,
      providerPublicKey: providerEntry.publicKey,
      now: 1_800_000_000_000
    });

    assert.equal(built.context.operation, "message_sign");
    assert.match(built.context.messageSignDigest, /^0x[a-f0-9]{64}$/);
    assert.match(built.context.providerQuoteHash, /^0x[a-f0-9]{64}$/);
    assert.match(built.context.providerQuoteSignature ?? "", /^hmac-sha256:/);
    assert.match(built.context.policyBindingsHash, /^0x[a-f0-9]{64}$/);
    assert.equal(quoteResult.decision, "allow");
    assert.equal(tamperedResult.decision, "block");
  });

  it("tracks ServiceEscrow fund, delivery, and refund state transitions", () => {
    const escrow = createServiceEscrow({
      paymentContextHash: "0x" + "e".repeat(64),
      payer: "0xCAW0000000000000000000000000000000000001",
      provider: providerEntry.merchantAddress,
      amount: "5"
    });
    const funded = fundServiceEscrow(escrow, { now: 1_800_000_000_000 });
    const refunded = refundServiceEscrow(funded.account, {
      reason: "paid-but-not-delivered",
      now: 1_800_000_010_000
    });
    const delivered = markServiceEscrowDelivered(funded.account, {
      now: 1_800_000_020_000
    });
    const refundDelivered = refundServiceEscrow(delivered.account, {
      reason: "too late",
      now: 1_800_000_030_000
    });

    assert.equal(funded.decision, "allow");
    assert.equal(funded.account.state, "funded");
    assert.equal(refunded.decision, "allow");
    assert.equal(refunded.account.state, "refunded");
    assert.equal(delivered.decision, "allow");
    assert.equal(delivered.account.state, "delivered");
    assert.equal(refundDelivered.decision, "block");
    assert.match(refundDelivered.reason ?? "", /cannot refund from delivered/);
  });

  it("builds ServiceEscrow fund calldata bound to PaymentContext", () => {
    const paymentContextHash = "0x" + "e".repeat(64);
    const fund = buildServiceEscrowFundCalldata({
      paymentContextHash,
      providerAddress: providerEntry.merchantAddress,
      amount: "5000000000000000"
    });
    const review = clearSign({
      chainId: providerEntry.chainId,
      to: "0x3333333333333333333333333333333333333333",
      calldata: fund.calldata,
      expected: {
        allowedSelectors: [fund.policy.selector],
        paymentContextHash,
        functionAbis: [
          {
            selector: fund.policy.selector,
            signature: fund.policy.functionSignature
          }
        ],
        paramsMatch: fund.policy.paramsMatch
      }
    });

    assert.equal(fund.calldata.slice(0, 10), "0xf8388f0f");
    assert.equal(fund.value, "5000000000000000");
    assert.equal(review.decision, "allow");
    assert.equal(review.decodedParams.paymentContextHash, paymentContextHash);
    assert.equal(review.decodedParams.provider, providerEntry.merchantAddress);
    assert.equal(review.decodedParams.amount, "5000000000000000");
  });

  it("builds ServiceEscrow refund calldata and blocks delivered refund state", () => {
    const paymentContextHash = "0x" + "f".repeat(64);
    const refund = buildServiceEscrowRefundCalldata({ paymentContextHash });
    const review = clearSign({
      chainId: providerEntry.chainId,
      to: "0x3333333333333333333333333333333333333333",
      calldata: refund.calldata,
      expected: {
        allowedSelectors: [refund.policy.selector],
        paymentContextHash,
        functionAbis: [
          {
            selector: refund.policy.selector,
            signature: refund.policy.functionSignature
          }
        ],
        paramsMatch: refund.policy.paramsMatch
      }
    });
    const escrow = createServiceEscrow({
      paymentContextHash,
      payer: "0xCAW0000000000000000000000000000000000001",
      provider: providerEntry.merchantAddress,
      amount: "5"
    });
    const funded = fundServiceEscrow(escrow);
    const delivered = markServiceEscrowDelivered(funded.account);
    const refundDelivered = refundServiceEscrow(delivered.account, { reason: "late" });

    assert.equal(refund.calldata.slice(0, 10), "0x7249fbb6");
    assert.equal(review.decision, "allow");
    assert.equal(review.decodedParams.paymentContextHash, paymentContextHash);
    assert.equal(refundDelivered.decision, "block");
  });

  it("blocks ServiceEscrow contextHash mismatch", () => {
    const paymentContextHash = "0x" + "1".repeat(64);
    const fund = buildServiceEscrowFundCalldata({
      paymentContextHash,
      providerAddress: providerEntry.merchantAddress,
      amount: "5"
    });
    const review = clearSign({
      chainId: providerEntry.chainId,
      to: "0x3333333333333333333333333333333333333333",
      calldata: fund.calldata,
      expected: {
        allowedSelectors: [fund.policy.selector],
        paymentContextHash: "0x" + "2".repeat(64),
        functionAbis: [
          {
            selector: fund.policy.selector,
            signature: fund.policy.functionSignature
          }
        ],
        paramsMatch: {
          ...fund.policy.paramsMatch,
          paymentContextHash: "0x" + "2".repeat(64)
        }
      }
    });

    assert.equal(review.decision, "block");
    assert.match(review.reason ?? "", /context_hash_mismatch|params_match_failed/);
  });

  it("blocks refund selector or params policy mismatch", () => {
    const paymentContextHash = "0x" + "3".repeat(64);
    const refund = buildServiceEscrowRefundCalldata({ paymentContextHash });
    const selectorMismatch = clearSign({
      chainId: providerEntry.chainId,
      to: "0x3333333333333333333333333333333333333333",
      calldata: refund.calldata,
      expected: {
        allowedSelectors: ["0xf8388f0f"],
        paymentContextHash,
        functionAbis: [
          {
            selector: "0xf8388f0f",
            signature: "fund(bytes32,address,uint256)"
          }
        ],
        paramsMatch: refund.policy.paramsMatch
      }
    });
    const paramsMismatch = clearSign({
      chainId: providerEntry.chainId,
      to: "0x3333333333333333333333333333333333333333",
      calldata: refund.calldata,
      expected: {
        allowedSelectors: [refund.policy.selector],
        paymentContextHash,
        functionAbis: [
          {
            selector: refund.policy.selector,
            signature: refund.policy.functionSignature
          }
        ],
        paramsMatch: {
          paymentContextHash: "0x" + "4".repeat(64)
        }
      }
    });

    assert.equal(selectorMismatch.decision, "block");
    assert.match(selectorMismatch.reason ?? "", /selector_not_allowed|function_abi_mismatch/);
    assert.equal(paramsMismatch.decision, "block");
    assert.match(paramsMismatch.reason ?? "", /params_match_failed/);
  });

  it("blocks tampered service receipts", () => {
    const challenge = makeChallenge(providerEntry, 1_800_000_000_000).normalized;
    const metadata = scanMetadata({
      resourceUrl: "https://provider.example/paid/report",
      description: "ok",
      reason: "MARKET_DATA_REQUEST"
    });
    const built = buildPaymentContext({
      missionId: "mission-1",
      providerId: providerEntry.providerId,
      quoteId: "quote-1",
      method: "GET",
      challenge,
      metadata,
      merchantAddress: providerEntry.merchantAddress,
      chainId: providerEntry.chainId,
      tokenId: providerEntry.tokenId,
      amountDecimals: 6,
      nonce: "nonce-1",
      issuedAt: 1_800_000_000_000,
      cawPactId: "pact-1",
      serviceMode: "caw-fetch"
    });
    const responseBody = { ok: true, paymentContextHash: built.paymentContextHash };
    const responseSchemaHash = guardSha256Hex("schema-v1");
    const providerResponseHash = guardSha256Hex(JSON.stringify(responseBody));
    const receipt = {
      receiptId: "receipt-1",
      paymentContextHash: built.paymentContextHash,
      cawRequestId: built.cawRequestId,
      cawWalletAddress: "0xCAW0000000000000000000000000000000000001",
      pactId: "pact-1",
      providerAddress: providerEntry.merchantAddress,
      chainId: providerEntry.chainId,
      tokenId: providerEntry.tokenId,
      amount: "5",
      providerResponseHash,
      providerSignature: signReceiptForDemo(providerEntry.publicKey, {
        paymentContextHash: built.paymentContextHash,
        providerResponseHash,
        responseSchemaHash,
        deliveryTimestamp: 1_800_000_000_000,
        status: "paid"
      }),
      responseSchemaHash,
      deliveryTimestamp: 1_800_000_000_000,
      status: "paid",
      auditLogIds: [],
      evidenceMode: "fallback"
    };

    const result = verifyServiceReceipt({
      receipt,
      responseBody: { ok: false, paymentContextHash: built.paymentContextHash },
      providerPublicKey: providerEntry.publicKey,
      expectedPaymentContextHash: built.paymentContextHash,
      expectedPactId: "pact-1",
      expectedProviderAddress: providerEntry.merchantAddress,
      expectedAmount: "5",
      expectedChainId: providerEntry.chainId,
      expectedTokenId: providerEntry.tokenId,
      responseSchemaHash
    });

    assert.equal(result.decision, "block");
    assert.match(result.reason ?? "", /responseHash/);
  });

  it("creates and verifies production-shaped dual receipts", () => {
    const resource = "https://provider.example/paid/report";
    const asset = providerEntry.tokenId;
    const deliveryTimestamp = 1_800_000_000_000;
    const providerResponseHash = guardSha256Hex(JSON.stringify({ ok: true }));
    const responseSchemaHash = guardSha256Hex("schema-v1");
    const serviceResultHash = buildServiceResultHash({
      receiptId: "receipt-dual-1",
      providerResponseHash,
      responseSchemaHash,
      resource,
      asset,
      deliveryTimestamp,
      status: "delivered"
    });
    const serviceReceipt = {
      receiptId: "receipt-dual-1",
      paymentContextHash: "0x" + "d".repeat(64),
      cawRequestId: "clear402:dual",
      cawWalletAddress: "0xCAW0000000000000000000000000000000000001",
      pactId: "pact-1",
      providerAddress: providerEntry.merchantAddress,
      resource,
      asset,
      serviceResultHash,
      cawEvidenceRef: "caw-live:receipt-dual-1",
      txHash: "0x" + "1".repeat(64),
      chainId: providerEntry.chainId,
      tokenId: providerEntry.tokenId,
      amount: "5",
      providerResponseHash,
      providerSignature: signReceiptForDemo(providerEntry.publicKey, {
        paymentContextHash: "0x" + "d".repeat(64),
        providerResponseHash,
        resource,
        asset,
        cawEvidenceRef: "caw-live:receipt-dual-1",
        serviceResultHash,
        responseSchemaHash,
        deliveryTimestamp,
        status: "delivered"
      }),
      responseSchemaHash,
      deliveryTimestamp,
      status: "delivered",
      auditLogIds: ["audit-1"],
      evidenceMode: "live"
    };
    const dualReceipt = createDualReceipt({
      serviceReceipt,
      providerPublicKey: providerEntry.publicKey,
      resource,
      cawEvidenceRef: serviceReceipt.cawEvidenceRef
    });
    const verified = verifyDualReceipt({
      dualReceipt,
      expectedPaymentContextHash: serviceReceipt.paymentContextHash,
      expectedRequestId: serviceReceipt.cawRequestId,
      expectedPactId: "pact-1",
      expectedProviderAddress: providerEntry.merchantAddress,
      expectedMerchantAddress: providerEntry.merchantAddress,
      expectedProviderPublicKey: providerEntry.publicKey,
      expectedAmount: "5",
      expectedAsset: asset,
      expectedChainId: providerEntry.chainId,
      expectedTokenId: providerEntry.tokenId,
      expectedResource: resource,
      expectedServiceResultHash: serviceResultHash,
      expectedPaymentReceiptHash: dualReceipt.paymentReceipt.paymentReceiptHash,
      expectedDeliveryReceiptHash: dualReceipt.deliveryReceipt.deliveryReceiptHash
    });
    const tampered = verifyDualReceipt({
      dualReceipt: {
        ...dualReceipt,
        paymentReceipt: {
          ...dualReceipt.paymentReceipt,
          amount: "6"
        }
      },
      expectedPaymentContextHash: serviceReceipt.paymentContextHash,
      expectedRequestId: serviceReceipt.cawRequestId,
      expectedPactId: "pact-1",
      expectedProviderAddress: providerEntry.merchantAddress,
      expectedMerchantAddress: providerEntry.merchantAddress,
      expectedProviderPublicKey: providerEntry.publicKey,
      expectedAmount: "5",
      expectedAsset: asset,
      expectedChainId: providerEntry.chainId,
      expectedTokenId: providerEntry.tokenId,
      expectedResource: resource,
      expectedServiceResultHash: serviceResultHash,
      expectedPaymentReceiptHash: dualReceipt.paymentReceipt.paymentReceiptHash,
      expectedDeliveryReceiptHash: dualReceipt.deliveryReceipt.deliveryReceiptHash
    });

    assert.equal(dualReceipt.finalStatus, "delivered");
    assert.match(dualReceipt.dualReceiptHash, /^0x[a-f0-9]{64}$/);
    assert.equal(verified.decision, "allow");
    assert.equal(tampered.decision, "block");
    assert.match(tampered.reason ?? "", /amount|dualReceiptHash/);
  });
});

describe("guard pipeline", () => {
  it("completes a guarded payment when calldata and receipt signature are separate", async () => {
    const db = makeDb();
    const scenario = makePipelineScenario("mission-allow", "100");
    const result = await runGuardPipeline(db, scenario.input);

    assert.equal(result.decision, "allow");
    assert.equal(result.status, "completed");
    assert.equal(result.receipt?.status, "delivered");
    assert.ok(
      [
        ...result.evidenceBundle.live,
        ...result.evidenceBundle.fallback,
        ...result.evidenceBundle.mock
      ].some((event) => event.id === result.guardEventId)
    );
  });

  it("blocks metadata resource overrides before PaymentContext creation", async () => {
    const db = makeDb();
    const scenario = makePipelineScenario("mission-metadata-override", "100");
    let cawCalls = 0;
    scenario.input.metadata.resourceUrl = "https://evil.example/paid/report";
    scenario.input.cawAdapter = {
      transferTokens: async () => {
        cawCalls += 1;
        throw new Error("CAW must not be called when P0 resource binding blocks");
      }
    };

    const result = await runGuardPipeline(db, scenario.input);

    assert.equal(result.decision, "block");
    assert.equal(result.status, "blocked");
    assert.match(result.reason ?? "", /Metadata resource does not match bound request resource/);
    assert.equal(result.paymentContext, undefined);
    assert.equal(result.paymentContextHash, undefined);
    assert.equal(cawCalls, 0);
  });

  it("classifies allow events by nested CAW evidence mode instead of decision", async () => {
    for (const evidenceMode of ["fallback", "mock"]) {
      const db = makeDb();
      const scenario = makePipelineScenario(`mission-allow-${evidenceMode}`, "100");
      scenario.input.cawAdapter = makePassingCawAdapter({
        evidenceMode,
        requestId: `request-${evidenceMode}`,
        txHash: `0x${evidenceMode === "fallback" ? "2" : "3".repeat(64)}`
      });
      scenario.input.providerChallenge = buildProviderChallengeForScenario({
        provider: scenario.providerEntry,
        builtContext: scenario.builtContext,
        now: 1_800_000_000_000,
        cawEvidenceRef: `caw-${evidenceMode}:request-${evidenceMode}`
      });

      const result = await runGuardPipeline(db, scenario.input);

      assert.equal(result.decision, "allow");
      const bucket = evidenceMode === "mock" ? result.evidenceBundle.mock : result.evidenceBundle.fallback;
      assert.ok(bucket.some((event) => event.id === result.guardEventId));
      assert.equal(result.evidenceBundle.live.some((event) => event.id === result.guardEventId), false);
    }
  });

  it("blocks replay on the second identical guarded payment", async () => {
    const db = makeDb();
    const scenario = makePipelineScenario("mission-replay", "100");

    const first = await runGuardPipeline(db, scenario.input);
    const second = await runGuardPipeline(db, scenario.input);

    assert.equal(first.decision, "allow");
    assert.equal(second.decision, "block");
    assert.match(second.reason ?? "", /already been reserved|duplicate/i);
  });

  it("does not allow pending CAW approval to reach receipt verification", async () => {
    const db = makeDb();
    const scenario = makePipelineScenario("mission-pending-approval", "100");
    scenario.input.cawAdapter = {
      transferTokens: async ({ requestId }) => ({
        evidenceMode: "live",
        requestId,
        walletAddress: "0xCAW0000000000000000000000000000000000001",
        auditLogId: "approval-1",
        decision: "require_approval",
        denial: {
          code: "CAW_PENDING_APPROVAL",
          reason: "owner approval required",
          details: { approvalId: "approval-1" },
          attemptedOperation: "transfer",
          paymentContextHash: scenario.builtContext.paymentContextHash,
          cawRequestId: requestId,
          auditLogId: "approval-1",
          evidenceMode: "live"
        }
      })
    };

    const result = await runGuardPipeline(db, scenario.input);

    assert.equal(result.decision, "require_approval");
    assert.equal(result.status, "prepared");
    assert.equal(result.receipt, undefined);
    assert.equal(result.cawEvidence?.denial?.code, "CAW_PENDING_APPROVAL");
  });

  it("blocks live CAW evidence missing raw transaction or audit anchors", async () => {
    const db = makeDb();
    const scenario = makePipelineScenario("mission-missing-caw-evidence", "100");
    scenario.input.cawAdapter = {
      transferTokens: async ({ requestId }) => ({
        evidenceMode: "live",
        requestId,
        walletAddress: "0xCAW0000000000000000000000000000000000001",
        decision: "allow"
      })
    };

    const result = await runGuardPipeline(db, scenario.input);

    assert.equal(result.decision, "block");
    assert.equal(result.status, "disputed");
    assert.match(result.reason ?? "", /CAW live evidence is missing/);
    assert.equal(result.receipt, undefined);
  });

  it("blocks overspend before reservation", async () => {
    const db = makeDb();
    const scenario = makePipelineScenario("mission-overspend", "0.5");
    const result = await runGuardPipeline(db, scenario.input);

    assert.equal(result.decision, "block");
    assert.match(result.reason ?? "", /Budget limit would be exceeded/);
  });

  it("selects the provider that matches the challenge providerId", async () => {
    const db = makeDb();
    const now = 1_800_000_000_000;
    const primaryProvider = makeProviderEntry();
    const secondaryProvider = makeProviderEntry({
      providerId: "provider-2",
      origin: "https://provider-two.example",
      merchantAddress: "0x4444444444444444444444444444444444444444",
      facilitatorUrl: "https://fac-two.example",
      publicKey: "pk_provider_2",
      erc8004AgentId: "agent-2",
      erc8004AgentUri: "https://provider-two.example/paid/report"
    });
    const challenge = makeChallenge(secondaryProvider, now);
    const metadata = scanMetadata({
      resourceUrl: "https://provider-two.example/paid/report",
      description: "ok",
      reason: "MARKET_DATA_REQUEST"
    });
    const builtContext = buildPaymentContext({
      missionId: "mission-two-provider",
      providerId: secondaryProvider.providerId,
      quoteId: "quote_mission-two-provider_provider-2",
      method: "GET",
      challenge: challenge.normalized,
      metadata,
      merchantAddress: secondaryProvider.merchantAddress,
      chainId: secondaryProvider.chainId,
      tokenId: secondaryProvider.tokenId,
      amountDecimals: 6,
      nonce: "nonce_mission-two-provider_provider-2",
      issuedAt: now,
      cawPactId: "pact-2",
      serviceMode: "caw-fetch"
    });
    const responseBody = { ok: true, paymentContextHash: builtContext.paymentContextHash };
    const responseSchemaHash = guardSha256Hex("schema-v1");
    const providerResponseHash = guardSha256Hex(JSON.stringify(responseBody));

    const result = await runGuardPipeline(db, {
      missionId: "mission-two-provider",
      providerRegistryEntries: [primaryProvider, secondaryProvider],
      trustRecords: [
        {
          agentId: secondaryProvider.erc8004AgentId,
          agentUri: secondaryProvider.erc8004AgentUri,
          payTo: secondaryProvider.merchantAddress,
          reputationScore: 95,
          deliverySuccessRate: 0.99,
          identityVerified: true,
          validationAttestations: []
        }
      ],
      erc8004LiveSource: {
        source: "registry_contract",
        status: "verified",
        record: {
          agentId: secondaryProvider.erc8004AgentId,
          agentUri: secondaryProvider.erc8004AgentUri,
          payTo: secondaryProvider.merchantAddress,
          reputationScore: 95,
          deliverySuccessRate: 0.99,
          identityVerified: true,
          validationAttestations: []
        }
      },
      challenge: challenge.rawChallenge,
      request: {
        method: "GET",
        url: "https://provider-two.example/paid/report",
        body: undefined,
        headers: {},
        boundHeaders: []
      },
      metadata: {
        resourceUrl: "https://provider-two.example/paid/report",
        description: "ok",
        reason: "MARKET_DATA_REQUEST"
      },
      budgetLimitUsd: "10",
      reservedBudgetUsd: "1",
      amountDecimals: 6,
      cawPactId: "pact-2",
      serviceMode: "caw-fetch",
      cawAdapter: {
        transferTokens: async ({ requestId, missionId: currentMissionId }) => ({
          evidenceMode: "live",
          requestId,
          walletAddress: "0xCAW0000000000000000000000000000000000001",
          txHash: "0x" + "2".repeat(64),
          auditLogId: `audit-${currentMissionId}`,
          rawEvidenceRef: `caw-live:${currentMissionId}`
        })
      },
      now,
      providerChallenge: {
        providerCalldata: encodeTransferCalldata(secondaryProvider.merchantAddress, "5"),
        providerSignature: signReceiptForDemo(secondaryProvider.publicKey, {
          paymentContextHash: builtContext.paymentContextHash,
          providerResponseHash,
          resource: "https://provider-two.example/paid/report",
          asset: "0x0000000000000000000000000000000000000001",
          cawEvidenceRef: "caw-live:mission-two-provider",
          serviceResultHash: buildServiceResultHash({
            receiptId: `receipt_${builtContext.paymentContextHash.slice(2, 18)}`,
            providerResponseHash,
            responseSchemaHash,
            resource: "https://provider-two.example/paid/report",
            asset: "0x0000000000000000000000000000000000000001",
            deliveryTimestamp: now,
            status: "paid"
          }),
          responseSchemaHash,
          deliveryTimestamp: now,
          status: "paid"
        }),
        responseBody,
        providerAddress: secondaryProvider.merchantAddress,
        providerPublicKey: secondaryProvider.publicKey,
        responseSchemaHash,
        auditLogIds: ["audit-2"]
      }
    });

    assert.equal(result.decision, "allow");
    assert.equal(result.providerRegistryResult?.providerId, secondaryProvider.providerId);
  });

  it("prepares ServiceEscrow contract_call calldata and keeps fallback_required without live CAW evidence", async () => {
    const db = makeDb();
    const scenario = makePipelineScenario("mission-service-escrow", "100", {
      serviceMode: "escrowed-delivery",
      paymentOperation: "contract_call"
    });
    let cawCall;
    scenario.input.providerChallenge.serviceEscrowAddress =
      "0x3333333333333333333333333333333333333333";
    scenario.input.cawAdapter = {
      transferTokens: async () => {
        throw new Error("escrowed contract_call must not use transferTokens");
      },
      contractCall: async (input) => {
        cawCall = input;
        return {
          evidenceMode: "fallback",
          requestId: input.requestId,
          walletAddress: "unavailable",
          decision: "fallback_required",
          denial: {
            code: "CAW_CONTRACT_CALL_NOT_CONFIGURED_FOR_TEST",
            reason: "contract_call live CAW evidence is not configured in this test.",
            details: {
              contractAddress: input.contractAddress,
              calldata: input.calldata
            },
            attemptedOperation: "contract_call",
            paymentContextHash: input.paymentContextHash,
            cawRequestId: input.requestId,
            evidenceMode: "fallback"
          }
        };
      }
    };

    const result = await runGuardPipeline(db, scenario.input);

    assert.equal(result.decision, "fallback_required");
    assert.equal(cawCall.contractAddress, "0x3333333333333333333333333333333333333333");
    assert.equal(cawCall.calldata.slice(0, 10), "0xf8388f0f");
    assert.equal(
      cawCall.amount,
      serviceEscrowAmountFromPaymentContext(
        result.paymentContext.amount,
        result.paymentContext.amountDecimals
      )
    );
    assert.equal(result.clearsig.decision, "allow");
    assert.equal(result.clearsig.decodedParams.paymentContextHash, result.paymentContextHash);
    assert.equal(result.clearsig.decodedParams.provider, scenario.providerEntry.merchantAddress);
  });

  it("stops the guard with fallback_required when live ERC-8004 trust needs registration", async () => {
    const db = makeDb();
    const scenario = makePipelineScenario("mission-erc8004-needs-registration", "10");
    scenario.input.trustRecords = [];
    delete scenario.input.erc8004LiveSource;

    const result = await runGuardPipeline(db, scenario.input);

    assert.equal(result.decision, "fallback_required");
    assert.equal(result.status, "blocked");
    assert.equal(result.trustResult.trustSource, "unavailable");
    assert.equal(result.trustResult.registrationStatus, "needs_registration");
    assert.equal(result.trustResult.evidenceMode, "fallback");
    assert.equal(result.evidenceBundle.live.length, 0);
    assert.equal(result.evidenceBundle.fallback.length, 1);
    assert.equal(result.evidenceBundle.fallback[0].layer, "erc8004");
    assert.match(result.reason ?? "", /live ERC-8004 identity/);
  });
});

function makeProviderEntry(overrides = {}) {
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

function buildProviderChallengeForScenario(input) {
  const responseBody = { ok: true, paymentContextHash: input.builtContext.paymentContextHash };
  const responseSchemaHash = guardSha256Hex("schema-v1");
  const providerResponseHash = guardSha256Hex(JSON.stringify(responseBody));
  const asset = "0x0000000000000000000000000000000000000001";
  const serviceResultHash = buildServiceResultHash({
    receiptId: `receipt_${input.builtContext.paymentContextHash.slice(2, 18)}`,
    providerResponseHash,
    responseSchemaHash,
    resource: `${input.provider.origin}/paid/report`,
    asset,
    deliveryTimestamp: input.now,
    status: "paid"
  });
  const cawEvidenceRef =
    input.cawEvidenceRef ?? `caw-fallback:${input.builtContext.paymentContextHash.slice(2, 18)}`;

  return {
    providerCalldata: encodeTransferCalldata(input.provider.merchantAddress, "5"),
    providerSignature: signReceiptForDemo(input.provider.publicKey, {
      paymentContextHash: input.builtContext.paymentContextHash,
      providerResponseHash,
      resource: `${input.provider.origin}/paid/report`,
      asset,
      cawEvidenceRef,
      ...(input.fallbackEvidenceRef !== undefined ? { fallbackEvidenceRef: input.fallbackEvidenceRef } : {}),
      serviceResultHash,
      responseSchemaHash,
      deliveryTimestamp: input.now,
      status: "paid"
    }),
    responseBody,
    providerAddress: input.provider.merchantAddress,
    providerPublicKey: input.provider.publicKey,
    responseSchemaHash,
    auditLogIds: ["audit-1"]
  };
}

function makeChallenge(providerEntry, now) {
  const rawChallenge = {
    accepts: [
      {
        scheme: "exact",
        network: "base-sepolia",
        asset: "0x0000000000000000000000000000000000000001",
        amount: "5",
        payTo: providerEntry.merchantAddress,
        resource: new URL("/paid/report", providerEntry.origin).toString(),
        facilitatorUrl: providerEntry.facilitatorUrl,
        description: "guard test",
        expiresAt: now + 60_000
      }
    ]
  };

  return {
    rawChallenge,
    normalized: normalizeX402Challenge({
      providerId: providerEntry.providerId,
      rawChallenge,
      now,
      evidenceMode: "live"
    })
  };
}

function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
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
  return db;
}

function makePipelineScenario(missionId, budgetLimitUsd, overrides = {}) {
  const now = 1_800_000_000_000;
  const providerEntry = makeProviderEntry();
  const challenge = makeChallenge(providerEntry, now);
  const metadata = scanMetadata({
    resourceUrl: "https://provider.example/paid/report",
    description: "ok",
    reason: "MARKET_DATA_REQUEST"
  });
  const builtContext = buildPaymentContext({
    missionId,
    providerId: providerEntry.providerId,
    quoteId: `quote_${missionId}_${providerEntry.providerId}`,
    method: "GET",
    challenge: challenge.normalized,
    metadata,
    merchantAddress: providerEntry.merchantAddress,
    chainId: providerEntry.chainId,
    tokenId: providerEntry.tokenId,
    amountDecimals: 6,
    nonce: `nonce_${missionId}_${providerEntry.providerId}`,
    issuedAt: now,
    cawPactId: "pact-1",
    serviceMode: overrides.serviceMode ?? "caw-fetch",
    ...(overrides.paymentOperation !== undefined
      ? { operation: overrides.paymentOperation }
      : {})
  });

  const responseBody = { ok: true, paymentContextHash: builtContext.paymentContextHash };
  const responseSchemaHash = guardSha256Hex("schema-v1");
  const providerResponseHash = guardSha256Hex(JSON.stringify(responseBody));
  const resource = "https://provider.example/paid/report";
  const asset = "0x0000000000000000000000000000000000000001";
  const cawEvidenceRef = `caw-live:${missionId}`;
  const serviceResultHash = buildServiceResultHash({
    receiptId: `receipt_${builtContext.paymentContextHash.slice(2, 18)}`,
    providerResponseHash,
    responseSchemaHash,
    resource,
    asset,
    deliveryTimestamp: now,
    status: "paid"
  });

  return {
    input: {
      missionId,
    providerRegistryEntries: [providerEntry],
    trustRecords: [
        {
          agentId: providerEntry.erc8004AgentId,
          agentUri: providerEntry.erc8004AgentUri,
          payTo: providerEntry.merchantAddress,
          reputationScore: 95,
          deliverySuccessRate: 0.99,
          identityVerified: true,
          validationAttestations: []
        }
      ],
      erc8004LiveSource: {
        source: "registry_contract",
        status: "verified",
        record: {
          agentId: providerEntry.erc8004AgentId,
          agentUri: providerEntry.erc8004AgentUri,
          payTo: providerEntry.merchantAddress,
          reputationScore: 95,
          deliverySuccessRate: 0.99,
          identityVerified: true,
          validationAttestations: []
        }
      },
      challenge: challenge.rawChallenge,
      request: {
        method: "GET",
        url: "https://provider.example/paid/report",
        body: undefined,
        headers: {},
        boundHeaders: []
      },
      metadata: {
        resourceUrl: "https://provider.example/paid/report",
        description: "ok",
        reason: "MARKET_DATA_REQUEST"
      },
      budgetLimitUsd,
      reservedBudgetUsd: "1",
      amountDecimals: 6,
      cawPactId: "pact-1",
      serviceMode: overrides.serviceMode ?? "caw-fetch",
      ...(overrides.paymentOperation !== undefined
        ? { paymentOperation: overrides.paymentOperation }
        : {}),
      cawAdapter: {
        transferTokens: async ({ requestId, missionId: currentMissionId }) => ({
          evidenceMode: "live",
          requestId,
          walletAddress: "0xCAW0000000000000000000000000000000000001",
          txHash: "0x" + "1".repeat(64),
          auditLogId: `audit-${currentMissionId}`,
          rawEvidenceRef: `caw-live:${currentMissionId}`
        })
      },
      now,
      providerChallenge: {
        providerCalldata: encodeTransferCalldata(providerEntry.merchantAddress, "5"),
        providerSignature: signReceiptForDemo(providerEntry.publicKey, {
          paymentContextHash: builtContext.paymentContextHash,
          providerResponseHash,
          resource,
          asset,
          cawEvidenceRef,
          serviceResultHash,
          responseSchemaHash,
          deliveryTimestamp: now,
          status: "paid"
        }),
        responseBody,
        providerAddress: providerEntry.merchantAddress,
        providerPublicKey: providerEntry.publicKey,
        responseSchemaHash,
        auditLogIds: ["audit-1"]
      }
    },
    providerEntry,
    builtContext
  };
}

function encodeTransferCalldata(to, amount) {
  const address = to.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const value = BigInt(amount).toString(16).padStart(64, "0");
  return `0xa9059cbb${address}${value}`;
}

function makePassingCawAdapter({ evidenceMode, requestId, txHash }) {
  return {
    transferTokens: async () => ({
      evidenceMode,
      requestId,
      walletAddress: "0xCAW0000000000000000000000000000000000001",
      txHash,
      auditLogId: `audit-${requestId}`,
      rawEvidenceRef: `caw-${evidenceMode}:${requestId}`,
      decision: "allow"
    })
  };
}

function signPipelineProviderChallenge(providerPublicKey, builtContext, cawEvidenceRef, now) {
  const providerResponseHash = guardSha256Hex(
    JSON.stringify({ ok: true, paymentContextHash: builtContext.paymentContextHash })
  );
  const responseSchemaHash = guardSha256Hex("schema-v1");
  const resource = "https://provider.example/paid/report";
  const asset = "0x0000000000000000000000000000000000000001";
  return signReceiptForDemo(providerPublicKey, {
    paymentContextHash: builtContext.paymentContextHash,
    providerResponseHash,
    resource,
    asset,
    cawEvidenceRef,
    serviceResultHash: buildServiceResultHash({
      receiptId: `receipt_${builtContext.paymentContextHash.slice(2, 18)}`,
      providerResponseHash,
      responseSchemaHash,
      resource,
      asset,
      deliveryTimestamp: now,
      status: "paid"
    }),
    responseSchemaHash,
    deliveryTimestamp: now,
    status: "paid"
  });
}
