// INT-05 (MILESTONES §5, M2): the session engine — `gen --prep` writes a packet, a stand-in for the user's agent
// writes out/*.ndjson from the task inputs (scenario router), `mitori check` validates each file, `gen --ingest`
// applies them through the same line validator, and `next` chains the phases until the run is complete.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckReport, DocOutline, IngestReport, PrepInfo, WorkspaceKey } from "@mitori/core";
import type { PrepTaskEntry } from "@mitori/gen";
import { buildFixture, type FixtureRepo } from "@mitori/testkit";
import { type Int, startInt } from "./harness.ts";
import { routeGen } from "./router.ts";

let int: Int;
let repo: FixtureRepo;
let ws: WorkspaceKey;

beforeAll(async () => {
  repo = await buildFixture("go-small");
  int = await startInt();
  ws = (await int.open(repo.root)).ws;
}, 60_000);
afterAll(async () => {
  await int?.close();
  await repo?.dispose();
});

describe("INT-05 session engine: prep → agent writes out/ → check → ingest → NEXT", () => {
  test("every phase validates and ingests; the doc gains AI blocks with 0 engine calls", async () => {
    let prep = await int.json<PrepInfo>("POST", `/ws/${ws}/gen/prep`, { effort: "standard" });
    const phases: number[] = [];
    for (let guard = 0; guard < 6; guard++) {
      phases.push(prep.phase);
      expect(readFileSync(prep.readme, "utf8")).toContain(`mitori.prep/1 ${prep.id}`);
      const tasks = JSON.parse(readFileSync(join(prep.dir, "tasks.json"), "utf8")) as PrepTaskEntry[];
      expect(tasks.length).toBe(prep.tasks);
      mkdirSync(join(prep.dir, "out"), { recursive: true });
      for (const t of tasks) {
        const out = join(prep.dir, t.out);
        writeFileSync(out, `${routeGen(readFileSync(join(prep.dir, t.input), "utf8")).join("\n")}\n`);
        const check = await int.json<CheckReport>("POST", `/ws/${ws}/check`, { kind: "gen-output", path: out });
        expect({ task: t.id, ok: check.ok, errors: check.errors }).toMatchObject({ task: t.id, ok: true });
      }
      const report = await int.json<IngestReport>("POST", `/ws/${ws}/gen/ingest`, { prep: prep.id, fingerprint: prep.fingerprint, partial: false });
      expect({ ok: report.ok, errors: report.errors, missing: report.missing }).toEqual({ ok: true, errors: [], missing: [] });
      expect(report.accepted.tasks).toBe(prep.tasks);
      if (!report.next) break;
      prep = await int.json<PrepInfo>("POST", `/ws/${ws}/gen/prep`, { effort: "standard", continueFrom: prep.id });
    }
    console.log(`[INT-05] phases=${phases.join(",")}`);
    expect(phases.length).toBeGreaterThanOrEqual(1);
    const outline = await int.json<DocOutline>("GET", `/ws/${ws}/doc`);
    const ai = outline.blocks.filter((b) => b[3] !== "heading" && b[4] !== null);
    expect(ai.length).toBeGreaterThan(0);
    const usage = await int.json<{ totals: { calls: number } }>("GET", "/usage/summary?range=today");
    expect(usage.totals.calls).toBe(0);
  }, 90_000);
});
