// NC-10 §7 主要な型 / §8 外とのやり取り・秘密情報らしい環境変数, and the module page's 「変更の手引き」 and
// 「大きなファイルの中身」: what applyStatic writes from `StaticGuide` and the `outbound` facts (0 tokens).
import { describe, expect, test } from "bun:test";
import type { Fact, LineNo, RepoPath, SectionId } from "@mitori/core";
import type { FileRegion, StaticDocInput } from "../contract.ts";
import { harness, staticInputFromTruth } from "../test/harness.ts";
import { regionLabel } from "./static.ts";

function input(): StaticDocInput {
  const base = staticInputFromTruth("go-small");
  const [a, b] = base.modules;
  if (!a || !b) throw new Error("go-small has two modules at least");
  const ob = (path: string, line: number, channel: "http" | "subprocess" | "db", via: string, target?: string): Fact =>
    ({ kind: "outbound", detector: "outbound.calls@1", path, line, blob: "", channel, via, ...(target ? { target } : {}) }) as Fact;
  return {
    ...base,
    facts: [
      ...base.facts,
      ob("internal/meta/fetch.go", 53, "http", "net/http", "https://api.example.com"),
      ob("internal/meta/fetch.go", 70, "http", "net/http", "https://api.example.com"),
      ob("internal/meta/fetch.go", 80, "http", "net/http", "https://api.example.com"),
      ob("internal/meta/fetch.go", 90, "http", "net/http", "https://api.example.com"),
      ob("cmd/tsundoku/main.go", 12, "subprocess", "os/exec", "git"),
      ob("internal/store/sqlite.go", 20, "db", "database/sql"),
    ],
    guide: {
      types: [
        {
          name: "Book",
          kind: "struct",
          path: "internal/store/store.go",
          line: 5 as LineNo,
          end: 12 as LineNo,
          fields: 4,
          refs: [{ name: "Author", field: "Author" }],
          usedBy: 3,
        },
        { name: "Author", kind: "struct", path: "internal/store/store.go", line: 14 as LineNo, end: 18 as LineNo, fields: 2, refs: [], usedBy: 3 },
      ],
      change: {
        [a.id]: {
          dependents: [{ module: b.id, weight: 2 }],
          dependencies: [],
          tests: [{ path: "internal/x_test.go", cases: 3 }],
          testCommand: { command: "go test ./internal/x/..." },
          entries: [{ label: "GET /api/books", path: "internal/server/server.go", line: 34 as LineNo }],
          coChange: [{ path: "internal/server/server.go", together: 4 }],
          commits: 9,
          window: 120,
          risks: [{ kind: "hub" }, { kind: "large_file", path: a.paths[0] as RepoPath, lines: 1800 }],
        },
        [b.id]: {
          dependents: [],
          dependencies: [{ module: a.id, weight: 2 }],
          tests: [],
          entries: [],
          coChange: [],
          commits: null,
          window: 0,
          risks: [{ kind: "untested" }],
        },
      },
      regions: {
        [a.paths[0] as string]: {
          lines: 1800,
          regions: [
            { kind: "types", start: 1 as LineNo, end: 40 as LineNo, depth: 0, count: 3, names: ["View", "Snap"] },
            { kind: "symbol", start: 50 as LineNo, end: 1790 as LineNo, depth: 0, count: 1, names: ["Editor"], host: "Editor", symbolKind: "function" },
            {
              kind: "state",
              start: 51 as LineNo,
              end: 120 as LineNo,
              depth: 1,
              count: 20,
              names: ["view", "mode"],
              host: "Editor",
              hooks: { useState: 14, useRef: 6 },
            },
            { kind: "render", start: 900 as LineNo, end: 1789 as LineNo, depth: 1, count: 1, names: [], host: "Editor" },
          ],
        },
      },
    },
  };
}

const blocksOf = (h: ReturnType<typeof harness>, section: string) => h.store.section(section as SectionId)?.blocks ?? [];

