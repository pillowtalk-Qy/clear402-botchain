import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["src", "test", "scripts"];

for (const file of findModuleFiles(roots)) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function* findModuleFiles(paths) {
  for (const path of paths) {
    const fullPath = join(new URL("..", import.meta.url).pathname, path);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      for (const child of readdirSync(fullPath)) {
        yield* findModuleFiles([join(path, child)]);
      }
    } else if (fullPath.endsWith(".mjs")) {
      yield fullPath;
    }
  }
}
