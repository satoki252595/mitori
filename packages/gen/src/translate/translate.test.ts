import { describe, expect, test } from "bun:test";
import type { Block, BlockId } from "@mitori/core";
import type { GenCall } from "../contract.ts";
import { makeS9Harness, type S9Harness } from "../incremental/test/harness.ts";
import { parseBlocks, s9Router } from "../incremental/test/router.ts";
import { TRANSLATE_CHUNK, translateTasks } from "../ondemand/plan.ts";
import type { ScriptReply, Turn } from "../test/fake-engine.ts";

async function generated(router?: (call: GenCall, t: Turn) => ScriptReply): Promise<S9Harness> {
  const h = makeS9Harness(router ? { router } : {});
  await h.applyStatic();
  await h.generate("standard");
  return h;
}

const translateCalls = (h: S9Harness) => h.engine.calls.filter((c) => c.call.spec.id === "doc.translate");

describe("GEN-TR-01 translation is stored per block hash × language (D5)", () => {
  test("a block: stored (not proposed) with its markers; the second request costs 0 tokens", async () => {
    const h = await generated();
    const iface = h.aiBlocks("s6/session").find((b) => b.aspect === "interface") as Block;
    const r = await h.gen.translate(iface.id, "en", { confirm: true });
    await h.gen.idle();
    expect(r.cached).toBe(false);
    expect(h.gen.run(r.run as never)?.run.trigger).toBe("ondemand");
    expect(translateCalls(h).map((c) => [c.call.mode, c.call.lane])).toEqual([["en", "doc"]]);
    expect(translateCalls(h)[0]?.call.layout.unit).toContain("TASK: Translate the blocks in BLOCKS from Japanese to English.");
    const t = h.doc.translation(iface.id, "en");
    expect(t).toMatchObject({ block: iface.id, lang: "en", srcHash: iface.hash, promptVer: "doc.translate@1", model: "claude-sonnet-5-5" });
    expect(t?.md).toBe(`EN ${h.doc.markerForm(iface.id)}`);
    expect(h.doc.proposals({ state: "pending" })).toEqual([]);
    const n = h.engine.calls.length;
    const again = await h.gen.translate(iface.id, "en", { confirm: true });
    expect(again).toMatchObject({ cached: true });
    expect(again.run).toBeUndefined();
    expect(again.estimate.inTokens + again.estimate.outTokens).toBe(0);
    expect(h.engine.calls.length).toBe(n);
  });

  test("a section covers its sub-sections; an edited source block is translated again, alone", async () => {
    const h = await generated();
    await h.gen.translate("s3", "en", { confirm: true });
    await h.gen.idle();
    const s3 = ["s3", "s3/login", "s3/cli"].flatMap((s) => h.aiBlocks(s));
    expect(s3.length).toBeGreaterThan(3);
    for (const b of s3) expect(h.doc.translation(b.id, "en")).not.toBeNull();
    const target = h.aiBlocks("s3/login")[0] as Block;
    await h.doc.editBlock(target.id, target.hash, "ログインを受け付ける。", "human");
    expect(h.doc.translation(target.id, "en")).toBeNull();
    const n = translateCalls(h).length;
    await h.gen.translate("s3", "en", { confirm: true });
    await h.gen.idle();
    expect(translateCalls(h).length).toBe(n + 1);
    expect(parseBlocks(translateCalls(h).at(-1)?.call.layout.unit ?? "").map((b) => b.id)).toEqual([target.id]);
    expect(h.doc.translation(target.id, "en")?.md).toBe("EN ログインを受け付ける。");
  });

  test("the doc's own language ⇒ E_INVALID_INPUT; an unknown target ⇒ E_NOT_FOUND", async () => {
    const h = await generated();
    await expect(h.gen.translate("s1", "ja", { confirm: false })).rejects.toMatchObject({ code: "E_INVALID_INPUT" });
    await expect(h.gen.translate("b_zzzzzzzz" as BlockId, "en", { confirm: false })).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  });

  test("V14: a translation that drops a marker is not stored", async () => {
    const base = s9Router();
    const h = await generated((call, t) => {
      if (call.spec.id !== "doc.translate") return base(call, t);
      const out = parseBlocks(call.layout.unit).map((b) => JSON.stringify({ t: "block", id: b.id, md: b.md.replace(/\[\[\d+\]\]/g, "") }));
      return { lines: [...out, JSON.stringify({ t: "end", blocks: out.length })] };
    });
    const iface = h.aiBlocks("s6/session").find((b) => b.aspect === "interface") as Block;
    await h.gen.translate(iface.id, "en", { confirm: true });
    await h.gen.idle();
    expect(h.doc.translation(iface.id, "en")).toBeNull();
    expect(translateCalls(h).length).toBe(2); // the single retry
  });
});

describe("GEN-TR-02 chunks of ≤ 30 blocks and ≤ 6,000 characters (§12)", () => {
  test("blocks are split by count and by size", async () => {
    const h = await generated();
    const one = h.aiBlocks("s6/session")[0] as Block;
    const env = {
      indexer: h.indexer,
      doc: { ...h.doc, markerForm: (id: BlockId) => (id.endsWith("big") ? "x".repeat(4000) : "短い文。") },
      settings: () => h.settings,
      hasher: h.hasher,
      tokens: (t: string) => Math.ceil(t.length / 2),
    };
    const many = Array.from({ length: 70 }, (_, i) => ({ ...one, id: `b_${String(i).padStart(8, "0")}` as BlockId }));
    expect(translateTasks(env as never, "claude-cli", many, "en").map((t) => t.target.id.split(",").length)).toEqual([30, 30, 10]);
    const big = Array.from({ length: 3 }, (_, i) => ({ ...one, id: `b_${i}big` as BlockId }));
    expect(translateTasks(env as never, "claude-cli", big, "en").map((t) => t.target.id.split(",").length)).toEqual([1, 1, 1]);
    expect(TRANSLATE_CHUNK).toEqual({ blocks: 30, chars: 6000 });
  });
});
