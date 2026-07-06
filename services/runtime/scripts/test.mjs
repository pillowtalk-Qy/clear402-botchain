import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const packageRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const testRoot = join(packageRoot, "test");
const args = process.argv.slice(2);
const allTestFiles = [...collectTestFiles(testRoot)];

let nodeArgs = ["--test"];
const selectedFiles = args
  .map((arg) => resolveTestFile(arg))
  .filter((file) => file !== undefined);

if (selectedFiles.length > 0) {
  nodeArgs.push(...selectedFiles);
} else if (args.length > 0) {
  nodeArgs.push("--test-name-pattern", args.join("|"), ...allTestFiles);
} else {
  nodeArgs.push(...allTestFiles);
}

const result = spawnSync(process.execPath, nodeArgs, {
  cwd: packageRoot,
  stdio: "inherit"
});

process.exit(result.status ?? 1);

function resolveTestFile(arg) {
  const directPath = join(packageRoot, arg);
  if (existsSync(directPath) && statSync(directPath).isFile()) {
    return directPath;
  }

  const testPath = join(testRoot, arg.endsWith(".test.mjs") ? arg : `${arg}.test.mjs`);
  if (existsSync(testPath) && statSync(testPath).isFile()) {
    return testPath;
  }

  return undefined;
}

function* collectTestFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      yield* collectTestFiles(fullPath);
    } else if (fullPath.endsWith(".test.mjs")) {
      yield fullPath;
    }
  }
}
