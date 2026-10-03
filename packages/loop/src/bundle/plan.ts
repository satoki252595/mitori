import type { BlockId, EstimateItem, LineNo, RepoPath, ThreadId } from "@mitori/core";
import { BUNDLE_DROP_ORDER, BUNDLE_LIMITS, type Bundle } from "../contract.ts";
import type { Block, CodeGroup } from "./code.ts";
import type { Estimator } from "./estimate.ts";
import type { RelEntry } from "./rel.ts";
import type { RulesSlice } from "./rules.ts";

/** One thread's share of the DATA block, plus its ASK. */
export interface TaskPart {
  id: ThreadId;
  /** `TASK <id> <intent> R<n>`. */
  head: Block;
  /** `DOC …` line + the block's quoted text (or the "same as above" stub), in `neighbors` order afterwards. */
  doc: Block | null;
  docBlock: BlockId | null;
  /** `> ~prev: …` / `> ~next: …` lines, each a droppable unit. */
  neighbors: Block[];
  /** `SEL` + quote lines. */
  sel: Block | null;
  /** Earlier messages, oldest first (the newest `msgs.length` of `total`). */
  msgs: Block[];
  /** Messages before the ASK, shown or not. */
  total: number;
  /** `ASK [id]` + the human's text. */
  ask: Block;
}

/** A REL entry with its rendered block. */
export interface RelPart {
  entry: RelEntry;
  block: Block;
}

/** Everything a bundle is made of, with the state of what has been dropped. */
export interface PlanInit {
  est: Estimator;
  /** Lines before the DATA fence: `MBF/1 …`, `DENY …`, `GATE …`. */
  top: string[];
  /** One sentence ahead of everything (copy mode). */
  preface?: string;
  tasks: TaskPart[];
  rules: RulesSlice | null;
  rulesUntrusted: boolean;
  codes: CodeGroup[];
  rels: RelPart[];
  /** `WRITE …`, `ACCEPT` + bullets, `DO` + bullets, `BUDGET …` (mitori-written lines after the fence). */
  write: string[];
  accept: string[];
  doLines: string[];
  budget: string;
  refOnly: boolean;
}

export type Dropped = Record<(typeof BUNDLE_DROP_ORDER)[number], number>;

const FENCE_LINE_TOKENS = BUNDLE_LIMITS.fenceTokens;

/** The bundle as a plan: sums tokens, drops optional parts in `BUNDLE_DROP_ORDER`, renders the final text. */
export class Plan {
  private relShown: number;
  private rulesLevel: 0 | 1 | 2 = 0;
  private neighborsDropped = new Set<string>();
  private msgFrom: number[];
  private readonly topTokens: number;
  private readonly tailTokens: number;
  private dropped: Dropped = { REL: 0, RULES: 0, DOC_NEIGHBORS: 0, THREAD_OLD: 0, CODE_CONTEXT: 0 };

  constructor(readonly init: PlanInit) {
    this.relShown = init.rels.length;
    this.msgFrom = init.tasks.map(() => 0);
    this.topTokens = init.est.tags(init.preface ? [init.preface, ...init.top] : init.top);
    this.tailTokens = init.est.tags([...init.write, ...init.accept, ...init.doLines, init.budget, "END"]);
  }

  /** Back to the full bundle (before any drop). */
  reset(): void {
    this.relShown = this.init.rels.length;
    this.rulesLevel = 0;
    this.neighborsDropped = new Set();
    this.msgFrom = this.init.tasks.map(() => 0);
    this.dropped = { REL: 0, RULES: 0, DOC_NEIGHBORS: 0, THREAD_OLD: 0, CODE_CONTEXT: 0 };
    for (const g of this.init.codes) g.level = 0;
  }

