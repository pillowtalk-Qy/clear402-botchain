import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { chromium, type Browser, type Page } from "@playwright/test";

const root = resolve(import.meta.dirname, "..");
const outputDir = join(root, "outputs", "demo-video");
const rawDir = join(outputDir, "raw");
const finalMp4 = join(outputDir, "clear402-botchain-demo.mp4");
const finalWebm = join(outputDir, "clear402-botchain-demo.webm");
const runtimeUrl = "http://127.0.0.1:4000/health";
const providerUrl = "http://127.0.0.1:4010/health";
const dashboardUrl = "http://127.0.0.1:3000";
const pauseScale = Number.parseFloat(process.env.DEMO_PAUSE_SCALE ?? "2.3");

const spawned: ChildProcessWithoutNullStreams[] = [];

async function main() {
  await mkdir(rawDir, { recursive: true });
  await rm(rawDir, { recursive: true, force: true });
  await mkdir(rawDir, { recursive: true });

  await ensureService("runtime", runtimeUrl, [
    "pnpm",
    ["--filter", "@clear402/runtime", "dev"],
    {
      CLEAR402_RUNTIME_DATABASE_PATH: join(outputDir, "runtime-demo-video.sqlite")
    }
  ]);
  await ensureService("provider", providerUrl, ["pnpm", ["--filter", "@clear402/provider-x402", "dev"], {}]);
  await ensureService("dashboard", dashboardUrl, [
    "pnpm",
    ["--filter", "dashboard", "dev", "--hostname", "127.0.0.1", "--port", "3000"],
    {
      RUNTIME_HEALTH_URL: runtimeUrl,
      PROVIDER_X402_HEALTH_URL: providerUrl
    }
  ]);

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      recordVideo: {
        dir: rawDir,
        size: { width: 1440, height: 900 }
      }
    });
    const page = await context.newPage();
    await recordDashboard(page);
    const video = page.video();
    await context.close();

    const videoPath = await video?.path();
    if (!videoPath || !existsSync(videoPath)) {
      throw new Error("Playwright did not produce a video file.");
    }

    await convertVideo(videoPath);
    console.log(JSON.stringify({ ok: true, mp4: finalMp4, webm: finalWebm }, null, 2));
  } finally {
    await browser?.close().catch(() => undefined);
    for (const child of spawned.reverse()) {
      child.kill("SIGTERM");
    }
  }
}

async function recordDashboard(page: Page) {
  await page.goto(dashboardUrl, { waitUntil: "networkidle" });
  await installCaption(page);

  await caption(
    page,
    "Clear402 for BOT Chain: an AI-agent payment guard for x402-style paid APIs, with BOT Chain as the EVM settlement layer."
  );
  await pause(2500);

  await highlight(page, '[data-testid="panel-bot-chain-settlement"]');
  await caption(
    page,
    "The BOT Chain Settlement panel is loaded from live testnet evidence: ServiceEscrow is confirmed and the explorer links are attached."
  );
  await pause(3000);

  await clickExplorerTx(page);
  await caption(page, "The deliver transaction is visible on the BOT Chain explorer.");
  await pause(3500);
  await page.goto(dashboardUrl, { waitUntil: "networkidle" });
  await installCaption(page);

  await page.getByTestId("action-create-mission").click();
  await caption(page, "First, create an agent payment mission. The local provider requires payment for a protected API resource.");
  await pause(1800);

  await page.getByTestId("action-dry-run-402").click();
  await highlight(page, '[data-testid="panel-x402-challenge-inspector"]');
  await caption(
    page,
    "The x402-style challenge is normalized before any settlement claim: provider, resource, chain, and amount become inspectable evidence."
  );
  await pause(2800);

  await page.getByTestId("action-prepare-guard").click();
  await highlight(page, '[data-testid="panel-paymentcontext-panel"]');
  await caption(
    page,
    "PaymentContext binds the paid resource, provider, nonce, amount, and policy into a hash. That hash is the anchor for settlement evidence."
  );
  await pause(3200);

  await scrollTo(page, '[data-testid="panel-provider-registry-erc-8004-trust-panel"]');
  await highlight(page, '[data-testid="panel-provider-registry-erc-8004-trust-panel"]');
  await caption(page, "Provider registry and ERC-8004-style trust checks stop resource or identity substitution before payment.");
  await pause(2500);

  await scrollTo(page, '[data-testid="panel-metadata-firewall-diff"]');
  await highlight(page, '[data-testid="panel-metadata-firewall-diff"]');
  await caption(page, "The metadata firewall redacts sensitive fields and records exactly what was changed.");
  await pause(2500);

  await scrollTo(page, '[data-testid="panel-clear-signing-panel"]');
  await highlight(page, '[data-testid="panel-clear-signing-panel"]');
  await caption(page, "Clear signing decodes transaction intent and blocks unsafe calldata instead of blindly approving agent spending.");
  await pause(2800);

  await page.getByTestId("action-execute-payment").click();
  await scrollTo(page, '[data-testid="panel-service-receipt-panel"]');
  await highlight(page, '[data-testid="panel-service-receipt-panel"]');
  await caption(page, "Recorded BOT Chain evidence can be attached to the payment receipt, while the runtime keeps production claims conservative.");
  await pause(3000);

  await page.getByTestId("action-verify-receipt").click();
  await caption(
    page,
    "Boundary: the dashboard has live BOT Chain testnet evidence, but runtime verification stays fallback unless production payment execution is proven."
  );
  await pause(3200);

  await scrollTo(page, '[data-testid="panel-attack-lab-panel"]');
  await page.getByTestId("attack-card-replay").click();
  await page.getByTestId("action-run-replay-same-nonce").click();
  await highlight(page, '[data-testid="panel-attack-lab-panel"]');
  await caption(
    page,
    "Attack Lab uses modeled attack inputs but runs them through the real guard pipeline. Replay is blocked with a guard event id."
  );
  await pause(3500);

  await caption(
    page,
    "Completed demo: x402-style challenge, Clear402 guard pipeline, BOT Chain testnet ServiceEscrow evidence, and security regression checks."
  );
  await pause(3500);
}

