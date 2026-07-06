import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";

const artifactsDir = join(process.cwd(), "e2e-results");
const runtimeUrl = "http://127.0.0.1:4000";
const providerUrl = "http://127.0.0.1:4010";

test.beforeAll(() => {
  mkdirSync(artifactsDir, { recursive: true });
});

test("dashboard browser E2E covers happy, denied, attack, and evidence export", async ({
  page,
  request
}, testInfo) => {
  await assertServiceHealth(request, `${runtimeUrl}/health`, "runtime");
  await assertServiceHealth(request, `${providerUrl}/health`, "provider-x402");

  const missionId = await createApiMission(request);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Clear402 for BOT Chain" })).toBeVisible();
  const modePanel = page.getByTestId("panel-live-fallback-mock");
  await expect(modePanel).toContainText("http://127.0.0.1:4000/health");
  await expect(modePanel).toContainText("http://127.0.0.1:4010/health");

  await happyPath(page, missionId, request);
  await deniedPath(page, request);
  await attackPath(page, request);
  await exportEvidence(page, testInfo);
});

async function happyPath(page: Page, missionId: string, request: APIRequestContext) {
  await page.getByTestId("action-create-mission").click();
  await expect(page.getByTestId("panel-mission-console")).toContainText("ServiceEscrow");
  await expect(page.getByTestId("panel-live-fallback-mock")).toContainText("runtime_api");

  await page.getByTestId("action-dry-run-402").click();
  const challengePanel = page.getByTestId("panel-x402-challenge-inspector");
  await expect(challengePanel).toContainText("botchain_service_escrow");
  await expect(challengePanel).toContainText("provider-runtime-demo");

  const dryRun = await request.post(`${runtimeUrl}/api/missions/${missionId}/dry-run`);
  expect(dryRun.ok()).toBeTruthy();
  const dryRunPayload = await dryRun.json();
  expect(dryRunPayload.settlementPath).toBe("botchain_service_escrow");

  await page.getByTestId("action-prepare-guard").click();
  const paymentContextPanel = page.getByTestId("panel-paymentcontext-panel");
  await expect(paymentContextPanel).toContainText("clear402.payment.v1");
  await expect(page.getByTestId("panel-guard-settlement-timeline")).toContainText("Runtime guard prepared settlement");
  const botChainPanel = page.getByTestId("panel-bot-chain-settlement");
  await expect(botChainPanel).toContainText("confirmed");
  await expect(botChainPanel).toContainText("live");
  await expect(botChainPanel).toContainText("0x67c8fbf5adc3ba683a7b3667e6a1a5e4374ba3b8");
  await expect(botChainPanel).toContainText("0x746f4dea40d4a6f249e5e834fd13db0ba7e89c2891c95c74d202af53ff4892e0");

  const guard = await request.post(`${runtimeUrl}/api/missions/${missionId}/guard`);
  expect(guard.ok()).toBeTruthy();
  const guardPayload = await guard.json();
  expect(guardPayload.guard.decision).toBe("fallback_required");
  expect(guardPayload.cawEvidence.decision).toBe("fallback_required");
  expect(guardPayload.cawEvidence.denial.details.paymentAttempted).toBe(false);
  expect(guardPayload.cawEvidence.txHash).toBeUndefined();

  await page.getByTestId("action-execute-payment").click();
  await expect(page.getByTestId("panel-service-receipt-panel")).toContainText("paid");
  await expect(page.getByTestId("panel-service-receipt-panel")).toContainText("0x746f4dea");
  await expect(page.getByTestId("panel-bot-chain-settlement")).toContainText("confirmed");

  await page.getByTestId("action-verify-receipt").click();
  const receiptPanel = page.getByTestId("panel-service-receipt-panel");
  await expect(receiptPanel).toContainText("failed");
  await expect(receiptPanel).toContainText("fallback");
  await expect(receiptPanel).toContainText("n/a");

  const verify = await request.post(`${runtimeUrl}/api/missions/${missionId}/verify`);
  expect(verify.ok()).toBeTruthy();
  const verifyPayload = await verify.json();
  expect(verifyPayload.receipt.evidenceMode).toBe("fallback");
  expect(verifyPayload.receipt.paymentReceipt.txHash).toBeUndefined();
  expect(verifyPayload.receipt.finalStatus).toBe("failed");

  await expect(page.locator(".bottom-strip")).toContainText("records BOT Chain settlement evidence");
}

