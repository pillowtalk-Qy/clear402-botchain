import { afterAll, describe, expect, test } from "vitest";

import { healthResponseSchema } from "../../../packages/shared/src/index.js";
import { startProviderServer } from "./server.js";

describe("provider-x402", () => {
  test("serves health JSON", async () => {
    const server = await startProviderServer({
      host: "127.0.0.1",
      port: 0
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(response.ok).toBe(true);

      const payload = healthResponseSchema.parse(await response.json());
      expect(payload.service).toBe("provider-x402");
      expect(payload.evidenceMode).toBe("live");
      expect(payload.details?.protocol).toBe("x402");
    } finally {
      await server.close();
    }
  });

  test("serves the paid report challenge through the dev entrypoint", async () => {
    const server = await startProviderServer({
      host: "127.0.0.1",
      port: 0
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/paid/report`);
      expect(response.status).toBe(402);
      expect(response.headers.get("x-clear402-challenge-hash")).toMatch(/^[a-f0-9]{64}$/);

      const body = (await response.json()) as any;
      expect(body.code).toBe("PAYMENT_REQUIRED");
      expect(body.details.normalized.evidenceMode).toBe("live");
      expect(body.details.normalized.resource).toBe(`http://127.0.0.1:${server.port}/paid/report`);
      expect(body.details.fallbackDebugPaymentHeader).toBeDefined();
    } finally {
      await server.close();
    }
  });

  test("serves the payment gateway with signed quote and receipt", async () => {
    const server = await startProviderServer({
      host: "127.0.0.1",
      port: 0
    });

    try {
      const challengeResponse = await fetch(`http://127.0.0.1:${server.port}/debug/challenge`);
      const challengeBody = (await challengeResponse.json()) as any;

      const gatewayResponse = await fetch(`http://127.0.0.1:${server.port}/gateway/payment`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-clear402-payment": challengeBody.debugPaymentHeader
        },
        body: JSON.stringify({
          paymentContextHash: "0x" + "a".repeat(64)
        })
      });

      expect(gatewayResponse.status).toBe(200);
      const body = (await gatewayResponse.json()) as any;
      expect(body.gateway).toBe("clear402.local.payment_gateway.v1");
      expect(body.signedQuote.signature).toMatch(/^hmac-sha256:/);
      expect(body.receipt.providerSignature.length).toBeGreaterThan(20);
      expect(body.evidenceMode).toBeDefined();
    } finally {
      await server.close();
    }
  });
});
