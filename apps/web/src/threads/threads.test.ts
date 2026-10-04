/** ux.md §6.9 thread status, §6.1 anchor text rules (ANCHOR_TEXT_RULES mirror) and claim binding. */
import { describe, expect, test } from "bun:test";
import type { ThreadState } from "@mitori/core";
import { STATUS_PRESENTATION } from "../contract.ts";
import { bindClaim, displayQuote, normalize, normalizedRange, quoteOf, selectionCounts } from "./anchor-text.ts";
import { threadStatus } from "./index.ts";

const th = (
  state: ThreadState,
  extra: Partial<{ anchorHealth: "ok" | "outdated" | "fuzzy" | "moved"; intent: "note" | "doc_edit" | "change"; stale: boolean }> = {},
) => ({
  state,
  anchorHealth: extra.anchorHealth ?? "ok",
  intent: extra.intent ?? "note",
  stale: extra.stale ?? false,
});

describe("WEB-U-TH-01 threadStatus", () => {
  test("lifecycle states map onto the vocabulary; proposed = レビュー待ち", () => {
    const all: ThreadState[] = ["draft", "open", "queued", "running", "answered", "proposed", "applied", "rejected", "failed", "needs_input", "resolved"];
    for (const s of all) expect(STATUS_PRESENTATION[threadStatus(th(s))]).toBeDefined();
    expect(threadStatus(th("proposed"))).toBe("ready");
  });

  test("doc_edit drafts need the 2-way choice; outdated anchors win over the state; stale only when passive", () => {
    expect(threadStatus(th("draft", { intent: "doc_edit" }))).toBe("needs_choice");
    expect(threadStatus(th("open", { anchorHealth: "outdated" }))).toBe("outdated");
    expect(threadStatus(th("resolved", { anchorHealth: "outdated" }))).toBe("resolved");
    expect(threadStatus(th("open", { stale: true }))).toBe("stale");
    expect(threadStatus(th("running", { stale: true }))).toBe("running");
    expect(threadStatus(th("open", { anchorHealth: "fuzzy" }))).toBe("open");
  });
});

describe("WEB-U-TH-02 anchor text normalization", () => {
  test("whitespace runs collapse to one space, trimmed; offsets follow", () => {
    const raw = "  認証は\n  session.go の  SessionKey  ";
    const n = normalize(raw);
    expect(n.text).toBe("認証は session.go の SessionKey");
    const at = raw.indexOf("SessionKey");
    const r = normalizedRange(n, at, at + "SessionKey".length);
    expect(n.text.slice(r.start, r.end)).toBe("SessionKey");
    // a selection starting in the leading whitespace starts at 0; one ending in the trailing run ends at the end
    expect(normalizedRange(n, 0, raw.length)).toEqual({ start: 0, end: n.text.length });
  });

  test("NFC: decomposed kana keep their offsets after composition", () => {
    const raw = "がき"; // が (decomposed) + き
    const n = normalize(raw);
    expect(n.text).toBe("がき");
    const r = normalizedRange(n, raw.length - 1, raw.length);
    expect(n.text.slice(r.start, r.end)).toBe("き");
  });

  test("quote: 32 chars of context, exact capped at 2,000", () => {
    const text = `${"あ".repeat(40)}正確に1回だけ再試行する${"い".repeat(40)}`;
    const s = 40;
    const e = s + "正確に1回だけ再試行する".length;
    const q = quoteOf(text, s, e);
    expect(q.quote.exact).toBe("正確に1回だけ再試行する");
    expect(q.quote.prefix).toHaveLength(32);
    expect(q.quote.suffix).toHaveLength(32);
    expect(quoteOf("x".repeat(3000), 0, 3000).quote.exact).toHaveLength(2000);
    const d = displayQuote(text, s, e);
    expect(d.before.startsWith("…")).toBe(true);
    expect(d.before).toHaveLength(19);
  });

  test("UX-QUOTE-01: a table cell's quote is exactly the selection — never the neighbouring cells' cite text (live finding)", () => {
    // the §4 env table as block text: the selected name sits between two rows' `config.go:N` cells
    const text = "名前 既定値 読む場所 PORT あり internal/config/config.go:20 TSUNDOKU_API_TOKEN なし internal/config/config.go:36";
    const s = text.indexOf("TSUNDOKU_API_TOKEN");
    const e = s + "TSUNDOKU_API_TOKEN".length;
    expect(displayQuote(text, s, e).before).toContain("config.go:20"); // what the Composer used to show
    expect(displayQuote(text, s, e, 18, { start: s, end: e, cell: true })).toEqual({ before: "", mark: "TSUNDOKU_API_TOKEN", after: "" });
    // a paragraph keeps its own context, clipped at its edges (no "…" when the paragraph ends there)
    const para = "前の段落。 再試行は 1 回だけ。 次の段落。";
    const ps = para.indexOf("再試行は");
    const pe = para.indexOf("。 次");
    const q = displayQuote(para, ps + 4, ps + 7, 18, { start: ps, end: pe + 1 });
    expect(q).toEqual({ before: "再試行は", mark: " 1 ", after: "回だけ。" });
  });

  test("UXP-37: one CJK character is a selection, one Latin letter is not", () => {
    expect(selectionCounts("鍵")).toBe(true);
    expect(selectionCounts("a")).toBe(false);
    expect(selectionCounts(" ab ")).toBe(true);
  });

  test("claim binding: ≥ 50 % of the selection and ≥ 30 % of the claim", () => {
    const claims = [
      { id: "cl_a", start: 0, end: 100 },
      { id: "cl_b", start: 100, end: 120 },
    ];
    expect(bindClaim({ start: 10, end: 50 }, claims)).toBe("cl_a");
    expect(bindClaim({ start: 95, end: 125 }, claims)).toBe("cl_b");
    expect(bindClaim({ start: 0, end: 20 }, [{ id: "cl_c", start: 0, end: 1000 }])).toBeNull();
  });
});
