import { createServer } from "node:http";
import { createProblem, normalizeX402Challenge } from "../../../packages/shared/src/index.mjs";
import { createAttackFixture } from "./attack-fixtures.mjs";
import { createDebugChallenge, createProviderChallenge, requestResourceUrl } from "./challenge.mjs";
import { DEFAULT_PROVIDER_CONFIG } from "./config.mjs";
import { createDebugPaymentHeader, decodePaymentHeader, verifyPaymentProof } from "./payment-proof.mjs";
import { createPaidReport, createServiceReceipt, createSignedProviderQuote } from "./receipt.mjs";

export function createProviderState() {
  return {
    issuedChallenges: new Map()
  };
}

export function createProviderHttpHandler({
  config = DEFAULT_PROVIDER_CONFIG,
  state = createProviderState(),
  clock = () => Date.now()
} = {}) {
  return async function handleProviderRequest(request, response) {
    const url = new URL(request.url, config.origin);
    const requestId = `req_${clock().toString(36)}`;

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return sendJson(response, 200, {
          service: "provider-x402",
          status: "ok",
          providerId: config.providerId,
          evidenceMode: "live"
        });
      }

      if (request.method === "GET" && url.pathname === "/debug/challenge") {
        const resourcePath = url.searchParams.get("resourcePath") ?? "/paid/report";
        const challenge = createDebugChallenge({
          baseUrl: originFromRequest(request, config),
          config,
          resourcePath,
          issuedAt: clock()
        });
        rememberChallenge(state, challenge);

        return sendJson(response, 200, {
          challenge: challenge.rawChallenge,
          normalized: challenge.normalized,
          debugPaymentHeader: createDebugPaymentHeader(challenge, {
            config,
            issuedAt: clock()
          }),
          substitution: "deterministic local debug challenge",
          evidenceMode: "fallback"
        });
      }

      if (request.method === "GET" && url.pathname === "/paid/report") {
        return handlePaidReport({ request, response, requestId, config, state, clock });
      }

      if (request.method === "POST" && url.pathname === "/verify-payment") {
        const body = await readJsonBody(request);

        return handleVerifyPayment({
          request,
          response,
          body,
          requestId,
          config,
          state,
          clock
        });
      }

      if (request.method === "POST" && url.pathname === "/debug/verify") {
        const body = await readJsonBody(request);

        return handleVerifyPayment({
          request,
          response,
          body,
          requestId,
          config,
          state,
          clock
        });
      }

      if (request.method === "POST" && url.pathname === "/gateway/payment") {
        const body = await readJsonBody(request);

        return handleGatewayPayment({
          request,
          response,
          body,
          requestId,
          config,
          state,
          clock
        });
      }

      if (request.method === "GET" && url.pathname.startsWith("/attack-fixtures/")) {
        const name = decodeURIComponent(url.pathname.slice("/attack-fixtures/".length));
        const fixture = createAttackFixture(name, {
          baseUrl: originFromRequest(request, config),
          config,
          issuedAt: clock()
        });

        if (!fixture) {
          return sendJson(response, 404, createProblem("ATTACK_FIXTURE_NOT_FOUND", "Attack fixture not found.", {
            name
          }, requestId));
        }

        return sendJson(response, 200, fixture);
      }

      return sendJson(response, 404, createProblem("NOT_FOUND", "Route not found", {
        method: request.method,
        path: url.pathname
      }, requestId));
    } catch (error) {
      return sendJson(response, 500, createProblem("PROVIDER_INTERNAL_ERROR", "Provider request failed", {
        error: error instanceof Error ? error.message : String(error)
      }, requestId));
    }
  };
}

export function createProviderServer(options = {}) {
  return createServer(createProviderHttpHandler(options));
}

function handleGatewayPayment({ request, response, body, requestId, config, state, clock }) {
  const paymentHeader = paymentHeaderFromRequest(request, body);
  const decoded = decodePaymentHeader(paymentHeader);
  const challenge = decoded.ok
    ? resolveChallengeForVerification({ body, proof: decoded.proof, request, config, state })
    : undefined;
  const verification = challenge
    ? verifyPaymentProof(paymentHeader, challenge, { config, now: clock() })
    : {
        ok: false,
        reason: decoded.reason ?? "unknown_challenge",
        ...(decoded.proof?.challengeHash ? { challengeHash: decoded.proof.challengeHash } : {})
      };

  if (!verification.ok) {
    return sendJson(response, 402, {
      ok: false,
      decision: "block",
      providerId: config.providerId,
      verification,
      evidenceMode: "fallback",
      requestId
    });
  }

  const signedQuote = createSignedProviderQuote({
    challenge,
    config,
    issuedAt: clock(),
    paymentContextHash: body?.paymentContextHash
  });
  const gatewayResponse = {
    ok: true,
    gateway: "clear402.local.payment_gateway.v1",
    providerId: config.providerId,
    challengeHash: challenge.normalized.rawChallengeHash,
    verification,
    signedQuote,
    evidenceMode: verification.evidenceMode,
    requestId
  };
  const receipt = createServiceReceipt({
    challenge,
    verification,
    providerResponse: gatewayResponse,
    config,
    deliveredAt: clock()
  });

  return sendJson(response, 200, {
    ...gatewayResponse,
    receipt
  });
}

