// INT-04 (MILESTONES §5, M2): estimate → one click → generation streams blocks (scenario engine through the REAL
// claude-cli engine, normalizer, scheduler and ledger; 0 tokens) → flush → `.mitori/` committed and readable the
// GitHub way (relative cite links that resolve to the cited lines).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import type { EngineStatus, GenEstimate, GenRun, SseEvent, UsageSummary, WorkspaceKey } from "@mitori/core";
import { buildFixture, type FixtureRepo } from "@mitori/testkit";
import type { SseReader } from "../../packages/server/src/http/test/sse-reader.ts";
import { FAKE_CLAUDE_CONFIG, fakeClaude } from "./fake-claude.ts";
import { type Int, startInt } from "./harness.ts";

let int: Int;
let repo: FixtureRepo;
let ws: WorkspaceKey;
let sse: SseReader;
const spawner = fakeClaude({ dtMs: 2, chunkChars: 24 });

beforeAll(async () => {
  repo = await buildFixture("go-small");
  int = await startInt({ spawner, config: FAKE_CLAUDE_CONFIG });
  ws = (await int.open(repo.root)).ws;
  sse = await int.sse(ws);
  await sse.until((e) => e.some((x) => x.type === "hello"));
}, 60_000);
afterAll(async () => {
  sse?.close();
  await int?.close();
  await repo?.dispose();
});

const git = (...args: string[]) =>
  Bun.spawnSync(["git", "-C", repo.root, ...args], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "int",
      GIT_AUTHOR_EMAIL: "int@example.invalid",
      GIT_COMMITTER_NAME: "int",
      GIT_COMMITTER_EMAIL: "int@example.invalid",
    },
  });

describe("INT-04 estimate → run → streaming → committed doc", () => {
  test("claude-cli is detected through the fake binary (subscription, all flags)", async () => {
    const engines = await int.json<EngineStatus[]>("GET", "/engines");
    const claude = engines.find((e) => e.engine === "claude-cli");
    expect(claude).toMatchObject({ installed: true, auth: "subscription" });
    expect(claude?.problems).toEqual([]);
  });

  test("standard generation streams partials then blocks, ledgers one row per engine turn, and commits readable Markdown", async () => {
    const est = await int.json<GenEstimate>("POST", `/ws/${ws}/gen/estimate`, { effort: "standard" });
    expect(est.engine).toBe("claude-cli");
    expect(est.requiresConfirm).toBe(true);
    const run = await int.json<GenRun>("POST", `/ws/${ws}/gen/runs`, { estimateId: est.id, confirm: true });
    expect(run.id).toMatch(/^gr_/);
    await sse.until((e) => e.some((x) => x.type === "gen.run" && x.run.id === run.id && ["done", "failed", "cancelled"].includes(x.run.state)), 60_000);
    const final = sse.events.filter((x): x is Extract<SseEvent, { type: "gen.run" }> => x.type === "gen.run" && x.run.id === run.id).at(-1);
    expect(final?.run.state).toBe("done");

    const types = sse.events.map((x) => x.type);
    const firstPartial = types.indexOf("doc.block.partial");
    const firstUpsert = types.indexOf("doc.block.upsert");
    expect(firstPartial).toBeGreaterThanOrEqual(0);
    expect(firstUpsert).toBeGreaterThan(firstPartial);
    const upserts = sse.events.filter((x): x is Extract<SseEvent, { type: "doc.block.upsert" }> => x.type === "doc.block.upsert");
    expect(upserts.some((u) => u.block.origin === "ai" && u.block.html.startsWith('<div class="mb"'))).toBe(true);

    // zero real tokens; one ledger row per engine turn
    const usage = await int.json<UsageSummary>("GET", "/usage/summary?range=today");
    console.log(`[INT-04] engine turns=${spawner.turns.length} ledger calls=${usage.totals.calls} blocks=${upserts.length}`);
    expect(spawner.turns.length).toBeGreaterThan(0);
    expect(usage.totals.calls).toBe(spawner.turns.length);

    // opt in to committing the doc, flush → commit → GitHub-readable relative cite links
    await int.json("POST", `/ws/${ws}/init`, { lang: "ja", commit: true, agentsBlock: false });
    expect(readFileSync(join(repo.root, ".mitori/.gitignore"), "utf8")).toBe("cache/\ntmp/\n");
    expect(readFileSync(join(repo.root, ".gitattributes"), "utf8")).toContain(".mitori/** linguist-generated=true");
    await int.domain(ws).doc.flush({ force: true });
    const add = git("add", ".mitori");
    expect(add.exitCode).toBe(0);
    const commit = git("commit", "-q", "-m", "docs: mitori");
    expect({ code: commit.exitCode, err: commit.stderr.toString(), out: commit.stdout.toString() }).toMatchObject({ code: 0 });
    const tracked = git("ls-files", ".mitori").stdout.toString().split("\n").filter(Boolean);
    expect(tracked).toEqual(expect.arrayContaining([".mitori/doc.index.json", ".mitori/doc/00-tldr.md"]));
    const links: { file: string; target: string; a: number; b: number }[] = [];
    const docRoot = join(repo.root, ".mitori");
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".md"))
          for (const m of readFileSync(p, "utf8").matchAll(/\]\(([^)\s]+)#L(\d+)(?:-L(\d+))?\)/g))
            links.push({ file: p, target: normalize(join(dirname(p), decodeURI(m[1] as string))), a: Number(m[2]), b: Number(m[3] ?? m[2]) });
      }
    };
    walk(docRoot);
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) {
      expect({ link: l.target, exists: existsSync(l.target) }).toEqual({ link: l.target, exists: true });
      const lines = readFileSync(l.target, "utf8").split("\n").length;
      expect(l.b).toBeLessThanOrEqual(lines);
    }
  }, 90_000);
});
