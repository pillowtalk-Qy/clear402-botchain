import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import {
  createDebugChallenge,
  createDebugPaymentHeader,
  createProviderChallenge,
  createProviderServer,
  createProviderState,
  verifyPaymentProof
} from "../src/index.mjs";
import { DEFAULT_PROVIDER_CONFIG } from "../src/config.mjs";

describe("provider-x402 challenge handling", () => {
  it("normalizes an x402 challenge without converting the amount to a number", () => {
    const challenge = createProviderChallenge({
      issuedAt: 1_800_000_000_000,
      resourceUrl: "http://localhost:4010/paid/report"
    });

    assert.equal(challenge.normalized.providerId, DEFAULT_PROVIDER_CONFIG.providerId);
    assert.equal(challenge.normalized.amount, DEFAULT_PROVIDER_CONFIG.amount);
    assert.equal(typeof challenge.normalized.amount, "string");
    assert.equal(challenge.normalized.evidenceMode, "live");
    assert.equal(challenge.normalized.resource, "http://localhost:4010/paid/report");
    assert.match(challenge.normalized.rawChallengeHash, /^[a-f0-9]{64}$/);
  });

  it("keeps the deterministic debug challenge explicitly labeled as fallback", () => {
    const first = createDebugChallenge({
      baseUrl: "http://localhost:4010",
      issuedAt: 1_800_000_000_000
    });
    const second = createDebugChallenge({
      baseUrl: "http://localhost:4010",
      issuedAt: 1_800_000_000_000
    });

    assert.deepEqual(first, second);
    assert.equal(first.normalized.evidenceMode, "fallback");
  });

  it("binds verification to the issued challenge hash", () => {
    const challenge = createDebugChallenge({
      baseUrl: "http://localhost:4010",
      issuedAt: 1_800_000_000_000
    });
    const paymentHeader = createDebugPaymentHeader(challenge, { issuedAt: 1_800_000_000_000 });
    const accepted = verifyPaymentProof(paymentHeader, challenge, {
      now: challenge.normalized.expiresAt - 1
    });

    assert.equal(accepted.ok, true);
    assert.equal(accepted.evidenceMode, "fallback");

    const otherChallenge = createProviderChallenge({
      issuedAt: 1_800_000_000_000,
      resourceUrl: "http://localhost:4010/paid/other"
    });
    const denied = verifyPaymentProof(paymentHeader, otherChallenge, {
      now: challenge.normalized.expiresAt - 1
    });

    assert.equal(denied.ok, false);
    assert.match(denied.failures.join(","), /challenge_hash_mismatch/);
  });
});

describe("provider-x402 HTTP service", () => {
  let server;
  let baseUrl;

  before(async () => {
    server = createProviderServer({
      state: createProviderState(),
      clock: () => 1_800_000_000_000
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    server.close();
    await once(server, "close");
  });

  it("returns a real local provider 402 challenge for the paid report", async () => {
    const response = await fetch(`${baseUrl}/paid/report`);
    const body = await response.json();

    assert.equal(response.status, 402);
    assert.equal(body.code, "PAYMENT_REQUIRED");
    assert.equal(body.details.normalized.evidenceMode, "live");
    assert.equal(body.details.normalized.resource, `${baseUrl}/paid/report`);
    assert.equal(response.headers.get("x-clear402-challenge-hash"), body.details.normalized.rawChallengeHash);
    assert.ok(body.details.fallbackDebugPaymentHeader);
  });

  it("returns a delivered receipt only after verifying the payment proof against the issued challenge", async () => {
    const challengeResponse = await fetch(`${baseUrl}/paid/report`);
    const challengeBody = await challengeResponse.json();
    const paymentHeader = challengeBody.details.fallbackDebugPaymentHeader;

    const paidResponse = await fetch(`${baseUrl}/paid/report`, {
      headers: {
        "x-clear402-payment": paymentHeader
      }
    });
    const paidBody = await paidResponse.json();

    assert.equal(paidResponse.status, 200);
    assert.equal(paidBody.receipt.status, "delivered");
    assert.equal(paidBody.receipt.evidenceMode, "fallback");
    assert.equal(paidBody.receipt.providerResponseHash.length, 64);
    assert.equal(paidBody.report.challengeHash, challengeBody.details.normalized.rawChallengeHash);
  });

  it("verifies payment through the public provider verification endpoint", async () => {
    const challengeResponse = await fetch(`${baseUrl}/paid/report`);
    const challengeBody = await challengeResponse.json();
    const verificationResponse = await fetch(`${baseUrl}/verify-payment`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        challengeHash: challengeBody.details.normalized.rawChallengeHash,
        paymentHeader: challengeBody.details.fallbackDebugPaymentHeader
      })
    });
    const verificationBody = await verificationResponse.json();

    assert.equal(verificationResponse.status, 200);
    assert.equal(verificationBody.ok, true);
    assert.equal(verificationBody.decision, "allow");
    assert.equal(verificationBody.challengeHash, challengeBody.details.normalized.rawChallengeHash);
    assert.equal(verificationBody.receipt.status, "delivered");
    assert.equal(verificationBody.evidenceMode, "fallback");
  });

  it("serves a substitution attack fixture for Guard and Attack Lab replay", async () => {
    const response = await fetch(`${baseUrl}/attack-fixtures/substitution`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.version, "clear402.attack_fixture.v1");
    assert.equal(body.name, "substitution");
    assert.equal(body.evidenceMode, "mock");
    assert.equal(body.expected.decision, "block");
    assert.equal(body.substituted.verificationRequest.paymentHeader, body.original.paymentHeader);
  });

  it("blocks the substitution fixture through the public verification endpoint", async () => {
    const fixtureResponse = await fetch(`${baseUrl}/attack-fixtures/substitution`);
    const fixture = await fixtureResponse.json();
    const response = await fetch(`${baseUrl}/verify-payment`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(fixture.substituted.verificationRequest)
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.decision, "block");
    assert.equal(body.verification.reason, "payment_verification_failed");
    assert.match(body.verification.failures.join(","), /challenge_hash_mismatch/);
    assert.match(body.verification.failures.join(","), /amount_mismatch/);
  });

  it("does not let an invalid proof choose a delivered status", async () => {
    const response = await fetch(`${baseUrl}/paid/report`, {
      headers: {
        "x-clear402-payment": Buffer.from(JSON.stringify({
          version: "clear402.debug-payment.v1",
          challengeHash: "not-issued",
          status: "delivered"
        })).toString("base64url")
      }
    });
    const body = await response.json();

    assert.equal(response.status, 402);
    assert.equal(body.code, "PAYMENT_REQUIRED");
    assert.equal(body.details.verification.ok, false);
    assert.equal(body.details.normalized.evidenceMode, "live");
  });
});
