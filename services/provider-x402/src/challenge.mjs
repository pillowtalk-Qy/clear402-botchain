import { normalizeX402Challenge } from "../../../packages/shared/src/index.mjs";
import { DEFAULT_PROVIDER_CONFIG } from "./config.mjs";

export function createProviderChallenge({
  config = DEFAULT_PROVIDER_CONFIG,
  evidenceMode = "live",
  issuedAt = Date.now(),
  resourceUrl,
  description = "Clear402 paid report"
} = {}) {
  const expiresAt = issuedAt + config.challengeTtlMs;
  const rawChallenge = {
    x402Version: 1,
    paymentRequirements: {
      scheme: "exact",
      network: config.network,
      maxAmountRequired: config.amount,
      resource: resourceUrl,
      description,
      mimeType: "application/json",
      payTo: config.merchantAddress,
      maxTimeoutSeconds: Math.floor(config.challengeTtlMs / 1000),
      asset: config.asset,
      facilitator: {
        url: config.facilitatorUrl
      },
      expiresAt,
      extra: {
        providerId: config.providerId,
        chainId: config.chainId,
        tokenId: config.tokenId,
        evidenceMode,
        issuedAt
      }
    }
  };

  return {
    rawChallenge,
    normalized: normalizeX402Challenge(rawChallenge, {
      evidenceMode,
      providerId: config.providerId,
      expiresAt
    })
  };
}

export function createDebugChallenge({
  baseUrl = DEFAULT_PROVIDER_CONFIG.origin,
  config = DEFAULT_PROVIDER_CONFIG,
  resourcePath = "/paid/report",
  issuedAt = Date.now()
} = {}) {
  return createProviderChallenge({
    config,
    evidenceMode: "fallback",
    issuedAt,
    resourceUrl: new URL(resourcePath, baseUrl).toString(),
    description: "Deterministic local debug challenge for Clear402 provider development"
  });
}

export function requestResourceUrl(request, config = DEFAULT_PROVIDER_CONFIG) {
  const host = request.headers.host ?? new URL(config.origin).host;
  const protocol = request.headers["x-forwarded-proto"] ?? "http";
  const path = new URL(request.url, `${protocol}://${host}`).pathname;

  return `${protocol}://${host}${path}`;
}
