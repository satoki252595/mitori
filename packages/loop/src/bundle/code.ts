import type { GitOid, LineNo, RepoPath } from "@mitori/core";
import { BUNDLE_LIMITS } from "../contract.ts";
import type { Estimator } from "./estimate.ts";
import { codeLines } from "./lines.ts";

/** An anchored range inside a group, with the enclosing symbol's qualified name when known. */
export interface AnchorSpan {
  start: LineNo;
  end: LineNo;
  sym?: string;
}

/** A rendered part: its lines and its token estimate. */
export interface Block {
  lines: string[];
  tokens: number;
}

interface Segment {
  start: LineNo;
  end: LineNo;
  anchors: AnchorSpan[];
}

/** Context margins of levels 1..3 (spec §4.4 CODE_CONTEXT: ±20 → ±10 → ±5 → 0; level 0 is the symbol or ±20). */
const MARGINS = [BUNDLE_LIMITS.codeContextSteps[1] as number, BUNDLE_LIMITS.codeContextSteps[2] as number, BUNDLE_LIMITS.codeContextSteps[3] as number];

/**
 * The code of one file as far as the bundle shows it: the loaded text (the widest context) and the anchored
 * spans. `segments(level)` narrows the context step by step; spans that no longer touch become separate CODE blocks.
 */
export class CodeGroup {
  /** Context level currently shown (0 = widest). */
  level = 0;
  private readonly cache = new Map<string, { blocks: Block[]; anchorTokens: number }>();

  constructor(
    readonly path: RepoPath,
    readonly blob: GitOid,
    /** Loaded lines, `first` is the number of `text[0]`. */
    readonly text: readonly string[],
    readonly first: LineNo,
    readonly anchors: readonly AnchorSpan[],
    readonly numbered: boolean,
    private readonly est: Estimator,
  ) {}

  get last(): LineNo {
    return this.first + this.text.length - 1;
  }

  /** Contiguous ranges shown at `level`. */
  segments(level: number): Segment[] {
    if (level <= 0) return [{ start: this.first, end: this.last, anchors: [...this.anchors] }];
    const m = MARGINS[Math.min(level, 3) - 1] as number;
    const out: Segment[] = [];
    for (const a of [...this.anchors].sort((x, y) => x.start - y.start)) {
      const start = Math.max(this.first, a.start - m);
      const end = Math.min(this.last, a.end + m);
      const prev = out[out.length - 1];
      if (prev && start <= prev.end + 1) {
        prev.end = Math.max(prev.end, end);
        prev.anchors.push(a);
      } else out.push({ start, end, anchors: [a] });
    }
    return out;
  }

  /** Lines shown at `level`. */
  linesAt(level: number): number {
    return this.segments(level).reduce((n, s) => n + (s.end - s.start + 1), 0);
  }

  /** CODE blocks at `level`; `refOnly` replaces the bodies by a reference header (agent mode over budget). */
  blocks(level: number, refOnly = false): { blocks: Block[]; anchorTokens: number } {
    const key = `${level}:${refOnly}`;
    let hit = this.cache.get(key);
    if (!hit) {
      const blocks: Block[] = [];
      let anchorTokens = 0;
      // reference-only blocks name just the anchored ranges: the agent reads the files itself
      for (const s of this.segments(refOnly ? 3 : level)) {
        const ranges = s.anchors.map((a) => (a.end === a.start ? `${a.start}` : `${a.start}-${a.end}`)).join(",");
        const sym = s.anchors.find((a) => a.sym)?.sym;
        const head = `CODE ${this.path}:${s.start}-${s.end} base=${this.blob.slice(0, 7)}${sym ? ` sym=${sym}` : ""} anchor=${ranges}${refOnly ? " (read with Read)" : ""}`;
        const body = refOnly ? [] : codeLines(this.text.slice(s.start - this.first, s.end - this.first + 1), s.start, this.numbered);
        const headTokens = this.est.tags([head]);
        blocks.push({ lines: [head, ...body], tokens: headTokens + this.est.code(body) });
        // the header belongs to the anchored part; whatever else the block holds is context
        anchorTokens += headTokens;
        if (!refOnly) {
          for (const a of s.anchors) anchorTokens += this.est.code(body.slice(a.start - s.start, a.end - s.start + 1));
        }
      }
      hit = { blocks, anchorTokens };
      this.cache.set(key, hit);
    }
    return hit;
  }

  tokens(level: number, refOnly = false): number {
    return this.blocks(level, refOnly).blocks.reduce((n, b) => n + b.tokens, 0);
  }
}