function handleVerifyPayment({ request, response, body, requestId, config, state, clock }) {
  const paymentHeader = paymentHeaderFromRequest(request, body);
  const decoded = decodePaymentHeader(paymentHeader);
  const challenge = decoded.ok
    ? resolveChallengeForVerification({ body, proof: decoded.proof, request, config, state })
    : undefined;
  const verification = challenge
    ? verifyPaymentProof(paymentHeader, challenge, { config, now: clock() })
    : {
        ok: false,
        reason: decoded.reason ?? "unknown_challenge",
        ...(decoded.proof?.challengeHash ? { challengeHash: decoded.proof.challengeHash } : {})
      };

  if (!verification.ok) {
    return sendJson(response, 400, {
      ok: false,
      decision: "block",
      providerId: config.providerId,
      verification,
      evidenceMode: "fallback",
      requestId
    });
  }

  const providerResponse = {
    verification: {
      ok: true,
      challengeHash: challenge.normalized.rawChallengeHash,
      settlementMode: verification.settlementMode
    }
  };
  const receipt = createServiceReceipt({
    challenge,
    verification,
    providerResponse,
    config,
    deliveredAt: clock()
  });

  return sendJson(response, 200, {
    ok: true,
    decision: "allow",
    providerId: config.providerId,
    challengeHash: challenge.normalized.rawChallengeHash,
    normalized: challenge.normalized,
    verification,
    receipt,
    evidenceMode: verification.evidenceMode,
    requestId
  });
}

function handlePaidReport({ request, response, requestId, config, state, clock }) {
  const paymentHeader = request.headers["x-clear402-payment"];
  const decoded = decodePaymentHeader(paymentHeader);
  const challenge = decoded.ok
    ? resolveChallengeForProof(decoded.proof, request, config, state)
    : undefined;
  const verification = challenge
    ? verifyPaymentProof(paymentHeader, challenge, { config, now: clock() })
    : { ok: false, reason: decoded.reason ?? "unknown_challenge" };

  if (verification.ok) {
    const report = createPaidReport({
      challenge,
      verification,
      generatedAt: clock()
    });
    const receipt = createServiceReceipt({
      challenge,
      verification,
      providerResponse: report,
      config,
      deliveredAt: clock()
    });

    return sendJson(response, 200, {
      report,
      receipt,
      evidenceMode: receipt.evidenceMode
    });
  }

  const issuedChallenge = createProviderChallenge({
    config,
    evidenceMode: "live",
    issuedAt: clock(),
    resourceUrl: requestResourceUrl(request, config)
  });
  rememberChallenge(state, issuedChallenge);

  response.setHeader("X-Clear402-Challenge-Hash", issuedChallenge.normalized.rawChallengeHash);
  response.setHeader("WWW-Authenticate", `x402 challenge="${issuedChallenge.normalized.rawChallengeHash}"`);

  return sendJson(response, 402, createProblem("PAYMENT_REQUIRED", "Payment required by local x402 provider.", {
    challenge: issuedChallenge.rawChallenge,
    normalized: issuedChallenge.normalized,
    verification,
    fallbackDebugPaymentHeader: createDebugPaymentHeader(issuedChallenge, {
      config,
      issuedAt: clock()
    })
  }, requestId));
}

function resolveChallengeForProof(proof, request, config, state) {
  if (state.issuedChallenges.has(proof.challengeHash)) {
    return state.issuedChallenges.get(proof.challengeHash);
  }

  const debugChallenge = createDebugChallenge({
    baseUrl: originFromRequest(request, config),
    config,
    resourcePath: "/paid/report"
  });

  if (debugChallenge.normalized.rawChallengeHash === proof.challengeHash) {
    rememberChallenge(state, debugChallenge);
    return debugChallenge;
  }

  return undefined;
}

function resolveChallengeForVerification({ body, proof, request, config, state }) {
  const bodyChallenge = challengeFromBody(body, config);

  if (bodyChallenge) {
    rememberChallenge(state, bodyChallenge);
    return bodyChallenge;
  }

  if (proof?.challengeHash && state.issuedChallenges.has(proof.challengeHash)) {
    return state.issuedChallenges.get(proof.challengeHash);
  }

  return resolveChallengeForProof(proof, request, config, state);
}

function challengeFromBody(body, config) {
  const rawChallenge = body?.challenge ?? body?.rawChallenge;
  const normalized = body?.normalized ?? body?.normalizedChallenge;

  if (rawChallenge) {
    const normalizedChallenge = normalizeX402Challenge(rawChallenge, {
      evidenceMode: rawChallenge.paymentRequirements?.extra?.evidenceMode ?? normalized?.evidenceMode,
      providerId: rawChallenge.paymentRequirements?.extra?.providerId ?? normalized?.providerId,
      expiresAt: rawChallenge.paymentRequirements?.expiresAt ?? normalized?.expiresAt
    });

    return {
      rawChallenge,
      normalized: normalizedChallenge
    };
  }

  if (normalized?.rawChallengeHash) {
    return {
      rawChallenge: normalized,
      normalized
    };
  }

  return undefined;
}

function paymentHeaderFromRequest(request, body) {
  return body?.paymentHeader
    ?? body?.debugPaymentHeader
    ?? request.headers["x-clear402-payment"];
}

function rememberChallenge(state, challenge) {
  state.issuedChallenges.set(challenge.normalized.rawChallengeHash, challenge);
}

function originFromRequest(request, config) {
  const host = request.headers.host ?? new URL(config.origin).host;
  const protocol = request.headers["x-forwarded-proto"] ?? "http";

  return `${protocol}://${host}`;
}

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body, null, 2);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload)
  });
  response.end(payload);
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
