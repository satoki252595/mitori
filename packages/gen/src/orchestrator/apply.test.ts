import { describe, expect, test } from "bun:test";
import type { BlockId } from "@mitori/core";
import type { GenBlockLine } from "../contract.ts";
import { fakeAnchors } from "../test/fake-anchor.ts";
import { createFakeDocStore } from "../test/fake-doc.ts";
import { createFakeIndexer } from "../test/fake-indexer.ts";
import { testClock, testHasher, testIds, testLogger, testWriteQueue } from "../test/ports.ts";
import { sampleRepo } from "../test/repo.ts";
import { createVerifier } from "../verify/verifier.ts";
import { type ApplyContext, ApplySink } from "./apply.ts";

const hasher = testHasher();

function setup() {
  const repo = sampleRepo();
  const ids = testIds();
  const indexer = createFakeIndexer(repo, hasher);
  const doc = createFakeDocStore({ hasher, ids, repo });
  const verifier = createVerifier({ indexer, anchors: fakeAnchors(hasher), hasher, clock: testClock() });
  const write = testWriteQueue();
  const deps = { doc, write, verifier, log: testLogger() };
  const ctx = (over: Partial<ApplyContext> = {}): ApplyContext => ({
    run: "gr_00000001",
    trigger: "user",
    engine: "claude-cli",
    model: "claude-sonnet-5-5",
    stage: "S5",
    promptVer: "gen.module@1",
    indexDigest: indexer.snapshot()?.indexDigest ?? "",
    lang: "ja",
    listed: 0,
    autoAccept: false,
    ...over,
  });
  return { doc, deps, ctx, write };
}

const block = (
  id: string,
  aspect: NonNullable<GenBlockLine["aspect"]>,
  md: string,
  cites: { path: string; start: number; end: number }[] = [],
): GenBlockLine => ({
  t: "block",
  id: id as GenBlockLine["id"],
  section: "s6/session",
  aspect,
  kind: aspect === "interface" ? "list" : "prose",
  depth: "L2",
  audience: ["dev"],
  md,
  claims: md.includes("[[1]]") ? [{ n: 1, kind: "behavior", cites }] : [],
});

async function seed(s: ReturnType<typeof setup>, n = 4): Promise<BlockId[]> {
  const sink = new ApplySink(s.deps, s.ctx());
  for (let i = 1; i <= n; i++)
    sink.accept(block(`new:${i}`, "responsibility", `段落${i}は値を返す[[1]]。`, [{ path: "src/session/store.ts", start: 10, end: 15 }]));
  await sink.finish();
  return sink.written;
}

