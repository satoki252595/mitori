import { describe, expect, test } from "bun:test";
import { checkCrLedger, extractRefs, parseLedger } from "./cr-ledger.ts";

const LEDGER = `# ledger
| id | requester | 決定 | 適用先 | 理由 |
|---|---|---|---|---|
| CR idx-1 | idx | accepted | core | — |
| CR idx-2 | idx | deferred（M4） | core | — |
| CR gen-C1 | gen | accepted-modified | core | — |
| CR ux-R2 | ux | rejected（変更不要） | — | — |
| CR loop-3 | loop | accepted | — | — |
| CR test-5 | test | accepted | — | — |
| gL-1 | gen → loop | accepted | — |
`;
const ids = (path: string, text: string) => extractRefs(path, text).refs.map((r) => r.id);
const run = (files: { path: string; text: string }[]) => checkCrLedger({ path: "L.md", text: LEDGER }, files).map((p) => `${p.rule}:${p.file}:${p.line}`);

describe("check-cr-ledger (WP-00a acceptance)", () => {
  test("an unregistered CR-99 in a spec fails", () => {
    expect(run([{ path: "docs/design/specs/indexer.md", text: "see CR-1 and CR-99" }])).toEqual(["cr-unknown:docs/design/specs/indexer.md:1"]);
    expect(run([{ path: "docs/design/specs/ux.md", text: "x\nCR-99 here" }])).toEqual(["cr-ambiguous:docs/design/specs/ux.md:2"]);
    expect(run([{ path: "docs/design/specs/indexer.md", text: "CR-99 <!-- cr-ledger:ignore -->" }])).toEqual([]);
  });

  test("undecided and duplicate ledger rows fail", () => {
    const bad = `| CR idx-1 | idx | proposed | x |\n| CR idx-1 | idx | accepted | x |\n`;
    expect(parseLedger(bad).problems.map((p) => p.rule)).toEqual(["cr-undecided", "cr-duplicate"]);
    expect(parseLedger(LEDGER).problems).toEqual([]);
    expect(parseLedger(LEDGER).rows.map((r) => r.id)).toEqual(["CR idx-1", "CR idx-2", "CR gen-C1", "CR ux-R2", "CR loop-3", "CR test-5", "gL-1"]);
  });

  test("bare CR-n resolves by qualifier word, then by file default", () => {
    expect(ids("docs/design/specs/server.md", "budget, indexer CR-1 applied")).toEqual(["CR idx-1"]);
    expect(ids("docs/design/ARCHITECTURE.md", "testing CR-5")).toEqual(["CR test-5"]);
    expect(ids("docs/design/specs/testing.md", "- **CR-5** api")).toEqual(["CR test-5"]);
    expect(ids("packages/indexer/src/contract.ts", "/** seeds (CR-1). */")).toEqual(["CR idx-1"]);
    expect(ids("docs/design/specs/gen.md", "CR-LEDGER.md is not a ref")).toEqual([]);
  });

  test("qualified ids anywhere; spec request tables map to ledger ids", () => {
    expect(ids("packages/core/src/domain.ts", "[CR idx-2, CONS-11] and [CR gen-C1]")).toEqual(["CR idx-2", "CR gen-C1"]);
    const gen = "## 17. x\n### 17.1 core\n| # | 変更 |\n| C1 | a |\n### 17.2 loop\n| L1 | b |\n### 17.3 other\n| C9 | not a CR |\n";
    expect(ids("docs/design/specs/generation.md", gen)).toEqual(["CR gen-C1", "gL-1"]);
    const ux = "## 15. x\n| R9 | no |\n## 16. 契約への変更要望\n| R2 | api |\n";
    expect(ids("docs/design/specs/ux.md", ux)).toEqual(["CR ux-R2"]);
    const loop = "### 14.2 x\n1. no\n### 14.3 core / api\n3. `FinishReq`\n### 14.4 y\n2. no\nsee §14.3-3";
    expect(ids("docs/design/specs/loop.md", loop)).toEqual(["CR loop-3", "CR loop-3"]);
    expect(
      run([
        { path: "docs/design/specs/generation.md", text: gen },
        { path: "docs/design/specs/ux.md", text: ux },
        { path: "docs/design/specs/loop.md", text: loop },
      ]),
    ).toEqual([]);
  });
});
