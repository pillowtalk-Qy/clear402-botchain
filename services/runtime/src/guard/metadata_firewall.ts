import type { MetadataFirewallResult } from "../../../../packages/shared/src/index.mjs";
import { hashObject } from "./hash.ts";

export interface MetadataTriple {
  resourceUrl: string;
  description?: string;
  reason?: string;
}

type Finding = MetadataFirewallResult["findings"][number];

const allowedReasonCodes = new Set([
  "MARKET_DATA_REQUEST",
  "RESEARCH_DATASET_ACCESS",
  "MODEL_INFERENCE_PAYMENT",
  "ESCROWED_SERVICE_DELIVERY"
]);

const detectors: Array<{
  entityType: string;
  confidence: number;
  action: "redact" | "hash_only" | "require_approval" | "block";
  pattern: RegExp;
}> = [
  {
    entityType: "email",
    confidence: 0.98,
    action: "redact",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
  },
  {
    entityType: "phone",
    confidence: 0.82,
    action: "redact",
    pattern: /\b(?:\+?\d[\d .()-]{7,}\d)\b/g
  },
  {
    entityType: "passport_or_id",
    confidence: 0.88,
    action: "hash_only",
    pattern: /\b(?:passport|ssn|national id|id number)[:# ]+[A-Z0-9-]{5,}\b/gi
  },
  {
    entityType: "account_or_customer_id",
    confidence: 0.78,
    action: "redact",
    pattern: /\b(?:account|customer|cust)[_-]?(?:id|number)?[:=#/ ]+[A-Z0-9-]{4,}\b/gi
  },
  {
    entityType: "api_key_or_token",
    confidence: 0.95,
    action: "block",
    pattern: /\b(?:api[_-]?key|secret|token|jwt|bearer)[=: ]+[A-Za-z0-9._~+/=-]{12,}\b/gi
  },
  {
    entityType: "private_key_or_seed",
    confidence: 0.99,
    action: "block",
    pattern: /\b(?:seed phrase|private key|mnemonic)[=: ]+[A-Za-z0-9 _-]{12,}\b/gi
  },
  {
    entityType: "sensitive_domain",
    confidence: 0.74,
    action: "require_approval",
    pattern: /\b(?:medical|diagnosis|patient|legal|lawsuit|financial|bankruptcy)\b/gi
  },
  {
    entityType: "physical_address",
    confidence: 0.68,
    action: "redact",
    pattern: /\b\d{1,6}\s+[A-Za-z0-9 .'-]+\s+(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr)\b/gi
  }
];

function redactValue(value: string, finding: string): string {
  return value.replaceAll(finding, `[redacted:${hashObject(finding).slice(2, 14)}]`);
}

function scanField(field: Finding["field"], value: string): {
  sanitized: string;
  findings: Finding[];
  decisionRank: number;
} {
  let sanitized = value;
  let decisionRank = 0;
  const findings: Finding[] = [];

  for (const detector of detectors) {
    const matches = [...value.matchAll(detector.pattern)];
    for (const match of matches) {
      const matchedText = match[0];
      findings.push({
        field,
        entityType: detector.entityType,
        confidence: detector.confidence,
        action: detector.action
      });

      if (detector.action === "redact" || detector.action === "hash_only") {
        sanitized = redactValue(sanitized, matchedText);
      }

      if (detector.action === "redact") {
        decisionRank = Math.max(decisionRank, 1);
      } else if (detector.action === "hash_only") {
        decisionRank = Math.max(decisionRank, 2);
      } else if (detector.action === "require_approval") {
        decisionRank = Math.max(decisionRank, 3);
      } else if (detector.action === "block") {
        decisionRank = Math.max(decisionRank, 4);
      }
    }
  }

  return { sanitized, findings, decisionRank };
}

function decisionFromRank(rank: number): MetadataFirewallResult["decision"] {
  if (rank >= 4) {
    return "block";
  }

  if (rank === 3) {
    return "require_approval";
  }

  if (rank === 2) {
    return "hash_only";
  }

  if (rank === 1) {
    return "redact";
  }

  return "allow";
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const [key, entry] of url.searchParams.entries()) {
      const fieldScan = scanField("resourceUrl", entry);
      if (fieldScan.findings.length > 0) {
        url.searchParams.set(key, `[redacted:${hashObject(entry).slice(2, 14)}]`);
      }
    }

    const pathScan = scanField("resourceUrl", url.pathname);
    url.pathname = pathScan.sanitized;
    return url.toString();
  } catch {
    return scanField("resourceUrl", value).sanitized;
  }
}

export function scanMetadata(input: MetadataTriple): MetadataFirewallResult {
  const startedAt = performance.now();
  const resourceFindings = scanField("resourceUrl", input.resourceUrl);
  const descriptionFindings =
    input.description === undefined
      ? undefined
      : scanField("description", input.description);
  const reasonIsCode = input.reason === undefined || allowedReasonCodes.has(input.reason);
  const reasonFindings =
    input.reason === undefined || reasonIsCode ? undefined : scanField("reason", input.reason);

  const allFindings = [
    ...resourceFindings.findings,
    ...(descriptionFindings?.findings ?? []),
    ...(reasonFindings?.findings ?? [])
  ];
  const rank = Math.max(
    resourceFindings.decisionRank,
    descriptionFindings?.decisionRank ?? 0,
    reasonFindings?.decisionRank ?? 0
  );

  const sanitized: MetadataTriple = {
    resourceUrl: sanitizeUrl(input.resourceUrl)
  };

  if (input.description !== undefined) {
    sanitized.description = descriptionFindings?.sanitized ?? input.description;
  }

  if (input.reason !== undefined) {
    const sanitizedReason = reasonIsCode ? input.reason : reasonFindings?.sanitized;
    if (sanitizedReason !== undefined) {
      sanitized.reason = sanitizedReason;
    }
  }

  if (input.reason !== undefined && !reasonIsCode && allFindings.length === 0) {
    sanitized.reason = "MODEL_INFERENCE_PAYMENT";
  }

  return {
    decision: decisionFromRank(rank),
    sanitized,
    findings: allFindings,
    piiPolicyHash: hashObject({
      policy: "clear402.metadata_firewall.v1",
      sanitized,
      findings: allFindings.map(({ field, entityType, action }) => ({
        field,
        entityType,
        action
      }))
    }),
    latencyMs: Math.max(0, Math.round((performance.now() - startedAt) * 1000) / 1000),
    evidenceMode: "live"
  };
}
