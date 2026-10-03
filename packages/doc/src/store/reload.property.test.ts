// DOC-U-006 / AC-29 as a property: generated blocks (markers after terminators, literal cite-group text, file names
// that need escaping) plus a human edit, flushed and reloaded with the same and with a lost DB, come back with no
// external edit, no new id, no orphan — and with the same DB without rewriting a single Markdown file.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BlockAspect, BlockId, BlockKind, ClaimChecks } from "@mitori/core";
import type { GeneratedBlock } from "../contract.ts";
import { harness, staticInputFromTruth } from "../test/harness.ts";
import { seededRandom, spySafeWriter } from "../test/helpers.ts";

const tmp: string[] = [];
afterAll(() => {
  for (const t of tmp) rmSync(t, { recursive: true, force: true });
});
const checks: ClaimChecks = { l0: true, l1: "pass", l2: true, checkedAt: "2026-01-01T00:00:00.000Z" };
const gen = { model: "claude-sonnet-5-5", engine: "claude-cli", stage: "S5", promptVer: "gen.overview@1", indexDigest: "0".repeat(16) } as const;
const opts = { mode: "write" as const, deletes: [] as BlockId[], source: { kind: "regen" as const, id: "gr_00000001" }, reason: "test", listed: 0 };
const r = seededRandom(11);
const rnd = (n: number) => Math.floor(((r.bytes(1)[0] as number) / 256) * n);
const pick = <T>(xs: readonly T[]): T => xs[rnd(xs.length)] as T;
const W = [
  "日本語",
  "English",
  "`code`",
  "**太字**",
  "x > y",
  "a | b",
  "#hash",
  "（推測）",
  "（[x.ts:3](../../src/x.ts#L3)）",
  "e.g.",
  "v1.2",
  "「引用」",
  "(paren)",
  "[link](../a.md)",
  "    four",
  "---",
  "~~~",
];
const sent = () =>
  `${Array.from({ length: 1 + rnd(4) }, () => pick(W)).join(pick([" ", ""]))}${rnd(3) ? "[[M]]" : ""}${pick(["。", ".", "！", ""])}${rnd(4) === 0 ? "[[M]]" : ""}`;
const ASPECTS: [BlockAspect, BlockKind][] = [
  ["problem", "prose"],
  ["users", "list"],
  ["scope", "list"],
  ["constraints", "list"],
];

describe("DOC-U-006 property: what the store writes reloads unchanged", () => {
  test("40 seeded docs", async () => {
    const fails: unknown[] = [];
    for (let it = 0; it < 40 && fails.length < 3; it++) {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "mitori-reload-prop-")));
      tmp.push(root);
      const h = harness({ root, fs: true, writer: spySafeWriter() });
      await h.store.load();
      h.store.applyStatic(staticInputFromTruth("ts-small"));
      const blocks: GeneratedBlock[] = Array.from({ length: 1 + rnd(4) }, () => {
        const [aspect, kind] = pick(ASPECTS);
        let n = 0;
        const body = kind === "list" ? Array.from({ length: 1 + rnd(3) }, () => `- ${sent()}`).join("\n") : Array.from({ length: 1 + rnd(3) }, sent).join("");
        const md = body.replace(/\[\[M\]\]/g, () => `[[${++n}]]`);
        const claims = Array.from({ length: n }, (_, i) => ({
          n: i + 1,
          kind: "behavior" as const,
          quote: "",
          cites: rnd(3)
            ? [
                {
                  path: pick(["src/a.ts", "app/[id].tsx", "pkg/__init__.py"]),
                  start: 1 + rnd(50),
                  end: 60,
                  blob: "a".repeat(40),
                  snippet: "0".repeat(16),
                  precision: "exact" as const,
                },
              ]
            : [],
          checks,
          verdict: "verified" as const,
        }));
        return { id: null, section: "s1", aspect, kind, depth: "L1", audience: [], lang: "ja", md, claims, gen };
      });
      h.store.applyGenerated(blocks, opts);
      // a human edit of one block in file form (re-uses the current text + a new sentence)
      const target = h.store.section("s1")?.blocks.find((b) => b.origin === "ai");
      if (target && rnd(2)) await h.store.editBlock(target.id, target.hash, `${target.md}${rnd(2) ? " 人が足した。" : ""}`, "human");
      await h.store.settled();
      await h.store.flush({ force: true });
      for (const sameDb of [true, false]) {
        const w = spySafeWriter();
        const h2 = harness({ root, fs: true, writer: w, ...(sameDb ? { db: h.db } : {}) });
        const rep = await h2.store.load();
        await h2.store.flush({ force: true });
        const md = w.writes.filter((x) => x.abs.endsWith(".md")).map((x) => x.abs);
        if (rep.externallyEdited.length || rep.assignedIds.length || rep.orphaned.length || (sameDb && md.length))
          fails.push({
            it,
            sameDb,
            rep: { e: rep.externallyEdited, a: rep.assignedIds, o: rep.orphaned },
            md,
            blocks: blocks.map((b) => b.md),
            target: target?.md,
          });
      }
    }
    expect(fails).toEqual([]);
  }, 30000);
});