async function deniedPath(page: Page, request: APIRequestContext) {
  await page.getByTestId("attack-card-denied").click();
  await page.getByTestId("action-run-paid-but-denied").click();
  const attackPanel = page.getByTestId("panel-attack-lab-panel");
  await expect(attackPanel).toContainText("blocked");
  await expect(attackPanel).toContainText("Paid-but-denied");
  await expect(attackPanel).toContainText("Service receipt");

  const deniedMissionId = `mission-e2e-overspend-${Date.now()}`;
  const create = await request.post(`${runtimeUrl}/api/missions`, {
    data: {
      missionId: deniedMissionId,
      userPrompt: "E2E overspend denial path",
      budgetUsd: "0.01",
      resourceUrl: "https://127.0.0.1:4010/paid/report?topic=market-intel"
    }
  });
  expect(create.status()).toBe(201);

  const guard = await request.post(`${runtimeUrl}/api/missions/${deniedMissionId}/guard`);
  expect(guard.ok()).toBeTruthy();
  const guardPayload = await guard.json();
  expect(guardPayload.guard.decision).toBe("block");
  expect(guardPayload.guard.reason).toContain("Budget limit would be exceeded");
}

async function attackPath(page: Page, request: APIRequestContext) {
  await page.getByTestId("attack-card-replay").click();
  await page.getByTestId("action-run-replay-same-nonce").click();
  const attackPanel = page.getByTestId("panel-attack-lab-panel");
  await expect(attackPanel).toContainText("blocked");
  await expect(attackPanel).toContainText("Quote reservation / nonce lock");
  await expect(attackPanel).toContainText("guard-replay-1");

  const cliProbe = await request.get(`${runtimeUrl}/health`);
  expect(cliProbe.ok()).toBeTruthy();
}

async function exportEvidence(page: Page, testInfo: TestInfo) {
  await page.getByTestId("action-export-evidence").click();
  const exportPanel = page.getByTestId("panel-evidence-export-panel");
  await expect(exportPanel).toContainText("ready / server-side / runtime_db");
  await expect(exportPanel).toContainText("clear402.evidence-export.v1");
  await expect(exportPanel).toContainText("fallback");

  const projectName = testInfo.project.name;
  const screenshotPath = join(artifactsDir, `${projectName}-dashboard.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach(`${projectName} dashboard screenshot`, {
    path: screenshotPath,
    contentType: "image/png"
  });

  if (projectName !== "desktop-chromium") {
    return;
  }

  const jsonText = await exportPanel.locator(".json-block pre").first().innerText();
  const renderedJson = JSON.parse(jsonText);
  const evidence = typeof renderedJson === "string" ? JSON.parse(renderedJson) : renderedJson;
  expect(evidence.version).toBe("clear402.evidence-export.v1");
  expect(evidence.evidenceMode).not.toBe("live");
  expect(evidence.erc8004Trust.trustSource).toBe("demo_erc8004");
  expect(evidence.erc8004Trust.registrationStatus).toBe("needs_registration");
  expect(evidence.erc8004Trust.evidenceMode).toBe("mock");
  expect(evidence.guard.decision).toBe("fallback_required");
  expect(evidence.serviceReceipt.evidenceMode).toBe("fallback");
  expect(evidence.serviceReceipt.txHash).toBeUndefined();
  const markdownText = await exportPanel.locator(".markdown-block pre").innerText();
  const evidenceJsonPath = join(artifactsDir, "dashboard-evidence-export.json");
  const evidenceMdPath = join(artifactsDir, "dashboard-evidence-export.md");
  writeFileSync(evidenceJsonPath, `${JSON.stringify(evidence, null, 2)}\n`);
  writeFileSync(evidenceMdPath, `${markdownText}\n`);

  await testInfo.attach("dashboard evidence export JSON", {
    path: evidenceJsonPath,
    contentType: "application/json"
  });
  await testInfo.attach("dashboard evidence export markdown", {
    path: evidenceMdPath,
    contentType: "text/markdown"
  });
}

async function createApiMission(request: APIRequestContext) {
  const missionId = `mission-e2e-${Date.now()}`;
  const response = await request.post(`${runtimeUrl}/api/missions`, {
    data: {
      missionId,
      userPrompt: "E2E browser mission",
      budgetUsd: "1000000000000",
      resourceUrl: "https://127.0.0.1:4010/paid/report?topic=market-intel"
    }
  });
  expect(response.status()).toBe(201);
  const payload = await response.json();
  expect(payload.source).toBe("runtime_api");
  expect(payload.evidenceMode).toBe("fallback");
  return missionId;
}

async function assertServiceHealth(
  request: APIRequestContext,
  url: string,
  service: string
) {
  const response = await request.get(url);
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.service).toBe(service);
  expect(payload.status).toBe("ok");
  expect(payload.evidenceMode).toBe("live");
}
