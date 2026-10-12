import { describe, expect, test } from "bun:test";
import type { DocLang, SectionId } from "@mitori/core";
import { createFakeDocStore } from "../test/fake-doc.ts";
import { createFakeIndexer } from "../test/fake-indexer.ts";
import { testHasher, testIds } from "../test/ports.ts";
import { sampleRepo } from "../test/repo.ts";
import { plannedTask } from "../test/tasks.ts";
import { gatherInputs } from "./inputs.ts";

const hasher = testHasher();

function setup() {
  const repo = sampleRepo();
  const indexer = createFakeIndexer(repo, hasher);
  const ids = testIds();
  const doc = createFakeDocStore({ hasher, ids, repo });
  const env = {
    indexer,
    doc,
    lang: "ja" as DocLang,
    tokens: (t: string) => Math.ceil(t.length / 2.3),
    plan: { eager: [], tasks: [] },
  };
  return { indexer, doc, env };
}

const gen = { model: "claude-sonnet-5-5", engine: "claude-cli", stage: "S6o", promptVer: "gen.flows@7", indexDigest: "0" } as const;

/** One steps block citing `path`, in the given flow section. */
function seedFlow(doc: ReturnType<typeof setup>["doc"], section: SectionId, path: string) {
  doc.upsertFlowSection(section.slice(3), section.slice(3), 0);
  doc.applyGenerated(
    [
      {
        id: null,
        section,
        aspect: "steps",
        kind: "list",
        depth: "L2",
        audience: ["dev"],
        lang: "ja",
        md: "1. 受け付ける[[1]]",
        claims: [
          {
            n: 1,
            kind: "behavior",
            quote: "受け付ける",
            cites: [{ path, start: 5, end: 7, blob: "b", snippet: "s", precision: "exact" }],
            checks: { l0: true, l1: "pass", l2: true, checkedAt: "2026-10-03T00:00:00.000Z" },
            verdict: "cited",
          },
        ],
        gen,
      },
    ],
    { mode: "write", deletes: [], source: { kind: "regen", id: "previous" }, reason: "", listed: 0 },
  );
}

describe("WP2 gen.flows EXISTING keeps only flows cited from current seed files", () => {
  test("a flow citing a seed walk file stays; a docs/demo flow citing nothing current is dropped", async () => {
    const { doc, env } = setup();
    // sampleRepo seeds walk src/http/server.ts (route) and src/cli/main.ts (entry)
    seedFlow(doc, "s3/login", "src/http/server.ts");
    seedFlow(doc, "s3/demo", "docs/demo/page.md");
    const task = plannedTask("gen.flows", { kind: "section", id: "s3" }, ["s3"]);
    const inputs = (await gatherInputs(task, env)).inputs;
    expect(inputs.EXISTING_FLOWS?.join("\n")).toContain('> login "login"');
    expect(inputs.EXISTING_FLOWS?.join("\n")).not.toContain("demo");
    expect((inputs.EXISTING ?? []).some((l) => l.includes("section=s3/demo"))).toBe(false);
    expect((inputs.EXISTING ?? []).some((l) => l.includes("section=s3/login"))).toBe(true);
  });
});
