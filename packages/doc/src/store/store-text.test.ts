import { describe, expect, test } from "bun:test";
import { type BlockId, type Cite, type ClaimChecks, createSecretScanner, type WorkspaceKey } from "@mitori/core";
import type { GeneratedBlock } from "../contract.ts";
import { createBlockRenderer } from "../render/index.ts";
import { htmlText } from "../render/text.ts";
import { harness, staticInputFromTruth } from "../test/harness.ts";
import { hasher, inlinePool, memDb, silentLog } from "../test/helpers.ts";
import { DOC_MIGRATIONS } from "./index.ts";

const checks: ClaimChecks = { l0: true, l1: "pass", l2: true, checkedAt: "2026-01-01T00:00:00.000Z" };
const cite = (path: string, start: number, end: number): Cite => ({ path, start, end, blob: "b".repeat(40), snippet: "s".repeat(16), precision: "exact" });
const gen = { model: "claude-sonnet-5-5", engine: "claude-cli", stage: "S5", promptVer: "gen.overview@1", indexDigest: "0".repeat(16) } as const;
const opts = { mode: "write" as const, deletes: [] as BlockId[], source: { kind: "regen" as const, id: "gr_00000001" }, reason: "test", listed: 0 };
const block = (over: Partial<GeneratedBlock>): GeneratedBlock => ({
  id: null,
  section: "s1",
  aspect: "problem",
  kind: "prose",
  depth: "L0",
  audience: ["newcomer"],
  lang: "ja",
  md: "",
  claims: [],
  gen,
  ...over,
});

describe("blockText, re-stamping and removed module pages", () => {
  test("blockText equals the text of the rendered, spliced HTML minus cite chips (ANCHOR_TEXT_RULES)", async () => {
    const h = harness();
    h.store.applyStatic(staticInputFromTruth("ts-small"));
    const [id] = h.store.applyGenerated(
      [
        block({
          md: "`Store.Get` は ID から取り出す[[1]]。English と日本語 3 件。",
          claims: [{ n: 1, kind: "behavior", quote: "", cites: [cite("src/s.ts", 4, 9)], checks, verdict: "verified" }],
        }),
      ],
      opts,
    ).written as BlockId[];
    const r = createBlockRenderer({
      highlighter: inlinePool((x: { text: string }) => x.text),
      secrets: createSecretScanner(),
      hasher,
      db: memDb(DOC_MIGRATIONS),
      log: silentLog,
    });
    const b = h.store.block(id as BlockId) as NonNullable<ReturnType<typeof h.store.block>>;
    const claims = h.store.claims(b.id);
    const html = r.splice(await r.render(b, claims, { lang: "ja", glossaryTerms: new Map() }), claims, {
      ws: "ws_000000000000" as WorkspaceKey,
      level: "expert",
    });
    expect(h.store.blockText(b.id)).toBe(htmlText(html));
    expect(h.store.blockText(b.id)).toBe("Store.GetはIDから取り出す。Englishと日本語3件。");
    expect(claims[0]?.quote).toBe("Store.GetはIDから取り出す");
  });

  test("cites that arrive as Markdown links (accepted proposals) are stamped in a later write slot", async () => {
    const h = harness();
    h.store.applyStatic(staticInputFromTruth("ts-small"));
    const [id] = h.store.applyGenerated([block({ md: "人が書く前の文。" })], opts).written as BlockId[];
    const p = h.store.propose({
      block: id as BlockId,
      section: "s1",
      op: "update",
      baseHash: h.store.block(id as BlockId)?.hash as string,
      md: "`main` を呼ぶ（[index.ts:5-6](../../src/index.ts#L5-L6)）。",
      source: { kind: "job", id: "j_1" },
      reason: "x",
    });
    h.store.acceptProposal(p.id);
    expect(h.store.claims(id as BlockId)[0]?.cites[0]?.blob).toBe("");
    await h.store.settled();
    const c = h.store.claims(id as BlockId)[0];
    expect(c?.cites[0]?.blob).toMatch(/^[0-9a-f]{40}$/);
    expect(c?.verdict).toBe("verified");
    expect(h.stamper.calls).toBe(1);
  });

  test("a module that disappears loses its page file on the next flush", async () => {
    const h = harness();
    const input = staticInputFromTruth("go-small");
    h.store.applyStatic(input);
    await h.store.flush({ force: true });
    const pages = () => [...(h.mem?.files.keys() ?? [])].filter((f) => f.startsWith("doc/modules/")).sort();
    const before = pages();
    expect(before.length).toBe(input.modules.length);
    h.store.applyStatic({ ...input, modules: input.modules.slice(1) });
    await h.store.flush({ force: true });
    expect(pages().length).toBe(before.length - 1);
    expect(h.mem?.files.get("doc/06-modules.md")?.includes(`modules/${input.modules[0]?.slug}.md`)).toBe(false);
  });
});