  /** Drop the next optional piece in `BUNDLE_DROP_ORDER`; the kind dropped, or null when only mandatory parts are left. */
  dropNext(): (typeof BUNDLE_DROP_ORDER)[number] | null {
    const { rules, tasks, codes } = this.init;
    if (this.relShown > 0) {
      this.relShown--;
      this.dropped.REL++;
      return "REL";
    }
    if (rules && this.rulesLevel < 2) {
      this.rulesLevel = this.rulesLevel === 0 && rules.oneLine.length > 0 ? 1 : 2;
      this.dropped.RULES = 1;
      return "RULES";
    }
    for (let t = tasks.length - 1; t >= 0; t--) {
      const task = tasks[t] as TaskPart;
      for (let n = task.neighbors.length - 1; n >= 0; n--) {
        const k = `${t}:${n}`;
        if (!this.neighborsDropped.has(k)) {
          this.neighborsDropped.add(k);
          this.dropped.DOC_NEIGHBORS++;
          return "DOC_NEIGHBORS";
        }
      }
    }
    let best = -1;
    for (let t = 0; t < tasks.length; t++) {
      const shown = (tasks[t] as TaskPart).msgs.length - (this.msgFrom[t] as number);
      if (shown > 0 && (best < 0 || shown > (tasks[best] as TaskPart).msgs.length - (this.msgFrom[best] as number))) best = t;
    }
    if (best >= 0) {
      this.msgFrom[best] = (this.msgFrom[best] as number) + 1;
      this.dropped.THREAD_OLD++;
      return "THREAD_OLD";
    }
    // Narrow the context of the group that shows the most lines; skip levels that change nothing.
    let pick: CodeGroup | null = null;
    let pickLines = 0;
    for (const g of codes) {
      if (g.level >= 3) continue;
      const lines = g.linesAt(g.level);
      if (g.linesAt(3) === lines) continue;
      if (lines > pickLines) {
        pick = g;
        pickLines = lines;
      }
    }
    if (pick) {
      const before = pick.linesAt(pick.level);
      do pick.level++;
      while (pick.level < 3 && pick.linesAt(pick.level) === before);
      this.dropped.CODE_CONTEXT += before - pick.linesAt(pick.level);
      return "CODE_CONTEXT";
    }
    return null;
  }

  private threadBlocks(t: number): { header: string; msgs: Block[] } | null {
    const task = this.init.tasks[t] as TaskPart;
    const msgs = task.msgs.slice(this.msgFrom[t] as number);
    return msgs.length === 0 ? null : { header: `THREAD ${msgs.length}/${task.total}`, msgs };
  }

  private rulesBlock(): Block | null {
    const r = this.init.rules;
    if (!r || this.rulesLevel === 2) return null;
    const lines = this.rulesLevel === 0 ? r.lines : r.oneLine;
    return { lines: [r.header, ...lines], tokens: this.init.est.tags([r.header]) + this.init.est.quote(lines) };
  }

  private omittedLine(): string | null {
    const parts: string[] = [];
    for (const k of BUNDLE_DROP_ORDER) {
      if (k === "RULES" && this.init.rulesUntrusted && !this.init.rules) parts.push("RULES=untrusted");
      else if (this.dropped[k] > 0) parts.push(`${k}=${this.dropped[k]}`);
    }
    return parts.length === 0 ? null : `OMITTED ${parts.join(" ")}`;
  }

  /** What was dropped (and the untrusted-rules marker), for `Bundle.omitted`. */
  omitted(): Bundle["omitted"] {
    const out: Bundle["omitted"] = [];
    for (const k of BUNDLE_DROP_ORDER) if (this.dropped[k] > 0) out.push({ kind: k, count: this.dropped[k] });
    if (this.init.rulesUntrusted && !this.init.rules) out.push({ kind: "RULES_UNTRUSTED", count: 1 });
    return out;
  }

  /** Estimated tokens of the bundle as it stands now. */
  tokens(): number {
    return this.parts().reduce((n, p) => n + p.tokens, 0);
  }

  /** Tokens by item key (Composer chips). */
  items(): EstimateItem[] {
    return this.parts()
      .filter((p) => p.item)
      .map((p) => ({ ...(p.item as Omit<EstimateItem, "tokens" | "cached">), tokens: Math.round(p.tokens), cached: false }));
  }

  /** Tokens in `items()` (their rounded sum), so chips and total agree. */
  itemTokens(): number {
    return this.items().reduce((n, i) => n + i.tokens, 0);
  }

