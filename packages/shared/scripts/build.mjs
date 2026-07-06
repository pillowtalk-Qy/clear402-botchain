import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const srcDir = new URL("../src", import.meta.url);
const files = readdirSync(srcDir).filter((file) => file.endsWith(".mjs"));

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", join(srcDir.pathname, file)], {
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
