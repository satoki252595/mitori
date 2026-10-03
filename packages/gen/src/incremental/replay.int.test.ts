// WP-06b acceptance: replay crit's last 40 commits over a doc generated (scripted engine, 0 tokens) at HEAD~40 and
// price the S9 suggestions of every commit against Pass 1 (gen.incremental.typical / .mean, bench/budgets/gen.json).
// Skipped when no crit clone with ≥ 41 commits is available (`bun run corpus:fetch --only crit`, or
// MITORI_CORPUS_FROM=<dir containing crit/>).
import { afterAll, describe, expect, test } from "bun:test";
import { corpusRepo, openReplay, type Replay, type ReplayStep } from "./test/replay.ts";

const COMMITS = 40;
const CRIT = corpusRepo("crit", COMMITS + 1);
let replay: Replay | null = null;
afterAll(async () => {
  await replay?.close();
});

describe("GEN-S9-AT crit replay: incremental cost vs Pass 1 (§11.4)", () => {
  test.skipIf(CRIT === null)(
    "≤ 3 files and no interface change ⇒ ≤ 10 % of Pass 1 each (target 5 % on average); all commits ≤ 15 % on average",
    async () => {
      replay = await openReplay(CRIT as string, COMMITS);
      const r = replay;
      const est = await r.gen.estimate({ effort: "standard" });
      const pass1 = { tokens: est.inTokens + est.cacheReadTokens + est.cacheWriteTokens + est.outTokens, usd: est.apiUsd };
      await r.gen.start(est.id);
      await r.gen.idle();
      expect(Object.keys(r.doc.index().claims).length).toBeGreaterThan(50);
      const steps: ReplayStep[] = [];
      const ms: number[] = [];
      const failed: string[] = [];
      for (const sha of r.commits) {
        const calls = r.engine.calls.length;
        const step = await r.step(sha);
        // D12: S9 only suggests — no engine call happens until a suggestion is started
        expect(r.engine.calls.length).toBe(calls);
        ms.push(step.out.ms);
        steps.push(step);
        failed.push(...(await r.apply(step.out)).failed.map((f) => `${sha.slice(0, 7)} ${f}`));
      }
      expect(failed).toEqual([]);
      const ratio = (s: ReplayStep) => s.tokens / pass1.tokens;
      const typical = steps.filter((s) => s.files <= 3 && s.ifaceChanged === 0);
      const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
      const pct = (x: number) => `${(100 * x).toFixed(2)}%`;
      const rows = steps.map(
        (s) =>
          `${s.sha.slice(0, 7)} files=${String(s.files).padStart(3)} iface=${s.ifaceChanged} stale=${s.out.staleClaims.length} ${s.out.suggestions.map((x) => `${x.rule}:${x.kind}:${x.section}`).join(" ") || "-"} ${pct(ratio(s))} $${s.usd.toFixed(4)}`,
      );
      const summary = {
        pass1,
        commits: steps.length,
        typical: typical.length,
        typicalMax: pct(Math.max(0, ...typical.map(ratio))),
        typicalMean: pct(mean(typical.map(ratio))),
        mean: pct(mean(steps.map(ratio))),
        usdMean: mean(steps.map((s) => s.usd / pass1.usd)),
        s9msMax: Math.max(...ms),
        s9msTypicalMax: Math.max(0, ...typical.map((s) => s.out.ms)),
      };
      console.log(`[GEN-S9-AT] crit last ${COMMITS} commits\n${rows.join("\n")}\n${JSON.stringify(summary)}`);
      expect(typical.length).toBeGreaterThan(5);
      for (const s of typical) expect(ratio(s)).toBeLessThanOrEqual(0.1);
      expect(mean(typical.map(ratio))).toBeLessThanOrEqual(0.05);
      expect(mean(steps.map(ratio))).toBeLessThanOrEqual(0.15);
      // S9 itself (marking + rules + the estimates of its suggestions) stays off the save → badge path's budget scale
      expect(summary.s9msTypicalMax).toBeLessThan(100);
    },
    180_000,
  );
});