  private parts(): { tokens: number; item?: Omit<EstimateItem, "tokens" | "cached"> }[] {
    const { init } = this;
    const { est } = init;
    const out: { tokens: number; item?: Omit<EstimateItem, "tokens" | "cached"> }[] = [];
    const omitted = this.omittedLine();
    out.push({
      tokens: this.topTokens + FENCE_LINE_TOKENS + this.tailTokens + (omitted ? est.tags([omitted]) : 0),
      item: { key: "write", kind: "instructions", label: "WRITE", removable: false },
    });
    const rules = this.rulesBlock();
    if (rules) out.push({ tokens: rules.tokens, item: { key: "rules", kind: "rules", label: "RULES", removable: true } });
    let asks = 0;
    let threadTokens = 0;
    let neighborTokens = 0;
    const docTokens = new Map<BlockId, number>();
    init.tasks.forEach((task, t) => {
      asks += task.ask.tokens + task.head.tokens;
      const docCost = (task.doc?.tokens ?? 0) + (task.sel?.tokens ?? 0);
      if (task.docBlock) docTokens.set(task.docBlock, (docTokens.get(task.docBlock) ?? 0) + docCost);
      else asks += docCost;
      task.neighbors.forEach((n, i) => {
        if (!this.neighborsDropped.has(`${t}:${i}`)) neighborTokens += n.tokens;
      });
      const th = this.threadBlocks(t);
      if (th) threadTokens += est.tags([th.header]) + th.msgs.reduce((s, m) => s + m.tokens, 0);
    });
    out.push({ tokens: asks, item: { key: "ask", kind: "ask", label: "ASK", removable: false } });
    for (const [block, tokens] of docTokens) out.push({ tokens, item: { key: `doc:${block}`, kind: "doc", label: block, removable: false } });
    if (neighborTokens > 0) out.push({ tokens: neighborTokens, item: { key: "doc:neighbors", kind: "doc", label: "~prev/~next", removable: true } });
    if (threadTokens > 0) out.push({ tokens: threadTokens, item: { key: "thread", kind: "thread", label: "THREAD", removable: true } });
    let context = 0;
    for (const g of init.codes) {
      const { blocks, anchorTokens } = g.blocks(g.level, init.refOnly);
      const total = blocks.reduce((n, b) => n + b.tokens, 0);
      const share = g.anchors.length === 0 ? total : anchorTokens / g.anchors.length;
      for (const a of g.anchors) {
        const lines = a.end - a.start + 1;
        out.push({
          tokens: init.refOnly ? total / Math.max(1, g.anchors.length) : share,
          item: { key: `code:${g.path}:${a.start}-${a.end}`, kind: "code", label: `${g.path}:${a.start}-${a.end}`, removable: false, path: g.path, lines },
        });
      }
      if (!init.refOnly) context += Math.max(0, total - anchorTokens);
    }
    if (context >= 0.5) out.push({ tokens: context, item: { key: "code:context", kind: "code", label: "context", removable: true } });
    for (let i = 0; i < this.relShown; i++) {
      const r = init.rels[i] as RelPart;
      out.push({
        tokens: r.block.tokens,
        item: { key: r.entry.key, kind: "related", label: `${r.entry.path}:${r.entry.line}`, removable: true, path: r.entry.path },
      });
    }
    return out;
  }

  /** Final text. `nonce` goes into the two fence lines only. */
  render(nonce: string): { text: string; data: string } {
    const { init } = this;
    const data: string[] = [];
    const rules = this.rulesBlock();
    if (rules) data.push(...rules.lines);
    init.tasks.forEach((task, t) => {
      data.push(...task.head.lines);
      if (task.doc) {
        data.push(...task.doc.lines);
        task.neighbors.forEach((n, i) => {
          if (!this.neighborsDropped.has(`${t}:${i}`)) data.push(...n.lines);
        });
      }
      if (task.sel) data.push(...task.sel.lines);
      const th = this.threadBlocks(t);
      if (th) data.push(th.header, ...th.msgs.flatMap((m) => m.lines));
    });
    for (const g of init.codes) for (const b of g.blocks(g.level, init.refOnly).blocks) data.push(...b.lines);
    for (let i = 0; i < this.relShown; i++) data.push(...(init.rels[i] as RelPart).block.lines);
    const omitted = this.omittedLine();
    const lines = [
      ...(init.preface ? [init.preface] : []),
      ...init.top,
      `<<<DATA ${nonce}>>>`,
      ...data,
      `<<<END ${nonce}>>>`,
      ...init.tasks.flatMap((t) => t.ask.lines),
      ...init.write,
      ...init.accept,
      ...init.doLines,
      init.budget,
      ...(omitted ? [omitted] : []),
      "END",
    ];
    return { text: `${lines.join("\n")}\n`, data: data.join("\n") };
  }

  /** Blobs of every file whose text is embedded. */
  blobs(): Record<RepoPath, string> {
    const out: Record<RepoPath, string> = {};
    for (const g of this.init.codes) out[g.path] = g.blob;
    return out;
  }

  /** Lines currently shown, for diagnostics. */
  shownCodeLines(): { path: RepoPath; start: LineNo; end: LineNo }[] {
    return this.init.codes.flatMap((g) => g.segments(g.level).map((s) => ({ path: g.path, start: s.start, end: s.end })));
  }
}