describe("AC-12 / GEN-U-063 regeneration accounting at apply time", () => {
  test("every write runs inside the write queue, in line order; new blocks stream one per line", async () => {
    const s = setup();
    const ids = await seed(s, 2);
    expect(ids.length).toBe(2);
    expect(s.write.labels).toEqual(["gen.apply", "gen.apply"]);
    expect(
      s.doc
        .section("s6/session")
        ?.blocks.filter((b) => b.origin === "ai")
        .map((b) => b.id),
    ).toEqual(ids);
  });

  test("a locked block becomes a proposal; an unlocked one is overwritten; an unchanged one is a no-op", async () => {
    const s = setup();
    const [a, b, c] = await seed(s, 3);
    s.doc.lock(b as BlockId, "human-edited");
    const sink = new ApplySink(s.deps, s.ctx({ listed: 3 }));
    sink.accept(block(a as string, "responsibility", "書き換えた[[1]]。", [{ path: "src/session/store.ts", start: 10, end: 15 }]));
    sink.accept(block(b as string, "responsibility", "人の段落も書き換えたい[[1]]。", [{ path: "src/session/store.ts", start: 10, end: 15 }]));
    sink.accept(block(c as string, "responsibility", "段落3は値を返す[[1]]。", [{ path: "src/session/store.ts", start: 10, end: 15 }]));
    await sink.finish();
    expect(sink.written).toEqual([a as BlockId]);
    expect(sink.proposals.length).toBe(1);
    expect(s.doc.proposals({ block: b as BlockId })[0]?.op).toBe("update");
    expect(s.doc.block(c as BlockId)?.md).toBe("段落3は値を返す[[1]]。");
  });

  test("more than 50 % deletes of ≥ 4 listed: the excess becomes proposals; locked deletes are proposals", async () => {
    const s = setup();
    const ids = (await seed(s, 4)) as BlockId[];
    const sink = new ApplySink(s.deps, s.ctx({ listed: 4 }));
    for (const id of ids.slice(0, 3)) sink.accept({ t: "delete", id });
    await sink.finish();
    expect(s.doc.tombstones.size).toBe(2);
    expect(s.doc.proposals({ state: "pending" }).map((p) => p.op)).toEqual(["delete"]);
  });

  test("trigger incremental turns every change into a proposal unless autoAcceptDocUpdates", async () => {
    const s = setup();
    const [a] = await seed(s, 1);
    const inc = new ApplySink(s.deps, s.ctx({ trigger: "incremental", listed: 1 }));
    inc.accept(block(a as string, "responsibility", "変わった[[1]]。", [{ path: "src/session/store.ts", start: 10, end: 15 }]));
    inc.accept(block("new:5", "interface", "- 追加の項目"));
    inc.accept({ t: "delete", id: a as BlockId });
    await inc.finish();
    expect(inc.written).toEqual([]);
    expect(s.doc.proposals().map((p) => p.op)).toEqual(["update", "insert", "delete"]);
    const auto = new ApplySink(s.deps, s.ctx({ trigger: "incremental", autoAccept: true }));
    auto.accept(block(a as string, "responsibility", "自動で反映[[1]]。", [{ path: "src/session/store.ts", start: 10, end: 15 }]));
    await auto.finish();
    expect(auto.written).toEqual([a as BlockId]);
  });

  test("claim identity: an updated block keeps the claim id of the same quote (§6.7-6)", async () => {
    const s = setup();
    const [a] = await seed(s, 1);
    const before = s.doc.claims(a as BlockId)[0]?.id;
    const sink = new ApplySink(s.deps, s.ctx({ listed: 1 }));
    sink.accept({
      ...block(a as string, "responsibility", "段落1は値を返す[[1]]。追加の文[[2]]。", [{ path: "src/session/store.ts", start: 10, end: 15 }]),
      claims: [
        { n: 1, kind: "behavior", cites: [{ path: "src/session/store.ts", start: 10, end: 15 }] },
        { n: 2, kind: "fact", cites: [] },
      ],
    });
    await sink.finish();
    const after = s.doc.claims(a as BlockId);
    expect(after[0]?.id as string).toBe(before as string);
    expect(after[1]?.id as string).not.toBe(before as string);
    expect(after[1]?.verdict).toBe("inferred");
  });

  test("after new:n resolves to the block created earlier in the reply; replay skips locked targets", async () => {
    const s = setup();
    const sink = new ApplySink(s.deps, s.ctx());
    sink.accept(block("new:1", "responsibility", "一つ目[[1]]。", [{ path: "src/session/store.ts", start: 10, end: 15 }]));
    sink.accept({ ...block("new:2", "responsibility", "二つ目[[1]]。", [{ path: "src/session/store.ts", start: 17, end: 19 }]), after: "new:1" });
    await sink.finish();
    expect(Object.keys(sink.idMap)).toEqual(["new:1", "new:2"]);
    const first = sink.idMap["new:1"] as BlockId;
    s.doc.lock(first, "human-edited");
    const replay = new ApplySink(s.deps, s.ctx({ replay: true }), sink.idMap);
    replay.accept(block("new:1", "responsibility", "古い一つ目[[1]]。", [{ path: "src/session/store.ts", start: 10, end: 15 }]));
    await replay.finish();
    expect(replay.proposals).toEqual([]);
    expect(s.doc.block(first)?.md).toBe("一つ目[[1]]。");
  });
});
