import { describe, expect, test } from "bun:test";
import type { BlockId, ThreadId } from "@mitori/core";
import { makeS9Harness, type S9Harness } from "../incremental/test/harness.ts";
import { M_SESSION } from "../test/repo.ts";

const STORE = "src/session/store.ts";

async function after(effort: "overview" | "standard", opts: Parameters<typeof makeS9Harness>[0] = {}): Promise<S9Harness> {
  const h = makeS9Harness(opts);
  await h.applyStatic();
  await h.generate(effort);
  return h;
}

const placeholder = (h: S9Harness, section: string) => (h.doc.section(section as never)?.blocks ?? []).find((b) => b.kind === "placeholder")?.id as BlockId;
const calls = (h: S9Harness, from: number) => h.engine.calls.slice(from).map((c) => `${c.call.spec.id}${c.call.mode ? `:${c.call.mode}` : ""} ${c.call.lane}`);

describe("GEN-OD-01 expand (§12)", () => {
  test("a lazy module placeholder: confirm:false only estimates; confirm:true writes the page directly in the doc lane", async () => {
    const h = await after("overview");
    const ph = placeholder(h, "s6/session");
    expect(ph).toBeDefined();
    const n = h.engine.calls.length;
    const est = await h.gen.expand(ph, { confirm: false });
    expect(est.run).toBeUndefined();
    expect(est.cached).toBe(false);
    expect(est.estimate.requiresConfirm).toBe(false);
    expect(est.estimate.confirmReasons).toEqual([]);
    expect(h.engine.calls.length).toBe(n);
    const res = await h.gen.expand(ph, { confirm: true });
    await h.gen.idle();
    expect(h.gen.run(res.run as never)?.run).toMatchObject({ trigger: "ondemand", state: "done", scope: ["s6/session"] });
    expect(calls(h, n)).toEqual(["gen.module doc"]);
    expect(h.aiBlocks("s6/session").map((b) => b.aspect)).toEqual(["responsibility", "interface"]);
    expect(placeholder(h, "s6/session")).toBeUndefined();
    expect(h.doc.proposals({ state: "pending" })).toEqual([]);
  });

  test("a section placeholder runs that section's prompt (§9 quality after an overview run)", async () => {
    const h = await after("overview");
    const n = h.engine.calls.length;
    await h.gen.expand(placeholder(h, "s9"), { confirm: true });
    await h.gen.idle();
    expect(calls(h, n)).toEqual(["gen.quality doc"]);
  });

  test("a deep-dive placeholder is replaced under the same id, with the further blocks after it", async () => {
    const h = await after("standard", { router: { deepdive: true } });
    const dd = h.aiBlocks("s6/session").find((b) => b.aspect === "deepdive");
    expect(dd?.claims).toEqual([]);
    const n = h.engine.calls.length;
    await h.gen.expand(dd?.id as BlockId, { confirm: true });
    await h.gen.idle();
    expect(calls(h, n)).toEqual(["gen.deepdive:topic doc"]);
    expect(h.engine.calls.at(-1)?.call.layout.unit).toContain(`It replaces block ${dd?.id}.`);
    const blocks = h.aiBlocks("s6/session").map((b) => b.id);
    const i = blocks.indexOf(dd?.id as BlockId);
    expect(h.doc.markerForm(dd?.id as BlockId)).toBe("期限は `get` で判定する[[1]]。");
    expect(h.doc.markerForm(blocks[i + 1] as BlockId)).toBe("期限切れは例外になる[[1]]。");
    expect(h.doc.claims(dd?.id as BlockId).length).toBe(1);
  });

  test("not a placeholder ⇒ E_INVALID_INPUT; an active run ⇒ E_CONFLICT", async () => {
    const h = await after("overview");
    const block = h.aiBlocks("s1")[0]?.id as BlockId;
    await expect(h.gen.expand(block, { confirm: false })).rejects.toMatchObject({ code: "E_INVALID_INPUT" });
    await h.gen.start((await h.gen.estimate({ effort: "standard" })).id);
    await expect(h.gen.expand(placeholder(h, "s9"), { confirm: true })).rejects.toMatchObject({ code: "E_CONFLICT" });
    await h.gen.idle();
  });
});