async function clickExplorerTx(page: Page) {
  const panel = page.getByTestId("panel-bot-chain-settlement");
  const txLinks = panel.getByRole("link", { name: "open tx" });
  const count = await txLinks.count();
  if (count === 0) {
    return;
  }
  const popupPromise = page.waitForEvent("popup", { timeout: 2_000 }).catch(() => undefined);
  await txLinks.nth(count - 1).click();
  const popup = await popupPromise;
  if (popup) {
    await popup.waitForLoadState("domcontentloaded").catch(() => undefined);
    await pause(1_500);
    await popup.close();
    return;
  }
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
}

async function installCaption(page: Page) {
  await page.evaluate(() => {
    const existing = document.getElementById("clear402-demo-caption");
    if (existing) return;

    const caption = document.createElement("div");
    caption.id = "clear402-demo-caption";
    caption.style.position = "fixed";
    caption.style.left = "32px";
    caption.style.right = "32px";
    caption.style.bottom = "76px";
    caption.style.zIndex = "999999";
    caption.style.padding = "14px 18px";
    caption.style.borderRadius = "10px";
    caption.style.background = "rgba(6, 20, 16, 0.92)";
    caption.style.color = "#f7fff7";
    caption.style.font = "600 20px/1.28 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    caption.style.boxShadow = "0 18px 45px rgba(0, 0, 0, 0.28)";
    caption.style.border = "1px solid rgba(174, 238, 201, 0.35)";
    caption.style.pointerEvents = "none";
    document.body.appendChild(caption);
  });
}

async function caption(page: Page, text: string) {
  await installCaption(page);
  await page.evaluate((value) => {
    const caption = document.getElementById("clear402-demo-caption");
    if (caption) caption.textContent = value;
  }, text);
}

async function highlight(page: Page, selector: string) {
  await scrollTo(page, selector);
  await page.evaluate((value) => {
    for (const element of document.querySelectorAll("[data-demo-highlight]")) {
      const htmlElement = element as HTMLElement;
      htmlElement.style.outline = "";
      htmlElement.style.boxShadow = "";
      htmlElement.removeAttribute("data-demo-highlight");
    }

    const target = document.querySelector(value) as HTMLElement | null;
    if (!target) return;
    target.setAttribute("data-demo-highlight", "true");
    target.style.outline = "4px solid rgba(32, 201, 112, 0.88)";
    target.style.boxShadow = "0 0 0 8px rgba(32, 201, 112, 0.18), 0 22px 60px rgba(0, 0, 0, 0.24)";
  }, selector);
}

async function scrollTo(page: Page, selector: string) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  await pause(350);
}

async function ensureService(
  name: string,
  url: string,
  command: [string, string[], Record<string, string>]
) {
  if (await isHealthy(url)) {
    console.log(`${name}: already running`);
    return;
  }

  const [cmd, args, env] = command;
  const child = spawn(cmd, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "pipe"
  });
  spawned.push(child);
  child.stdout.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));

  const started = Date.now();
  while (Date.now() - started < 90_000) {
    if (await isHealthy(url)) {
      console.log(`${name}: ready`);
      return;
    }
    await pause(500);
  }

  throw new Error(`${name} did not become healthy at ${url}`);
}

async function isHealthy(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(750) });
    return response.ok;
  } catch {
    return false;
  }
}

async function convertVideo(videoPath: string) {
  await run("cp", [videoPath, finalWebm]);
  await run("ffmpeg", [
    "-y",
    "-i",
    videoPath,
    "-vf",
    "format=yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "22",
    "-movflags",
    "+faststart",
    finalMp4
  ]);
  const files = await readdir(outputDir);
  console.log(`outputs/demo-video: ${files.join(", ")}`);
}

async function run(cmd: string, args: string[]) {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd: root, stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`${cmd} exited with ${code}`));
      }
    });
  });
}

function pause(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, Math.round(ms * pauseScale)));
}

main().catch((error) => {
  console.error(error);
  for (const child of spawned.reverse()) {
    child.kill("SIGTERM");
  }
  process.exit(1);
});
