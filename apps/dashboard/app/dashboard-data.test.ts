import { describe, expect, test } from "vitest";

import {
  applyDashboardAction,
  buildServerSideEvidenceExport,
  buildEvidenceExport,
  createInitialWorkspace,
  formatRequestId,
  loadPreferredEvidenceExport,
  mergeRuntimeTimelineItem,
  runtimeTimelineEventToDashboardItem,
  runPreferredMissionFlowAction
} from "./dashboard-data";

const runtime = {
  service: "runtime",
  status: "ok" as const,
  evidenceMode: "live" as const,
  timestamp: "2026-06-12T00:00:00.000Z",
  version: "0.1.0",
  details: {},
  endpoint: "http://127.0.0.1:4000/health"
};

const provider = {
  service: "provider-x402",
  status: "ok" as const,
  evidenceMode: "live" as const,
  timestamp: "2026-06-12T00:00:00.000Z",
  version: "0.1.0",
  details: {},
  endpoint: "http://127.0.0.1:4010/health"
};

describe("dashboard data", () => {
  test("creates a fallback-rich workspace from runtime health", () => {
    const workspace = createInitialWorkspace({
      runtime,
      provider,
      preset: "demo"
    });

    expect(workspace.runtimeHealth.evidenceMode).toBe("live");
    expect(workspace.providerHealth.evidenceMode).toBe("live");
    expect(workspace.mission.evidenceMode).toBe("mock");
    expect(workspace.caw.evidenceMode).toBe("fallback");
    expect(workspace.receipt.finalStatus).toBe("paid_but_not_delivered");
  });

  test("advances mission and export state through UI actions", () => {
    let workspace = createInitialWorkspace({
      runtime,
      provider,
      preset: "attack"
    });

    workspace = applyDashboardAction(workspace, { type: "create-mission" });
    workspace = applyDashboardAction(workspace, { type: "dry-run" });
    workspace = applyDashboardAction(workspace, { type: "prepare-guard" });
    workspace = applyDashboardAction(workspace, { type: "execute-payment" });
    workspace = applyDashboardAction(workspace, { type: "verify-receipt" });
    workspace = applyDashboardAction(workspace, { type: "run-attack", attackId: "replay" });
    workspace = applyDashboardAction(workspace, { type: "export-evidence" });

    expect(workspace.mission.status).toBe("complete");
    expect(workspace.receipt.finalStatus).toBe("delivered");
    expect(workspace.attacks.find((attack) => attack.id === "replay")?.resultState).toBe(
      "blocked"
    );
    expect(workspace.evidence?.source).toBe("frontend_fallback");
    expect(workspace.evidence?.json).toContain('"mission"');
    expect(workspace.evidence?.markdown).toContain("Clear402 Evidence Pack");
  });

  test("formats request ids with clear402 prefix", () => {
    expect(formatRequestId("0x1234567890abcdef")).toBe("clear402:1234567890abcdef");
  });

  test("maps runtime SSE timeline payloads into the dashboard timeline", () => {
    const workspace = createInitialWorkspace({
      runtime,
      provider,
      preset: "demo"
    });
    const item = runtimeTimelineEventToDashboardItem({
      eventId: "guard-runtime-sse-1",
      eventType: "guard",
      createdAt: 1_800_000_000_000,
      missionId: "mission-runtime-sse",
      payload: {
        title: "Guard fallback",
        detail: "Runtime guard stopped at the CAW fallback boundary.",
        status: "fallback",
        evidenceMode: "fallback",
        guardEventId: "guard-runtime-sse-1"
      }
    });

    expect(item).toBeDefined();
    const next = mergeRuntimeTimelineItem(workspace, item!);
    expect(next.timeline[0]?.id).toBe("guard-runtime-sse-1");
    expect(next.timeline[0]?.source).toBe("runtime_sse");
    expect(next.timeline[0]?.auditLogId).toBe("guard-runtime-sse-1");
    expect(next.timeline[0]?.detail).toContain("fallback boundary");
  });

  test("prefers server-side evidence export when runtime export succeeds", async () => {
    const workspace = createInitialWorkspace({
      runtime,
      provider,
      preset: "evidence"
    });
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);

      if (url.endsWith("/export.json")) {
        return new Response(
          JSON.stringify({
            version: "clear402.evidence-export.v1",
            generatedAt: 1_800_000_000_000,
            missionId: "mission-demo-402",
            source: "runtime_db",
            evidenceMode: "fallback",
            evidenceModeSummary: {
              overall: "fallback",
              counts: { live: 1, fallback: 1, mock: 0 },
              components: []
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      return new Response("# Runtime export", {
        status: 200,
        headers: { "content-type": "text/markdown" }
      });
    };

    const result = await loadPreferredEvidenceExport(workspace, {
      fetcher,
      now: 1_800_000_000_100
    });

    expect(result.usedRuntime).toBe(true);
    expect(result.evidence.source).toBe("server_side");
    expect(result.evidence.runtimeSource).toBe("runtime_db");
    expect(result.evidence.evidenceMode).toBe("fallback");
    expect(result.evidence.generatedAt).toBe(1_800_000_000_000);
    expect(result.evidence.json).toContain('"source": "runtime_db"');
  });

  test("falls back to frontend export when runtime export is unavailable", async () => {
    const workspace = createInitialWorkspace({
      runtime,
      provider,
      preset: "evidence"
    });
    const fetcher: typeof fetch = async (input) => {
      const status = String(input).endsWith("/export.json") ? 404 : 200;
      return new Response(status === 404 ? '{"code":"EVIDENCE_NOT_FOUND"}' : "# not used", {
        status
      });
    };

    const result = await loadPreferredEvidenceExport(workspace, {
      fetcher,
      now: 1_800_000_000_100
    });

    expect(result.usedRuntime).toBe(false);
    expect(result.fallbackReason).toContain("HTTP 404");
    expect(result.evidence.source).toBe("frontend_fallback");
    expect(result.evidence.evidenceMode).toBe("fallback");
    expect(result.evidence.json).toContain('"liveFallbackMockLabels"');
    expect(result.evidence.markdown).toContain("Default dashboard demos and attack lab runs use fallback/mock evidence");
    expect(result.evidence.markdown).toContain("BOT Chain settlement is live only after ServiceEscrow deployment");
    expect(result.evidence.markdown).toContain("must not be claimed as live settlement");
    expect(result.evidence.markdown).not.toContain("needs_manual_step / fallback / not-run");
  });

  test("uses runtime mission flow action when the API succeeds without upgrading evidenceMode", async () => {
    const workspace = createInitialWorkspace({
      runtime,
      provider,
      preset: "demo"
    });
    const fetcher: typeof fetch = async (input) => {
      expect(String(input)).toBe("/api/missions");

      return new Response(
        JSON.stringify({
          source: "runtime_api",
          evidenceMode: "fallback",
          mission: {
            id: "mission-runtime-1",
            userPrompt: "Runtime mission",
            budgetUsd: "0.10",
            resourceUrl: "https://127.0.0.1:4010/paid/report?topic=market-intel",
            status: "active",
            cawWalletUuid: "runtime-demo-wallet",
            cawWalletAddress: "0xCAW0000000000000000000000000000000000001",
            pactId: "runtime-demo-pact",
            createdAt: 1_800_000_000_000,
            evidenceMode: "fallback",
            source: "runtime_api"
          }
        }),
        { status: 201, headers: { "content-type": "application/json" } }
      );
    };

    const result = await runPreferredMissionFlowAction(workspace, "create-mission", {
      fetcher,
      now: 1_800_000_000_100
    });

    expect(result.usedRuntime).toBe(true);
    expect(result.source).toBe("runtime_api");
    expect(result.workspace.actionSource).toBe("runtime_api");
    expect(result.workspace.mission.id).toBe("mission-runtime-1");
    expect(result.workspace.mission.evidenceMode).toBe("fallback");
    expect(result.workspace.mission.evidenceMode).not.toBe("live");
  });

  test("falls back to frontend mission flow when runtime API is unavailable", async () => {
    const workspace = createInitialWorkspace({
      runtime,
      provider,
      preset: "demo"
    });
    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify({ code: "NOT_FOUND" }), {
        status: 404,
        headers: { "content-type": "application/json" }
      });

    const result = await runPreferredMissionFlowAction(workspace, "create-mission", {
      fetcher,
      now: 1_800_000_000_100
    });

    expect(result.usedRuntime).toBe(false);
    expect(result.source).toBe("frontend_fallback");
    expect(result.fallbackReason).toContain("HTTP 404");
    expect(result.workspace.actionSource).toBe("frontend_fallback");
    expect(result.workspace.mission.id).toBe("mission-demo-402");
    expect(result.workspace.mission.evidenceMode).toBe("mock");
  });

  test("maps runtime guard fallback evidence without turning it live", async () => {
    let workspace = createInitialWorkspace({
      runtime,
      provider,
      preset: "demo"
    });
    workspace = applyDashboardAction(workspace, { type: "create-mission" }, 1_800_000_000_000);

    const fetcher: typeof fetch = async (input) => {
      expect(String(input)).toContain("/api/missions/mission-demo-402/guard");

      return new Response(
        JSON.stringify({
          source: "runtime_api",
          evidenceMode: "fallback",
          mission: {
            id: "mission-demo-402",
            userPrompt: workspace.mission.userPrompt,
            budgetUsd: workspace.mission.budgetUsd,
            resourceUrl: workspace.mission.resourceUrl,
            status: "blocked",
            cawWalletUuid: "runtime-demo-wallet",
            cawWalletAddress: "0xCAW0000000000000000000000000000000000001",
            pactId: "runtime-demo-pact",
            createdAt: 1_800_000_000_000,
            evidenceMode: "fallback",
            source: "runtime_api"
          },
          paymentContext: {
            ...workspace.paymentContext,
            evidenceMode: "fallback"
          },
          paymentContextHash: workspace.paymentContext.paymentContextHash,
          cawRequestId: workspace.paymentContext.requestId,
          guard: {
            decision: "fallback_required",
            status: "prepared",
            guardEventId: "guard-runtime-1",
            reason: "Mission Flow Runtime API is in fallback/demo mode and does not execute real CAW payments.",
            evidenceMode: "fallback"
          },
          cawEvidence: {
            evidenceMode: "fallback",
            decision: "fallback_required",
            requestId: workspace.paymentContext.requestId,
            walletAddress: "0xCAW0000000000000000000000000000000000001"
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    const result = await runPreferredMissionFlowAction(workspace, "prepare-guard", {
      fetcher,
      now: 1_800_000_000_100
    });

    expect(result.usedRuntime).toBe(true);
    expect(result.workspace.actionSource).toBe("runtime_api");
    expect(result.workspace.mission.status).toBe("blocked");
    expect(result.workspace.paymentContext.evidenceMode).toBe("fallback");
    expect(result.workspace.caw.evidenceMode).toBe("fallback");
    expect(result.workspace.caw.auditLogs[0]?.note).toContain("does not execute real CAW payments");
    expect(result.workspace.mission.evidenceMode).not.toBe("live");
  });

  test("keeps dashboard CAW boundary recording as fallback demo state without calling runtime guard", async () => {
    let workspace = createInitialWorkspace({
      runtime,
      provider,
      preset: "demo"
    });
    workspace = applyDashboardAction(workspace, { type: "create-mission" }, 1_800_000_000_000);

    let called = false;
    const fetcher: typeof fetch = async () => {
      called = true;
      return new Response("{}", { status: 500 });
    };

    const result = await runPreferredMissionFlowAction(workspace, "execute-payment", {
      fetcher,
      now: 1_800_000_000_100
    });

    expect(called).toBe(false);
    expect(result.usedRuntime).toBe(false);
    expect(result.source).toBe("frontend_fallback");
    expect(result.fallbackReason).toContain("BOT Chain evidence recording");
    expect(result.workspace.receipt.evidenceMode).toBe("fallback");
    expect(result.workspace.receipt.paymentReceipt.txHash).toBeUndefined();
    expect(result.workspace.timeline[0]?.detail).toContain("BOT Chain settlement evidence is not recorded yet");
  });

  test("does not rewrite server-side source or evidenceMode into live", () => {
    const evidence = buildServerSideEvidenceExport({
      json: JSON.stringify({
        version: "clear402.evidence-export.v1",
        generatedAt: 1_800_000_000_000,
        missionId: "mission-demo-402",
        source: "demo_fixture",
        evidenceMode: "mock"
      }),
      markdown: "Source: `demo_fixture`\nEvidence mode: `mock`",
      now: 1_800_000_000_100
    });

    expect(evidence.source).toBe("server_side");
    expect(evidence.runtimeSource).toBe("demo_fixture");
    expect(evidence.evidenceMode).toBe("mock");
    expect(evidence.json).toContain('"source": "demo_fixture"');
    expect(evidence.json).toContain('"evidenceMode": "mock"');
    expect(evidence.json).not.toContain('"evidenceMode": "live"');
  });

  test("redacts secret-like values from displayed evidence exports", () => {
    const serverEvidence = buildServerSideEvidenceExport({
      json: JSON.stringify({
        source: "runtime_db",
        evidenceMode: "fallback",
        generatedAt: 1_800_000_000_000,
        apiKey: "sk-test-supersecret",
        nested: {
          authorization: "Bearer clear402-secret-token"
        },
        note: "operator alice@example.com used CLEAR402_CAW_API_KEY=secret-value"
      }),
      markdown:
        "operator alice@example.com used CLEAR402_CAW_API_KEY=secret-value with Bearer clear402-secret-token"
    });
    const fallbackEvidence = buildEvidenceExport(
      createInitialWorkspace({ runtime, provider, preset: "demo" })
    );
    const rendered = [
      serverEvidence.json,
      serverEvidence.markdown,
      fallbackEvidence.json,
      fallbackEvidence.markdown
    ].join("\n");

    expect(rendered).not.toContain("sk-test-supersecret");
    expect(rendered).not.toContain("clear402-secret-token");
    expect(rendered).not.toContain("CLEAR402_CAW_API_KEY=secret-value");
    expect(rendered).not.toContain("alice@example.com");
    expect(rendered).not.toContain("CUST-1442");
    expect(rendered).not.toContain("API token xyz");
    expect(rendered).toContain("[redacted-secret]");
  });
});