describe("GEN-OD-02 simplify (☆, §12)", () => {
  test("a proposal that keeps the block's claims; the same text a second time is the cached proposal (0 tokens)", async () => {
    const h = await after("standard");
    const iface = h.aiBlocks("s6/session").find((b) => b.aspect === "interface")?.id as BlockId;
    const claims = h.claimIds(iface);
    const n = h.engine.calls.length;
    const r = await h.gen.simplify(iface, "newcomer", { confirm: true });
    await h.gen.idle();
    expect(calls(h, n)).toEqual(["doc.simplify:newcomer doc"]);
    const p = h.doc.proposals({ state: "pending", block: iface });
    expect(p.map((x) => [x.source.kind, x.op])).toEqual([["simplify", "update"]]);
    expect(r.run).toBeDefined();
    const again = await h.gen.simplify(iface, "newcomer", { confirm: true });
    expect(again).toMatchObject({ cached: true, proposal: p[0]?.id });
    expect(h.engine.calls.length).toBe(n + 1);
    h.doc.acceptProposal(p[0]?.id as never);
    expect(h.doc.markerForm(iface)?.startsWith("やさしく言うと、")).toBe(true);
    expect(h.claimIds(iface)).toEqual(claims);
    await expect(h.gen.simplify(iface, "expert", { confirm: false })).rejects.toMatchObject({ code: "E_INVALID_INPUT" });
  });
});

describe("GEN-OD-03 syncBlocks (post-accept / post-round doc.sync, D12)", () => {
  test("confirm:false estimates; confirm:true runs doc.sync and returns its proposals; fresh blocks need nothing", async () => {
    const h = await after("standard", { router: { syncRewrite: true } });
    const iface = h.aiBlocks("s6/session").find((b) => b.aspect === "interface")?.id as BlockId;
    const none = await h.gen.syncBlocks([iface], { kind: "job", id: "jb_1" }, { confirm: false });
    expect(none).toMatchObject({ cached: true, proposals: [] });
    const text = h.repo.files[STORE] as string;
    await h.gen.onIndexDelta(h.edit(STORE, text.replace("export class ErrExpired extends Error {}", "export class ErrExpired extends Error { code = 1 }")));
    const n = h.engine.calls.length;
    const est = await h.gen.syncBlocks([iface], { kind: "job", id: "jb_1" }, { confirm: false });
    expect(est.run).toBeUndefined();
    expect(h.store.getEstimate(est.estimate.id)?.plan.tasks.map((t) => t.prompt)).toEqual(["doc.sync"]);
    expect(h.engine.calls.length).toBe(n);
    const res = await h.gen.syncBlocks([iface], { kind: "round", id: "rd_1" }, { confirm: true });
    expect(res.proposals.length).toBe(1);
    expect(h.doc.proposals({ state: "pending" }).map((p) => p.source)).toEqual([{ kind: "sync", id: res.run as string }]);
    expect(h.gen.run(res.run as never)?.run.trigger).toBe("incremental");
  });
});

describe("GEN-OD-04 Ask answer → doc (§12, no LLM)", () => {
  test("an insert proposal after the thread's block, kind faq, cites stamped as claims", async () => {
    const h = await after("standard");
    const anchor = h.aiBlocks("s6/session")[0]?.id as BlockId;
    const n = h.engine.calls.length;
    const id = await h.gen.promoteAnswer({
      thread: "th_00000001" as ThreadId,
      md: "期限切れのセッションは例外になる[[src/session/store.ts:13]]。保存は `put` で行う[[src/session/store.ts:17-19]]。",
      after: anchor,
      kind: "faq",
      title: "期限切れは？",
    });
    expect(h.engine.calls.length).toBe(n);
    const p = h.doc.proposals({ state: "pending" }).find((x) => x.id === id);
    expect(p).toMatchObject({ op: "insert", block: null, after: anchor, section: "s6/session", source: { kind: "answer_promote", id: "th_00000001" } });
    expect(p?.md).toContain("src/session/store.ts#L13");
    const block = h.doc.acceptProposal(id);
    expect(block.kind).toBe("faq");
    const claims = h.doc.claims(block.id);
    expect(claims.map((c) => c.cites.map((x) => `${x.path}:${x.start}-${x.end}`))).toEqual([["src/session/store.ts:13-13"], ["src/session/store.ts:17-19"]]);
    expect(claims[1]?.verdict).toBe("verified");
    expect(claims[0]?.cites[0]?.blob).toBe(h.indexer.currentBlob(STORE) as string);
    void M_SESSION;
  });
});
