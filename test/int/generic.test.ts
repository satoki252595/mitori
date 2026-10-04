import { expect, test } from "bun:test";
import type { JobEstimate, ThreadDetail } from "@mitori/core";
import { createSpawner } from "@mitori/platform";
import { buildFixture } from "@mitori/testkit";
import { type Int, startInt } from "./harness.ts";
import { RETRY_ANCHOR, RETRY_FILE } from "./router.ts";

test("generic Explain/Fix estimates preserve the model, max effort, and configured prices without an engine call", async () => {
  const repo = await buildFixture("go-small");
  let int: Int | null = null;
  let engineCalls = 0;
  const real = createSpawner({ safePath: process.env.PATH ?? "/usr/bin:/bin" });
  const model = "generic:custom";
  try {
    int = await startInt({
      config: {
        defaultEngine: "generic",
        engines: {
          "claude-cli": { enabled: false },
          session: { enabled: false },
          "anthropic-api": { enabled: false },
          "codex-cli": { enabled: false },
          generic: { enabled: true, argv: [process.execPath], protocol: "text", pricing: { inPerMTok: 7, outPerMTok: 11, cacheReadPerMTok: 1 } },
        },
        models: { answer: model, patch: model },
        reasoning: { answer: "max", patch: "max" },
      },
      spawner: {
        spawn(spec) {
          if (spec.command === process.execPath) {
            engineCalls++;
            throw new Error("estimating must not start the generic engine");
          }
          return real.spawn(spec);
        },
      },
    });
    const { ws } = await int.open(repo.root);
    for (const [kind, intent, mode] of [
      ["explain", "question", "answer"],
      ["fix", "change", "patch"],
    ] as const) {
      const thread = await int.json<ThreadDetail>("POST", `/ws/${ws}/threads`, {
        anchor: { primary: "code", code: { path: RETRY_FILE, ...RETRY_ANCHOR } },
        intent,
        body: kind === "explain" ? "Explain the retry limit." : "Make the retry limit configurable.",
        draft: false,
      });
      const est = await int.json<JobEstimate>("POST", `/ws/${ws}/jobs/estimate`, { kind, threads: [thread.id] });
      expect(est.route).toMatchObject({ mode, model, effort: "max" });
      expect(est.estimate).toMatchObject({ engine: "generic", model });
      expect(est.estimate.inTokens).toBeGreaterThan(0);
      expect(est.estimate.apiUsd).toBeGreaterThan(0);
      expect(est.estimate.apiUsd).toBeCloseTo((est.estimate.inTokens * 7 + est.estimate.outTokens * 11 + est.estimate.cacheReadTokens) / 1e6, 6);
    }
    expect(engineCalls).toBe(0);
  } finally {
    await int?.close();
    await repo.dispose();
  }
}, 60_000);
