import { once } from "node:events";

import {
  createRuntimeServer,
  getAttackLabCapabilityReport,
  listAttackLabScenarios
} from "../services/runtime/src/server.mjs";

const now = 1_800_000_000_000;
const capabilityReport = getAttackLabCapabilityReport();
const server = createRuntimeServer({ capabilityReport, now });
const host = "127.0.0.1";

server.listen(0, host);
await once(server, "listening");

const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;
const baseUrl = `http://${host}:${port}`;

try {
  const health = await fetch(`${baseUrl}/health`);
  if (!health.ok) {
    throw new Error(`Health check failed with status ${health.status}`);
  }

  const results = [];
  for (const attackName of listAttackLabScenarios()) {
    const response = await fetch(`${baseUrl}/api/attacks/${encodeURIComponent(attackName)}/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ now })
    });

    const body = await response.json();
    if (!response.ok) {
      throw new Error(`Attack ${attackName} failed with ${response.status}: ${JSON.stringify(body)}`);
    }

    if (body.decision !== "blocked") {
      throw new Error(`Attack ${attackName} expected blocked outcome, got ${body.decision}`);
    }

    if (!body.guardEventId) {
      throw new Error(`Attack ${attackName} did not return a guardEventId`);
    }

    results.push(body);
    console.log(`${attackName}: ${body.decision} via ${body.blockedBy}`);
  }

  console.log(JSON.stringify(results, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
}
