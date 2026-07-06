import type { ProviderRegistryEntry } from "../../../../packages/shared/src/index.mjs";

export interface ProviderRegistryValidationInput {
  entries: ProviderRegistryEntry[];
  providerId?: string;
  origin: string;
  resourcePath: string;
  payTo: string;
  facilitatorUrl?: string;
  chainId: string;
  tokenId: string;
  cawAllowedMerchantAddresses?: string[];
}

export interface ProviderRegistryValidationResult {
  decision: "allow" | "require_approval" | "block";
  providerId?: string;
  reason?: string;
  entry?: ProviderRegistryEntry;
  checks: Record<string, boolean>;
  evidenceMode: "live" | "fallback" | "mock";
}

function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  return url.origin.toLowerCase();
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}

function resourceAllowed(resourcePath: string, allowedResources: string[]): boolean {
  return allowedResources.some((allowed) => {
    if (allowed.endsWith("*")) {
      return resourcePath.startsWith(allowed.slice(0, -1));
    }

    return resourcePath === allowed;
  });
}

export function validateProviderRegistry(
  input: ProviderRegistryValidationInput
): ProviderRegistryValidationResult {
  let origin: string;

  try {
    origin = normalizeOrigin(input.origin);
  } catch {
    return {
      decision: "block",
      reason: "Invalid provider origin",
      checks: { origin: false },
      evidenceMode: "live"
    };
  }

  const entry = input.entries.find((candidate) => {
    const idMatches = input.providerId === undefined || candidate.providerId === input.providerId;
    return idMatches && normalizeOrigin(candidate.origin) === origin;
  });

  if (!entry) {
    return {
      decision: "block",
      reason: "Provider origin is not registered",
      checks: { registered: false, origin: false },
      evidenceMode: "live"
    };
  }

  const cawAllowed = input.cawAllowedMerchantAddresses ?? [entry.merchantAddress];
  const checks = {
    registered: true,
    origin: normalizeOrigin(entry.origin) === origin,
    resourcePath: resourceAllowed(input.resourcePath, entry.allowedResources),
    payTo: normalizeAddress(entry.merchantAddress) === normalizeAddress(input.payTo),
    facilitatorUrl:
      entry.facilitatorUrl === undefined
        ? input.facilitatorUrl === undefined
        : input.facilitatorUrl !== undefined &&
          normalizeUrl(entry.facilitatorUrl) === normalizeUrl(input.facilitatorUrl),
    chainId: entry.chainId === input.chainId,
    tokenId: entry.tokenId === input.tokenId,
    cawAllowlist:
      entry.cawAllowlistStatus === "allowed" &&
      cawAllowed.map(normalizeAddress).includes(normalizeAddress(entry.merchantAddress)),
    publicKey: entry.publicKey.trim().length > 0
  };

  const failed = Object.entries(checks).find(([, passed]) => !passed);
  if (failed) {
    return {
      decision: "block",
      providerId: entry.providerId,
      reason: `Provider registry check failed: ${failed[0]}`,
      entry,
      checks,
      evidenceMode: "live"
    };
  }

  return {
    decision: "allow",
    providerId: entry.providerId,
    entry,
    checks,
    evidenceMode: "live"
  };
}
