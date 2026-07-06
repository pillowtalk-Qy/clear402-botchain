import assert from "node:assert/strict";
import { once } from "node:events";
import { describe, it } from "node:test";

import {
  createRuntimeServer,
  getAttackLabCapabilityReport,
  listAttackLabScenarios,
  runAttackLabScenario
} from "../src/server.mjs";

describe("attack lab", () => {
  const capabilityReport = getAttackLabCapabilityReport();

  it("exposes the full 16-attack matrix", () => {
    assert.equal(listAttackLabScenarios().length, 16);
    assert.deepEqual(
      listAttackLabScenarios(),
      [
        "replay_same_proof",
        "cross_resource_substitution",
        "pii_leakage",
        "dynamic_price_overspend",
        "malicious_approve",
        "discovery_poisoning",
        "paid_but_denied",
        "erc8004_identity_mismatch",
        "low_reputation_provider",
        "header_confusion_duplicate_x_payment",
        "cache_confusion",
        "concurrent_free_riding_20_requests",
        "settlement_path_substitution",
        "partial_payment_decimals_confusion",
        "malformed_delivery",
        "multicall_hidden_operation"
      ]
    );
  });

  it("runs each attack through the real guard pipeline", async () => {
    for (const attackName of listAttackLabScenarios()) {
      const result = await runAttackLabScenario(attackName, {
        capabilityReport,
        now: 1_800_000_000_000
      });

      assert.equal(result.attack, attackName);
      assert.equal(result.decision, "blocked");
      assert.match(result.guardEventId ?? "", /^evt_/);
      assert.ok(result.blockedBy);
      assert.ok(result.paperMapping?.paper);
      assert.ok(result.evidence);

      if (attackName === "paid_but_denied") {
        assert.equal(result.guard.receipt?.status, "paid_but_not_delivered");
      }

      if (attackName === "replay_same_proof") {
        assert.equal(result.attempts?.[0]?.decision, "allow");
        assert.equal(result.replayEvidence?.secondDecision, "block");
      }

      if (attackName === "concurrent_free_riding_20_requests") {
        assert.equal(result.summary?.allowed, 1);
        assert.equal(result.summary?.blocked, 19);
      }
    }
  });

  it("exposes the POST attack route", async () => {
    const server = createRuntimeServer({
      capabilityReport,
      now: 1_800_000_000_000
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/attacks/replay_same_proof/run`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({ now: 1_800_000_000_000 })
        }
      );
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.attack, "replay_same_proof");
      assert.equal(body.decision, "blocked");
      assert.match(body.guardEventId ?? "", /^evt_/);
    } finally {
      server.close();
      await once(server, "close");
    }
  });

  it("distinguishes paid-but-denied from malformed delivery", async () => {
    const paidButDenied = await runAttackLabScenario("paid_but_denied", {
      capabilityReport,
      now: 1_800_000_000_000
    });
    const malformed = await runAttackLabScenario("malformed_delivery", {
      capabilityReport,
      now: 1_800_000_000_000
    });

    assert.equal(paidButDenied.guard.receipt?.status, "paid_but_not_delivered");
    assert.equal(malformed.guard.receipt?.status, "failed");
    assert.match(malformed.guard.reason ?? "", /responseBodyShape|responseSchema/);
  });
});
