import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
    environment: "node",
    globals: true,
    passWithNoTests: true,
    testTimeout: 15_000
  }
});
