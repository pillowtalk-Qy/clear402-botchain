#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(root, "ServiceEscrow.sol");
const artifactDir = resolve(root, "artifacts");
const abiDir = resolve(root, "abi");

const source = await import("node:fs/promises").then(({ readFile }) =>
  readFile(sourcePath, "utf8")
);
const solc = await import("solc").then((module) => module.default ?? module);

const input = {
  language: "Solidity",
  sources: {
    "ServiceEscrow.sol": {
      content: source
    }
  },
  settings: {
    optimizer: {
      enabled: true,
      runs: 200
    },
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode", "evm.deployedBytecode", "metadata"]
      }
    }
  }
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = output.errors ?? [];
const fatalErrors = errors.filter((entry) => entry.severity === "error");
for (const entry of errors) {
  const printer = entry.severity === "error" ? console.error : console.warn;
  printer(entry.formattedMessage ?? entry.message);
}

if (fatalErrors.length > 0) {
  process.exit(1);
}

const contract = output.contracts?.["ServiceEscrow.sol"]?.ServiceEscrow;
if (!contract?.abi || !contract?.evm?.bytecode?.object) {
  console.error("Solidity output did not include ServiceEscrow ABI and bytecode.");
  process.exit(1);
}

await mkdir(artifactDir, { recursive: true });
await mkdir(abiDir, { recursive: true });

const artifact = {
  contractName: "ServiceEscrow",
  sourceName: "ServiceEscrow.sol",
  abi: contract.abi,
  bytecode: `0x${contract.evm.bytecode.object}`,
  deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
  metadata: JSON.parse(contract.metadata)
};

await writeFile(
  resolve(artifactDir, "ServiceEscrow.json"),
  `${JSON.stringify(artifact, null, 2)}\n`
);
await writeFile(
  resolve(abiDir, "ServiceEscrow.json"),
  `${JSON.stringify(contract.abi, null, 2)}\n`
);

console.log(JSON.stringify({
  contract: "ServiceEscrow",
  artifact: "contracts/artifacts/ServiceEscrow.json",
  abi: "contracts/abi/ServiceEscrow.json",
  bytecodeBytes: contract.evm.bytecode.object.length / 2
}, null, 2));
