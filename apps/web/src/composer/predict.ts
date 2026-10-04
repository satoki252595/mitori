/**
 * Same-frame client prediction of the estimate and the router (ux.md §6.2.6, AC-J32): every chip toggle or body
 * edit recomputes tokens, $ and patch/agent from the server's estimate items, using only `@mitori/core` pure data
 * (`CHARS_PER_TOKEN`, `PRICING`, `priceUsage`, `DEFAULT_LIMITS`). The server re-estimates 300 ms later and wins.
 */
import {
  CHARS_PER_TOKEN,
  DEFAULT_LIMITS,
  type EngineId,
  type EngineSettings,
  type EstimateItem,
  type ExecMode,
  type Limits,
  type ModelId,
  PRICING,
  priceUsage,
  type ThreadIntent,
} from "@mitori/core";
import type { ComposerChip, ComposerState } from "../contract.ts";

const JA = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const V5 = CHARS_PER_TOKEN["claude-v5"];

/** Instruction tokens of the body: Japanese-majority text at the ja ratio (min 40), else the en ratio. */
export function instrTokens(body: string): number {
  const chars = [...body];
  if (chars.length === 0) return 0;
  const ja = chars.filter((c) => JA.test(c)).length;
  if (ja * 2 >= chars.length) return Math.max(40, Math.ceil(chars.length / V5.markdown_ja));
  return Math.ceil(chars.length / V5.markdown_en);
}

/** Items that the body replaces (the server measured the body at estimate time). */
const BODY_KINDS: ReadonlySet<EstimateItem["kind"]> = new Set(["ask", "instructions"]);

export interface Prediction {
  mode: ExecMode;
  lines: number;
  files: number;
  tokensIn: number;
  tokensOut: number;
  usd: number | null;
  /** Why the router picks `mode` (shown in the router chip when ≠ patch). */
  reason: "small_change" | "large_change" | "intent_question" | "intent_review" | null;
}

/** Intents answered without edits (router R0). */
export function answerIntent(intent: ThreadIntent): boolean {
  return intent === "question" || intent === "review";
}

export function predict(opts: {
  chips: readonly ComposerChip[];
  body: string;
  intent: ThreadIntent;
  outTokens: number;
  model: ModelId;
  engine?: EngineId;
  genericPricing?: EngineSettings["generic"]["pricing"];
  limits?: Pick<Limits, "patchMaxLines" | "patchMaxFiles">;
  override?: ComposerState["override"];
}): Prediction {
  const limits = opts.limits ?? DEFAULT_LIMITS;
  let fresh = 0;
  let cached = 0;
  let lines = 0;
  const files = new Set<string>();
  for (const c of opts.chips) {
    if (c.state !== "included") continue;
    const it = c.item;
    if (it.kind === "output" || BODY_KINDS.has(it.kind)) continue;
    if (it.cached) cached += it.tokens;
    else fresh += it.tokens;
    if (it.kind === "code" || it.kind === "related") {
      if (it.path) files.add(it.path);
      lines += it.lines ?? 0;
    }
  }
  const instr = instrTokens(opts.body);
  fresh += instr;
  let mode: ExecMode;
  let reason: Prediction["reason"];
  if (answerIntent(opts.intent)) {
    mode = "answer";
    reason = opts.intent === "question" ? "intent_question" : "intent_review";
  } else if (lines <= limits.patchMaxLines && files.size <= limits.patchMaxFiles) {
    mode = "patch";
    reason = "small_change";
  } else {
    mode = "agent";
    reason = "large_change";
  }
  if (opts.override?.mode) mode = opts.override.mode;
  const model = opts.override?.model ?? opts.model;
  const generic = opts.engine === "generic" || model.startsWith("generic:");
  const priced = model in PRICING || (generic && opts.genericPricing !== undefined);
  const usd = priced
    ? priceUsage(
        model,
        { in: generic ? fresh + cached : fresh, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: generic ? 0 : cached, out: opts.outTokens },
        false,
        generic ? opts.genericPricing : undefined,
      )
    : null;
  return { mode, lines, files: files.size, tokensIn: fresh + cached, tokensOut: opts.outTokens, usd, reason };
}

/** Chips from a fresh server estimate, keeping the user's removals and the candidates the user added. */
export function mergeChips(prev: readonly ComposerChip[], items: readonly EstimateItem[], candidates: readonly EstimateItem[] = []): ComposerChip[] {
  const prevState = new Map(prev.map((c) => [c.item.key, c.state]));
  const out: ComposerChip[] = [];
  for (const item of items) {
    if (item.kind === "output") continue;
    const was = prevState.get(item.key);
    out.push({ item, state: was === "removed" && item.removable ? "removed" : "included" });
  }
  const have = new Set(out.map((c) => c.item.key));
  for (const item of candidates) {
    if (have.has(item.key)) continue;
    // an added candidate the server already folded into `items` is covered above
    out.push({ item, state: prevState.get(item.key) === "included" ? "included" : "candidate" });
  }
  return out;
}

/** `path:a-b` / `path:a` at the end of a chip label (estimate items label code ranges that way). */
export function labelRange(label: string): { start: number; end: number } | null {
  const m = /:(\d+)(?:[-–](\d+))?$/.exec(label);
  if (!m) return null;
  const start = Number(m[1]);
  return { start, end: m[2] ? Number(m[2]) : start };
}

/**
 * `ContextAdjust` for the server: removed removable items, the candidates the user added (sent as the code range
 * of the candidate, the only addition `ContextAdjust` knows) and `@` mention ranges.
 */
export function contextAdjust(
  chips: readonly ComposerChip[],
  candidateKeys: ReadonlySet<string>,
  mentions: readonly { path: string; start: number; end: number }[],
): { remove?: string[]; add?: { path: string; start: number; end: number }[] } {
  const remove = chips.filter((c) => c.state === "removed" && c.item.removable && !candidateKeys.has(c.item.key)).map((c) => c.item.key);
  const add = mentions.map((m) => ({ path: m.path, start: m.start, end: m.end }));
  for (const c of chips) {
    if (c.state !== "included" || !candidateKeys.has(c.item.key) || !c.item.path) continue;
    const r = labelRange(c.item.label);
    if (r) add.push({ path: c.item.path, ...r });
  }
  return { ...(remove.length ? { remove } : {}), ...(add.length ? { add } : {}) };
}
