import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "vitest";

import { healthResponseSchema } from "../../../packages/shared/src/index.js";
import { initializeRuntimeDatabase } from "./db/init.js";
import { canonicalJson, hashObject } from "./guard/hash.js";
import {
  readMissionTimelineEvents,
  recordMissionTimelineEvent,
  serializeMissionTimelineHeartbeat
} from "./mission_timeline.js";
import { startRuntimeServer } from "./server.js";

describe("runtime", () => {
  const databaseDir = mkdtempSync(join(tmpdir(), "clear402-runtime-"));
  const databasePath = join(databaseDir, "runtime.sqlite");

  test("initializes the schema", () => {
    const handle = initializeRuntimeDatabase({ databasePath });
    const tables = handle.database
      .prepare(
        `select name, type from sqlite_master where type in ('table', 'view') order by name`
      )
      .all() as Array<{ name: string; type: string }>;

    expect(tables.some((entry) => entry.name === "missions" && entry.type === "table")).toBe(
      true
    );
    expect(
      tables.some((entry) => entry.name === "quotes" && entry.type === "view")
    ).toBe(true);

    handle.database.close();
  });

  test("serves health JSON", async () => {
    const server = await startRuntimeServer({
      host: "127.0.0.1",
      port: 0,
      databasePath
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(response.ok).toBe(true);

      const payload = healthResponseSchema.parse(await response.json());
      expect(payload.service).toBe("runtime");
      expect(payload.evidenceMode).toBe("live");
      expect(payload.details?.databasePath).toBe(databasePath);
    } finally {
      await server.close();
    }
  });

  test("serves mission create, dry-run, guard, verify, get without live CAW execution", async () => {
    const keysToClear = Object.keys(process.env).filter(
      (key) => key.startsWith("CLEAR402_CAW_") || key === "CLEAR402_TEST_MERCHANT_ADDRESS"
    );
    const previousEnv = Object.fromEntries(keysToClear.map((key) => [key, process.env[key]]));
    for (const key of keysToClear) {
      delete process.env[key];
    }

    const server = await startRuntimeServer({
      host: "127.0.0.1",
      port: 0,
      databasePath: join(databaseDir, "mission-flow.sqlite")
    });
    const baseUrl = `http://127.0.0.1:${server.port}`;

    try {
      const createResponse = await fetch(`${baseUrl}/api/missions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          missionId: "mission-flow-api-1",
          userPrompt: "Runtime mission flow API test.",
          budgetUsd: "1000000000000",
          resourceUrl: "https://127.0.0.1:4010/paid/report?topic=market-intel"
        })
      });
      expect(createResponse.status).toBe(201);
      const create = (await createResponse.json()) as any;
      expect(create.source).toBe("runtime_api");
      expect(create.evidenceMode).toBe("fallback");
      expect(create.mission.id).toBe("mission-flow-api-1");

      const dryRunResponse = await fetch(
        `${baseUrl}/api/missions/mission-flow-api-1/dry-run`,
        { method: "POST" }
      );
      expect(dryRunResponse.status).toBe(200);
      const dryRun = (await dryRunResponse.json()) as any;
      expect(dryRun.source).toBe("runtime_api");
      expect(dryRun.evidenceMode).toBe("fallback");
      expect(dryRun.normalizedChallenge.evidenceMode).toBe("fallback");
      expect(dryRun.providerRegistryResult.evidenceMode).toBe("fallback");

      const guardResponse = await fetch(
        `${baseUrl}/api/missions/mission-flow-api-1/guard`,
        { method: "POST" }
      );
      expect(guardResponse.status).toBe(200);
      const guard = (await guardResponse.json()) as any;
      expect(guard.source).toBe("runtime_api");
      expect(guard.evidenceMode).toBe("fallback");
      expect(guard.guard.decision).toBe("fallback_required");
      expect(guard.cawEvidence.decision).toBe("fallback_required");
      expect(guard.cawEvidence.denial.details.paymentAttempted).toBe(false);
      expect(guard.cawEvidence.txHash).toBeUndefined();
      expect(guard.paymentContext.evidenceMode).toBeUndefined();

      const verifyResponse = await fetch(
        `${baseUrl}/api/missions/mission-flow-api-1/verify`,
        { method: "POST" }
      );
      expect(verifyResponse.status).toBe(200);
      const verify = (await verifyResponse.json()) as any;
      expect(verify.source).toBe("runtime_api");
      expect(verify.evidenceMode).toBe("fallback");
      expect(verify.receipt.evidenceMode).toBe("fallback");
      expect(verify.receipt.paymentReceipt.txHash).toBeUndefined();
      expect(verify.receipt.finalStatus).toBe("failed");

      const getResponse = await fetch(`${baseUrl}/api/missions/mission-flow-api-1`);
      expect(getResponse.status).toBe(200);
      const get = (await getResponse.json()) as any;
      expect(get.source).toBe("runtime_api");
      expect(get.evidenceMode).toBe("fallback");
      expect(get.receipt.evidenceMode).toBe("fallback");

      const evidenceResponse = await fetch(
        `${baseUrl}/api/evidence/mission-flow-api-1/export.json`
      );
      expect(evidenceResponse.status).toBe(200);
      const evidence = (await evidenceResponse.json()) as any;
      expect(evidence.source).toBe("runtime_db");
      expect(evidence.evidenceMode).not.toBe("live");
      expect(evidence.guard.decision).toBe("fallback_required");
      expect(evidence.serviceReceipt.evidenceMode).toBe("fallback");
      expect(evidence.serviceReceipt.txHash).toBeUndefined();

      const serializedEvidence = JSON.stringify(evidence);
      expect(serializedEvidence).not.toContain("CLEAR402_CAW_");
      expect(serializedEvidence).not.toContain("sk-");

      const timelineResponse = await fetch(
        `${baseUrl}/api/missions/mission-flow-api-1/timeline.sse`
      );
      expect(timelineResponse.status).toBe(200);
      expect(timelineResponse.headers.get("content-type")).toContain("text/event-stream");
      const timeline = await readSseUntil(timelineResponse, "event: receipt");
      expect(timeline).toContain("event: mission");
      expect(timeline).toContain("event: guard");
      expect(timeline).toContain("event: receipt");
      expect(timeline).toContain("Receipt is recorded without claiming a live CAW transaction hash.");
      expect(timeline).not.toContain("CLEAR402_CAW_");
      expect(timeline).not.toContain("sk-");
    } finally {
      await server.close();
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  test("exports DB-backed mission evidence as JSON and markdown from one structured bundle", async () => {
    const seededDatabasePath = join(databaseDir, "evidence-export.sqlite");
    const handle = initializeRuntimeDatabase({ databasePath: seededDatabasePath });
    seedEvidenceMission(handle.database, "mission-export-1");
    handle.database.close();

    const server = await startRuntimeServer({
      host: "127.0.0.1",
      port: 0,
      databasePath: seededDatabasePath
    });

    try {
      const jsonResponse = await fetch(
        `http://127.0.0.1:${server.port}/api/evidence/mission-export-1/export.json`
      );
      expect(jsonResponse.status).toBe(200);
      expect(jsonResponse.headers.get("content-type")).toContain("application/json");

      const payload = (await jsonResponse.json()) as any;
      expect(payload.version).toBe("clear402.evidence-export.v1");
      expect(payload.missionId).toBe("mission-export-1");
      expect(payload.source).toBe("runtime_db");
      expect(payload.providerChallenge.provider.providerId).toBe("provider-export");
      expect(payload.paymentContext.paymentContextHash).toBe(
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      );
      expect(payload.guard.decision).toBe("allow");
      expect(payload.guard.guardEventId).toBe("guard-export-1");
      expect(payload.serviceReceipt.receiptId).toBe("receipt-export-1");
      expect(payload.serviceReceipt.providerSignature).toBeUndefined();
      expect(payload.serviceReceipt.providerSignaturePresent).toBe(true);
      expect(payload.cawCapabilitySummary.rawEvidenceRefsOmitted).toBe(true);

      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain("sk-test-secret");
      expect(serialized).not.toContain("CLEAR402_CAW_API_KEY=");
      expect(serialized).not.toContain("provider-signature-secret");

      const mdResponse = await fetch(
        `http://127.0.0.1:${server.port}/api/evidence/mission-export-1/export.md`
      );
      expect(mdResponse.status).toBe(200);
      expect(mdResponse.headers.get("content-type")).toContain("text/markdown");

      const markdown = await mdResponse.text();
      expect(markdown).toContain("# Clear402 Evidence Export");
      expect(markdown).toContain("Mission ID: `mission-export-1`");
      expect(markdown).toContain("Guard event ID: `guard-export-1`");
      expect(markdown).toContain("Raw evidence refs omitted: `true`");
      expect(markdown).not.toContain("sk-test-secret");
      expect(markdown).not.toContain("CLEAR402_CAW_API_KEY=");
    } finally {
      await server.close();
    }
  });

  test("exports explicit demo evidence without pretending it is live", async () => {
    const server = await startRuntimeServer({
      host: "127.0.0.1",
      port: 0,
      databasePath: join(databaseDir, "demo-export.sqlite")
    });

    try {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/api/evidence/mission-demo-402/export.json`
      );
      expect(response.status).toBe(200);
      const payload = (await response.json()) as any;

      expect(payload.source).toBe("demo_fixture");
      expect(payload.evidenceMode).not.toBe("live");
      expect(payload.evidenceModeSummary.components).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            component: "mission",
            evidenceMode: "fallback"
          }),
          expect.objectContaining({
            component: "attackLab",
            evidenceMode: "mock"
          })
        ])
      );
      expect(payload.limitations.claimsForbidden).toContain("Do not claim mainnet BOT Chain execution.");
    } finally {
      await server.close();
    }
  });

  test("returns problem JSON for unknown evidence missions", async () => {
    const server = await startRuntimeServer({
      host: "127.0.0.1",
      port: 0,
      databasePath: join(databaseDir, "missing-export.sqlite")
    });

    try {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/api/evidence/not-here/export.json`
      );
      expect(response.status).toBe(404);
      const payload = (await response.json()) as any;
      expect(payload.code).toBe("EVIDENCE_NOT_FOUND");
    } finally {
      await server.close();
    }
  });

  test("exports dual receipt facts from guard evidence when no dual receipt row exists", async () => {
    const seededDatabasePath = join(databaseDir, "event-dual-receipt-export.sqlite");
    const handle = initializeRuntimeDatabase({ databasePath: seededDatabasePath });
    seedEventDualReceiptMission(handle.database, "mission-event-dual-receipt");
    handle.database.close();

    const server = await startRuntimeServer({
      host: "127.0.0.1",
      port: 0,
      databasePath: seededDatabasePath
    });

    try {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/api/evidence/mission-event-dual-receipt/export.json`
      );
      expect(response.status).toBe(200);

      const payload = (await response.json()) as any;
      expect(payload.dualReceipt).toEqual(
        expect.objectContaining({
          status: "recorded",
          evidenceMode: "fallback",
          dualReceiptHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
          paymentReceiptHash:
            "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          deliveryReceiptHash:
            "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          verificationDecision: "allow"
        })
      );
      expect(payload.dualReceipt.verificationResult).toEqual(
        expect.objectContaining({ decision: "allow" })
      );
      expect(payload.evidenceModeSummary.components).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            component: "dualReceipt",
            evidenceMode: "fallback"
          })
        ])
      );
    } finally {
      await server.close();
    }
  });

  test("mission timeline replays existing events on first SSE connection", async () => {
    const databasePath = join(databaseDir, "timeline-first-connect.sqlite");
    const handle = initializeRuntimeDatabase({ databasePath });
    seedTimelineMission(handle.database, "mission-timeline-first", 1_800_000_000_000);
    const first = recordMissionTimelineEvent(handle.database, {
      id: "timeline-first-1",
      missionId: "mission-timeline-first",
      type: "mission",
      createdAt: 1_800_000_000_001,
      payload: {
        title: "Mission created",
        detail: "seeded event",
        status: "success",
        evidenceMode: "fallback"
      }
    });
    const second = recordMissionTimelineEvent(handle.database, {
      id: "timeline-first-2",
      missionId: "mission-timeline-first",
      type: "guard",
      createdAt: 1_800_000_000_002,
      payload: {
        title: "Guard fallback",
        detail: "guard event",
        status: "fallback",
        evidenceMode: "fallback"
      }
    });
    handle.database.close();

    const server = await startRuntimeServer({
      host: "127.0.0.1",
      port: 0,
      databasePath
    });

    try {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/api/missions/mission-timeline-first/timeline.sse`
      );
      const text = await readSseUntil(response, "id: timeline-first-2");
      expect(text).toContain(`id: ${first.id}`);
      expect(text).toContain(`event: ${first.type}`);
      expect(text).toContain(`id: ${second.id}`);
      expect(text).toContain(`event: ${second.type}`);
    } finally {
      await server.close();
    }
  });

  test("Last-Event-ID only replays subsequent mission timeline events", async () => {
    const databasePath = join(databaseDir, "timeline-last-event-id.sqlite");
    const handle = initializeRuntimeDatabase({ databasePath });
    seedTimelineMission(handle.database, "mission-timeline-replay", 1_800_000_000_000);
    recordMissionTimelineEvent(handle.database, {
      id: "timeline-replay-1",
      missionId: "mission-timeline-replay",
      type: "mission",
      createdAt: 1_800_000_000_001,
      payload: {
        title: "Mission created",
        detail: "seeded event",
        status: "success",
        evidenceMode: "fallback"
      }
    });
    recordMissionTimelineEvent(handle.database, {
      id: "timeline-replay-2",
      missionId: "mission-timeline-replay",
      type: "guard",
      createdAt: 1_800_000_000_002,
      payload: {
        title: "Guard blocked",
        detail: "second event",
        status: "blocked",
        evidenceMode: "fallback"
      }
    });
    recordMissionTimelineEvent(handle.database, {
      id: "timeline-replay-3",
      missionId: "mission-timeline-replay",
      type: "receipt",
      createdAt: 1_800_000_000_003,
      payload: {
        title: "Receipt recorded",
        detail: "third event",
        status: "fallback",
        evidenceMode: "fallback"
      }
    });
    handle.database.close();

    const server = await startRuntimeServer({
      host: "127.0.0.1",
      port: 0,
      databasePath
    });

    try {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/api/missions/mission-timeline-replay/timeline.sse`,
        { headers: { "Last-Event-ID": "timeline-replay-1" } }
      );
      const text = await readSseUntil(response, "id: timeline-replay-3");
      expect(text).not.toContain("id: timeline-replay-1");
      expect(text).toContain("id: timeline-replay-2");
      expect(text).toContain("id: timeline-replay-3");
    } finally {
      await server.close();
    }
  });

  test("heartbeat comments do not pollute mission timeline event history", () => {
    const handle = initializeRuntimeDatabase({
      databasePath: join(databaseDir, "timeline-heartbeat.sqlite")
    });
    seedTimelineMission(handle.database, "mission-timeline-heartbeat", 1_800_000_000_000);
    recordMissionTimelineEvent(handle.database, {
      id: "timeline-heartbeat-1",
      missionId: "mission-timeline-heartbeat",
      type: "mission",
      createdAt: 1_800_000_000_001,
      payload: {
        title: "Mission created",
        detail: "seeded event",
        status: "success",
        evidenceMode: "fallback"
      }
    });

    const heartbeat = serializeMissionTimelineHeartbeat(1_800_000_000_010);
    expect(heartbeat).toContain(": heartbeat");
    expect(readMissionTimelineEvents(handle.database, "mission-timeline-heartbeat")).toHaveLength(1);
    handle.database.close();
  });

  test("mission timeline history is isolated by missionId", () => {
    const handle = initializeRuntimeDatabase({
      databasePath: join(databaseDir, "timeline-isolation.sqlite")
    });
    seedTimelineMission(handle.database, "mission-timeline-a", 1_800_000_000_000);
    seedTimelineMission(handle.database, "mission-timeline-b", 1_800_000_000_000);
    recordMissionTimelineEvent(handle.database, {
      id: "timeline-isolated-a",
      missionId: "mission-timeline-a",
      type: "guard",
      createdAt: 1_800_000_000_001,
      payload: {
        title: "Guard A",
        detail: "mission A",
        status: "blocked",
        evidenceMode: "fallback"
      }
    });
    recordMissionTimelineEvent(handle.database, {
      id: "timeline-isolated-b",
      missionId: "mission-timeline-b",
      type: "receipt",
      createdAt: 1_800_000_000_002,
      payload: {
        title: "Receipt B",
        detail: "mission B",
        status: "fallback",
        evidenceMode: "fallback"
      }
    });

    const missionA = readMissionTimelineEvents(handle.database, "mission-timeline-a");
    const missionB = readMissionTimelineEvents(handle.database, "mission-timeline-b");
    expect(missionA.map((event) => event.id)).toEqual(["timeline-isolated-a"]);
    expect(missionB.map((event) => event.id)).toEqual(["timeline-isolated-b"]);
    handle.database.close();
  });
});

async function readSseUntil(response: Response, marker: string) {
  expect(response.status).toBe(200);
  const reader = response.body?.getReader();
  expect(reader).toBeDefined();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + 2_000;

  try {
    while (Date.now() < deadline) {
      const { value, done } = await reader!.read();
      if (done) {
        break;
      }

      text += decoder.decode(value, { stream: true });
      if (text.includes(marker)) {
        return text;
      }
    }
  } finally {
    await reader?.cancel();
  }

  throw new Error(`SSE marker not found: ${marker}\n${text}`);
}

function seedTimelineMission(
  database: ReturnType<typeof initializeRuntimeDatabase>["database"],
  missionId: string,
  now: number
) {
  database
    .prepare(
      `insert into missions (
        id,
        user_prompt,
        budget_usd,
        status,
        caw_wallet_uuid,
        caw_wallet_address,
        pact_id,
        created_at,
        updated_at
      ) values (?, ?, ?, 'active', ?, ?, ?, ?, ?)`
    )
    .run(
      missionId,
      "Timeline test mission",
      "1",
      "wallet-timeline",
      "0xCAW0000000000000000000000000000000000001",
      "pact-timeline",
      now,
      now
    );
}

function seedEventDualReceiptMission(
  database: ReturnType<typeof initializeRuntimeDatabase>["database"],
  missionId: string
) {
  const now = 1_800_000_000_000;
  database
    .prepare(
      `insert into missions (
        id,
        user_prompt,
        budget_usd,
        status,
        caw_wallet_uuid,
        caw_wallet_address,
        pact_id,
        created_at,
        updated_at
      ) values (?, ?, ?, 'complete', ?, ?, ?, ?, ?)`
    )
    .run(
      missionId,
      "Export dual receipt from guard event.",
      "1",
      "wallet-event-dual-receipt",
      "0xCAW0000000000000000000000000000000000001",
      "pact-event-dual-receipt",
      now,
      now
    );

  database
    .prepare(
      `insert into guard_events (
        id,
        mission_id,
        layer,
        decision,
        reason,
        evidence_json,
        created_at
      ) values (?, ?, 'receipt_verifier', 'allow', ?, ?, ?)`
    )
    .run(
      "guard-event-dual-receipt",
      missionId,
      "Dual receipt recorded in guard evidence.",
      canonicalJson({
        dualReceipt: {
          dualReceiptHash:
            "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
          paymentReceipt: {
            paymentReceiptHash:
              "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
          },
          deliveryReceipt: {
            deliveryReceiptHash:
              "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
          },
          verificationResult: {
            decision: "allow",
            checks: {
              paymentContext: true,
              providerSignature: true
            }
          },
          evidenceMode: "fallback"
        }
      }),
      now
    );
}

function seedEvidenceMission(database: ReturnType<typeof initializeRuntimeDatabase>["database"], missionId: string) {
  const now = 1_800_000_000_000;
  const paymentContextHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const rawChallengeHash = hashObject("export-raw-challenge");
  const paymentContext = {
    version: "clear402.payment.v1",
    missionId,
    providerId: "provider-export",
    quoteId: "quote-export-1",
    method: "GET",
    origin: "https://provider.example",
    resourcePath: "/paid/report",
    canonicalUrlHash: hashObject("https://provider.example/paid/report"),
    bodyHash: hashObject(""),
    sanitizedResourceHash: hashObject("https://provider.example/paid/report"),
    merchantAddress: "0xA882b939c4Ca15c904760b8c240124Cb68cc2A88",
    facilitatorUrlHash: hashObject("https://facilitator.example/x402"),
    chainId: "84532",
    tokenId: "USDC",
    amount: "5",
    amountDecimals: 6,
    nonce: "nonce-export-1",
    issuedAt: now,
    expiresAt: now + 600_000,
    quoteTermsHash: hashObject("export-quote-terms"),
    piiPolicyHash: hashObject("export-pii-policy"),
    clearSignDigest: hashObject("export-clearsig"),
    cawPactId: "pact-export-1",
    serviceMode: "caw-fetch"
  };
  const receipt = {
    receiptId: "receipt-export-1",
    paymentContextHash,
    cawRequestId: "clear402:export-request",
    cawWalletAddress: "0xCAW0000000000000000000000000000000000001",
    pactId: "pact-export-1",
    providerAddress: "0xA882b939c4Ca15c904760b8c240124Cb68cc2A88",
    txHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    chainId: "84532",
    tokenId: "USDC",
    amount: "5",
    providerResponseHash: hashObject("export-provider-response"),
    providerSignature: "provider-signature-secret",
    responseSchemaHash: hashObject("clear402.provider.report.v1"),
    deliveryTimestamp: now,
    status: "delivered",
    clearsigDigest: hashObject("export-clearsig"),
    auditLogIds: ["audit-export-1"],
    redactionSummaryHash: hashObject("export-redaction-summary"),
    evidenceMode: "fallback"
  };

  database
    .prepare(
      `insert into missions (
        id,
        user_prompt,
        budget_usd,
        status,
        caw_wallet_uuid,
        caw_wallet_address,
        pact_id,
        created_at,
        updated_at
      ) values (?, ?, ?, 'complete', ?, ?, ?, ?, ?)`
    )
    .run(
      missionId,
      "Fetch the paid market report without leaking secrets.",
      "25",
      "wallet-export",
      "0xCAW0000000000000000000000000000000000001",
      "pact-export-1",
      now,
      now
    );

  database
    .prepare(
      `insert into provider_registry (
        provider_id,
        origin,
        merchant_address,
        facilitator_url,
        chain_id,
        token_id,
        public_key,
        allowed_resources,
        caw_allowlist_status,
        erc8004_agent_id,
        erc8004_agent_uri,
        reputation_threshold,
        validation_tags,
        created_at,
        updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, 'allowed', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "provider-export",
      "https://provider.example",
      "0xA882b939c4Ca15c904760b8c240124Cb68cc2A88",
      "https://facilitator.example/x402",
      "84532",
      "USDC",
      "0x04publickey-export",
      canonicalJson(["/paid/report"]),
      "erc8004:agent:export",
      "https://erc8004.example/agents/export",
      "80",
      canonicalJson(["x402_endpoint_verified", "delivery_receipt_verified"]),
      now,
      now
    );

  database
    .prepare(
      `insert into x402_quotes (
        quote_id,
        mission_id,
        provider_id,
        resource_url,
        amount_usd,
        status,
        raw_challenge_hash,
        created_at,
        expires_at
      ) values (?, ?, ?, ?, ?, 'spent', ?, ?, ?)`
    )
    .run(
      "quote-export-1",
      missionId,
      "provider-export",
      "https://provider.example/paid/report",
      "5",
      rawChallengeHash,
      now,
      now + 600_000
    );

  database
    .prepare(
      `insert into payment_contexts (
        payment_context_hash,
        mission_id,
        provider_id,
        quote_id,
        method,
        origin,
        resource_path,
        canonical_url_hash,
        body_hash,
        sanitized_resource_hash,
        merchant_address,
        facilitator_url_hash,
        chain_id,
        token_id,
        amount,
        amount_decimals,
        nonce,
        issued_at,
        expires_at,
        quote_terms_hash,
        pii_policy_hash,
        clear_sign_digest,
        caw_pact_id,
        service_mode,
        raw_context_json
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      paymentContextHash,
      missionId,
      paymentContext.providerId,
      paymentContext.quoteId,
      paymentContext.method,
      paymentContext.origin,
      paymentContext.resourcePath,
      paymentContext.canonicalUrlHash,
      paymentContext.bodyHash,
      paymentContext.sanitizedResourceHash,
      paymentContext.merchantAddress,
      paymentContext.facilitatorUrlHash,
      paymentContext.chainId,
      paymentContext.tokenId,
      paymentContext.amount,
      paymentContext.amountDecimals,
      paymentContext.nonce,
      paymentContext.issuedAt,
      paymentContext.expiresAt,
      paymentContext.quoteTermsHash,
      paymentContext.piiPolicyHash,
      paymentContext.clearSignDigest,
      paymentContext.cawPactId,
      paymentContext.serviceMode,
      canonicalJson(paymentContext)
    );

  database
    .prepare(
      `insert into guard_events (
        id,
        mission_id,
        layer,
        decision,
        reason,
        evidence_json,
        created_at
      ) values (?, ?, 'guard_pipeline', 'allow', ?, ?, ?)`
    )
    .run(
      "guard-export-1",
      missionId,
      "Export fixture allowed by guard pipeline.",
      canonicalJson({
        challenge: {
          scheme: "exact",
          network: "base-sepolia",
          asset: "USDC",
          amount: "5",
          payTo: "0xA882b939c4Ca15c904760b8c240124Cb68cc2A88",
          resource: "https://provider.example/paid/report",
          facilitatorUrl: "https://facilitator.example/x402",
          description: "Paid report",
          expiresAt: now + 600_000,
          providerId: "provider-export",
          rawChallengeHash,
          evidenceMode: "fallback"
        },
        paymentContext,
        cawEvidence: {
          evidenceMode: "fallback",
          requestId: "clear402:export-request",
          walletAddress: "0xCAW0000000000000000000000000000000000001",
          txHash: receipt.txHash,
          auditLogId: "audit-export-1"
        },
        receipt,
        environmentValue: "CLEAR402_CAW_API_KEY=sk-test-secret"
      }),
      now
    );

  database
    .prepare(
      `insert into receipts (
        receipt_id,
        mission_id,
        payment_context_hash,
        caw_request_id,
        caw_wallet_address,
        pact_id,
        provider_address,
        facilitator_url_hash,
        tx_hash,
        chain_id,
        token_id,
        amount,
        provider_response_hash,
        provider_signature,
        response_schema_hash,
        delivery_timestamp,
        status,
        clearsig_digest,
        audit_log_ids,
        redaction_summary_hash,
        evidence_mode,
        created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      receipt.receiptId,
      missionId,
      paymentContextHash,
      receipt.cawRequestId,
      receipt.cawWalletAddress,
      receipt.pactId,
      receipt.providerAddress,
      paymentContext.facilitatorUrlHash,
      receipt.txHash,
      receipt.chainId,
      receipt.tokenId,
      receipt.amount,
      receipt.providerResponseHash,
      receipt.providerSignature,
      receipt.responseSchemaHash,
      receipt.deliveryTimestamp,
      receipt.status,
      receipt.clearsigDigest,
      canonicalJson(receipt.auditLogIds),
      receipt.redactionSummaryHash,
      receipt.evidenceMode,
      now
    );
}
