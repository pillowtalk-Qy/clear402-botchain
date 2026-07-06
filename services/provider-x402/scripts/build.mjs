import { mkdirSync, cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const packageRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const srcDir = join(packageRoot, "src");
const distDir = join(packageRoot, "dist");

const check = spawnSync(process.execPath, ["scripts/lint.mjs"], {
  cwd: packageRoot,
  stdio: "inherit"
});

if (check.status !== 0) {
  process.exit(check.status ?? 1);
}

rmSync(distDir, { force: true, recursive: true });
mkdirSync(distDir, { recursive: true });
cpSync(srcDir, distDir, { recursive: true });