describe("NC-10 static §7 / §8 and the module page's change guide and region outline", () => {
  test("§7: the key types table and their relations drawing come before the schema", () => {
    const h = harness();
    h.store.applyStatic(input());
    const s7 = blocksOf(h, "s7").filter((b) => b.kind !== "heading");
    expect(s7.map((b) => b.slot)).toEqual(["s7:types", "s7:types-map", "s7:schema", ...s7.slice(3).map((b) => b.slot)]);
    const table = s7[0]?.md ?? "";
    expect(table).toContain("**主要な型");
    expect(table).toContain("| `Book` | struct | `internal/store/store.go:5` | 4 | `Author` → `Author` | 3 |");
    const map = s7[1];
    expect(map?.kind).toBe("diagram");
    expect(map?.md).toContain("-->|Author|");
  });

  test("§8: one row per kind × target × library with ≤ 3 places (+n), HTTP first; secret-looking env names listed by name only", () => {
    const h = harness();
    h.store.applyStatic(input());
    const s8 = blocksOf(h, "s8");
    const out = s8.find((b) => b.slot === "s8:outbound")?.md ?? "";
    const rows = out.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| 種類"));
    expect(rows[0]).toBe(
      "| HTTP | `https://api.example.com` | `net/http` | `internal/meta/fetch.go:53` `internal/meta/fetch.go:70` `internal/meta/fetch.go:80` ほか 1 件 |",
    );
    expect(rows.slice(1)).toEqual([
      "| データベース | — | `database/sql` | `internal/store/sqlite.go:20` |",
      "| 子プロセス | `git` | `os/exec` | `cmd/tsundoku/main.go:12` |",
    ]);
    // the slots keep §8's order: routes, CLI, outbound, env, secrets
    const order = s8.filter((b) => b.slot).map((b) => b.slot);
    expect(order.indexOf("s8:outbound")).toBeGreaterThan(order.indexOf("s8:cli"));
    expect(order.indexOf("s8:outbound")).toBeLessThan(order.indexOf("s8:env"));
  });

  test("§8 says so when nothing calls out", () => {
    const h = harness();
    h.store.applyStatic(staticInputFromTruth("go-small"));
    expect(blocksOf(h, "s8").find((b) => b.slot === "s8:outbound")?.md).toContain("外への呼び出しは見つかりませんでした");
  });

  test("a module page: the change guide (sibling links, tests, entries, co-change, risks) and the large files' regions, after the facts", () => {
    const inp = input();
    const h = harness();
    h.store.applyStatic(inp);
    const [a, b] = inp.modules as [(typeof inp.modules)[0], (typeof inp.modules)[0]];
    const entry = h.store.index().modules.find((m) => m.id === a.id);
    const blocks = blocksOf(h, entry?.section as string);
    const slots = blocks.map((x) => x.slot);
    expect(slots.slice(0, 4)).toEqual([`m:${a.id}:h`, `m:${a.id}:facts`, `m:${a.id}:change`, `m:${a.id}:regions`]);
    const change = blocks[2]?.md ?? "";
    const bSlug = h.store.index().modules.find((m) => m.id === b.id)?.slug;
    expect(change).toContain(`- 影響が及ぶ先（このモジュールを使う）: [`);
    expect(change).toContain(`](${bSlug}.md)`);
    expect(change).toContain("- テスト: `internal/x_test.go`（3 件） · 実行: `go test ./internal/x/...`");
    expect(change).toContain("- 入口から: `GET /api/books`（`internal/server/server.go:34`）");
    expect(change).toContain("- 一緒に変わりやすいファイル（直近 120 commit）: `internal/server/server.go` 4 回");
    expect(change).toContain("ハブ（多くから使われ、多くを使う）");
    expect(change).toContain("（1,800 行）");
    const regions = blocks[3]?.md ?? "";
    expect(regions).toContain(`- \`${a.paths[0]}\`（1,800 行）`);
    expect(regions).toContain(`  - \`${a.paths[0]}:50-1790\` Editor（関数）`);
    expect(regions).toContain(`    - \`${a.paths[0]}:51-120\` 状態（useState 14・useRef 6）: \`view\`・\`mode\``);
    // the other module: untested, no history
    const other = blocksOf(h, h.store.index().modules.find((m) => m.id === b.id)?.section as string).find((x) => x.slot === `m:${b.id}:change`)?.md ?? "";
    expect(other).toContain("- テスト: 見つかりませんでした");
    expect(other).toContain("履歴を読めません");
    expect(other).toContain("テストが無い");
  });

  test("a second applyStatic with the same input changes nothing (deterministic, idempotent)", () => {
    const h = harness();
    h.store.applyStatic(input());
    const again = h.store.applyStatic(input());
    expect(again.written).toEqual([]);
  });

  test("region labels (ja / en)", () => {
    const r: FileRegion = { kind: "methods", start: 1 as LineNo, end: 9 as LineNo, depth: 0, count: 12, names: [], host: "Server" };
    expect(regionLabel(r, "ja")).toBe("Server のメソッド（12）");
    expect(regionLabel(r, "en")).toBe("methods of Server (12)");
    expect(regionLabel({ kind: "effects", start: 1 as LineNo, end: 2 as LineNo, depth: 1, names: [], hooks: { useEffect: 3 } }, "ja")).toBe(
      "副作用（useEffect 3）",
    );
    expect(regionLabel({ kind: "render", start: 1 as LineNo, end: 2 as LineNo, depth: 1, names: [] }, "en")).toBe("Render (JSX)");
  });
});
