/** ux.md §6.6 static diff HTML (DOM budget) and §4.7.2 focus-unit decisions (Map K7, SEC-12). */
import { describe, expect, test } from "bun:test";
import type { FileDiff, HunkId, ProposalId } from "@mitori/core";
import type { ReviewDecisions } from "../contract.ts";
import { acceptAll, decide, focusedUnit, isPartial, outcome, step, unitsOf } from "./decisions.ts";
import { changedSpan, diffLineCount, esc, mergeTexts, renderDiffHtml } from "./diff-html.ts";

const FILES: FileDiff[] = [
  {
    path: "cmd/crit/cli_handlers_story.go",
    status: "modified",
    binary: false,
    additions: 2,
    deletions: 1,
    hunks: [
      {
        id: "cmd/crit/cli_handlers_story.go:572" as HunkId,
        oldStart: 572,
        oldLines: 3,
        newStart: 572,
        newLines: 4,
        lines: [
          " \treturn resumeStory(f)",
          "-\tagentCmd := config.LoadConfig(mustCWD()).AgentCmd",
          "+\tcfg := config.LoadConfig(mustCWD())",
          "+\tagentCmd := cfg.AgentCmd",
          " }",
        ],
      },
    ],
  },
  {
    path: "internal/config/config.go",
    status: "modified",
    binary: false,
    additions: 1,
    deletions: 0,
    hunks: [
      {
        id: "internal/config/config.go:45" as HunkId,
        oldStart: 45,
        oldLines: 1,
        newStart: 45,
        newLines: 2,
        lines: [" type Config struct {", "+\tStoryMaxRetries int <b>"],
      },
    ],
  },
];
const LABELS = { accept: "accept", reject: "reject", binary: "binary" };
const dec = (): ReviewDecisions => ({ job: "j_1" as never, hunks: new Map(), proposals: new Map(), focus: { kind: "all" } });

describe("WEB-U-REV-01 static diff HTML", () => {
  test("escaped, numbered by data-l, signs never colour-only", () => {
    const html = renderDiffHtml(FILES, LABELS);
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>");
    expect(html).toContain('data-l="572 572  "');
    expect(html).toContain('data-l="573     −"');
    expect(html).toContain('data-unit="file:internal/config/config.go"');
    expect(html.match(/class="dl/g)).toHaveLength(7);
    expect(diffLineCount(FILES)).toBe(2 + 2 + 7);
  });

  test("paired −/+ lines highlight only the changed middle", () => {
    expect(changedSpan("agentCmd := a.AgentCmd", "cfg := a")).toEqual({ pre: 0, suf: 0 });
    const s = changedSpan("retry once", "retry twice");
    expect(s).toEqual({ pre: 6, suf: 2 });
    expect(renderDiffHtml(FILES, LABELS)).toContain('<span class="wd">');
  });

  test("a 2,000-line diff renders its first 400 lines only (static part before CM6)", () => {
    const big: FileDiff = {
      path: "big.go",
      status: "modified",
      binary: false,
      additions: 2400,
      deletions: 0,
      hunks: [{ id: "big.go:1" as HunkId, oldStart: 1, oldLines: 0, newStart: 1, newLines: 2400, lines: Array.from({ length: 2400 }, (_, i) => `+line ${i}`) }],
    };
    expect(renderDiffHtml([big], LABELS, 400).match(/class="dl/g)).toHaveLength(400);
  });

  test("merge texts rebuild both sides with real new-side line numbers", () => {
    const m = mergeTexts(FILES[0] as FileDiff);
    expect(m.a.split("\n")).toHaveLength(3);
    expect(m.b.split("\n")).toHaveLength(4);
    expect(m.bLines).toEqual([572, 573, 574, 575]);
  });

  test("esc", () => expect(esc(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;"));
});

describe("WEB-U-REV-02 focus-unit decisions", () => {
  const units = unitsOf(FILES, ["pp_1" as ProposalId]);

  test("opens on the whole proposal; n / ⇧N walk hunks then proposals", () => {
    const d = dec();
    expect(focusedUnit(d, units)).toBeNull();
    step(d, units, 1);
    expect(focusedUnit(d, units)?.id).toBe("cmd/crit/cli_handlers_story.go:572");
    step(d, units, 1);
    step(d, units, 1);
    expect(focusedUnit(d, units)?.id).toBe("pp_1");
    step(d, units, 1);
    expect(focusedUnit(d, units)?.id).toBe("pp_1");
    const e = dec();
    step(e, units, -1);
    expect(focusedUnit(e, units)?.id).toBe("pp_1");
  });

  test("deciding moves to the next undecided unit; the call is built once everything is decided", () => {
    const d = dec();
    step(d, units, 1);
    decide(d, units, units[0] as never, "accept");
    expect(focusedUnit(d, units)?.id).toBe("internal/config/config.go:45");
    expect(outcome(d, units, { sensitive: false, unverified: false })).toEqual({ kind: "pending", decided: 1, total: 3 });
    decide(d, units, units[1] as never, "reject");
    decide(d, units, units[2] as never, "accept");
    const o = outcome(d, units, { sensitive: false, unverified: true });
    expect(o).toEqual({
      kind: "accept",
      req: { accept: ["cmd/crit/cli_handlers_story.go:572"], reject: ["internal/config/config.go:45"], proposals: ["pp_1"], acceptUnverified: true },
    });
    if (o.kind === "accept") expect(isPartial(o.req)).toBe(true);
  });

  test("all accepted ⇒ `all`; all rejected ⇒ the deferred reject; file-level decisions", () => {
    const d = dec();
    decide(d, units, { kind: "file", path: "cmd/crit/cli_handlers_story.go" }, "accept");
    decide(d, units, { kind: "file", path: "internal/config/config.go" }, "accept");
    decide(d, units, units[2] as never, "accept");
    expect(outcome(d, units, { sensitive: false, unverified: false })).toEqual({ kind: "accept", req: { accept: "all", proposals: ["pp_1"] } });
    const r = dec();
    for (const u of units) decide(r, units, u, "reject");
    expect(outcome(r, units, { sensitive: false, unverified: false })).toEqual({ kind: "reject" });
  });

  test("SEC-12: sensitive jobs never send `all`, ⌥⌘⏎ is refused", () => {
    const d = dec();
    for (const u of units) decide(d, units, u, "accept");
    const o = outcome(d, units, { sensitive: true, unverified: false });
    expect(o.kind === "accept" && o.req.accept).toEqual(["cmd/crit/cli_handlers_story.go:572", "internal/config/config.go:45"]);
    expect(acceptAll(units, { sensitive: true, unverified: false })).toBeNull();
    expect(acceptAll(units, { sensitive: false, unverified: false })).toEqual({ accept: "all", proposals: ["pp_1"] });
  });
});
