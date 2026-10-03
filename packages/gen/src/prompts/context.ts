/**
 * ValidationContext of a rendered task, derived from what the task actually SHOWED (gen spec §6.3 V17):
 * `N|` lines under `=== <path>`, `path:line` locations and repeated `path:a-b` cites in `> ` lines, and the
 * full range of a symbol whose signature line was shown. Built from the rendered DATA lines so the push path,
 * the session packet and `mitori check` derive the same context from the same bytes.
 */
import type { BlockAspect, BlockId, BlockKind, DocLang, LineNo, ModuleId, RepoPath, SectionId } from "@mitori/core";
import { type CitableSet, type ExistingRef, GEN_PROMPTS, type GenPromptId, type LineForm, type PlannedTask, type ValidationContext } from "../contract.ts";
import { sectionAspects } from "../line/aspects.ts";

/** Line form per prompt: the contract table (gen.* = compact since CR m1-15; the compact validator also accepts full-form lines). */
export function lineForm(prompt: GenPromptId): LineForm {
  return GEN_PROMPTS[prompt].form;
}

/** File facts the context needs from the index. */
export interface ContextIndex {
  /** Line count at the task snapshot (null: not in the index / excluded / denied). */
  fileLines(path: RepoPath): number | null;
  /** Symbol ranges of a file (signature line = start). */
  symbolRanges(path: RepoPath): readonly { start: LineNo; end: LineNo }[];
}

/**
 * Longest run of unseen lines a cited range may cross between shown lines (V17). Measured on crit (dogfood
 * 2026-10-04): 29 of the 32 rejected ranges whose path was shown crossed runs of ≤ 6 lines — the doc comment and blank
 * lines between two shown signatures — and were grounded; the remaining ones spanned elided bodies.
 */
export const CITE_GAP_LINES = 6;

const LOCATION_RE = /(?<![\w./@+-])([\w@+.-]+(?:\/[\w@+.-]+)*\.[A-Za-z0-9]+|[\w@+.-]+(?:\/[\w@+.-]+)+):(\d+)(?:-(\d+))?/g;
const HEADER_PATH_RE = /^=== (.+?)(?: · .*| \(.*\))?$/;

/** Collects shown lines and ranges from DATA lines. */
export class CitableBuilder {
  private readonly shown = new Map<RepoPath, Set<number>>();
  private readonly given = new Map<RepoPath, [number, number][]>();

  /** Feed the lines of one DATA section (or the repo pack). */
  add(lines: readonly string[]): this {
    let file: RepoPath | null = null;
    for (const line of lines) {
      if (line.startsWith("=== ")) {
        file = HEADER_PATH_RE.exec(line)?.[1] ?? null;
        continue;
      }
      const num = /^(\d+)\|/.exec(line);
      if (num) {
        if (file) this.mark(file, Number(num[1]));
        continue;
      }
      if (!line.startsWith("> ")) continue;
      for (const m of line.matchAll(LOCATION_RE)) {
        const path = m[1] as string;
        const a = Number(m[2]);
        if (m[3] === undefined) this.mark(path, a);
        else {
          const list = this.given.get(path) ?? [];
          list.push([a, Number(m[3])]);
          this.given.set(path, list);
        }
      }
    }
    return this;
  }

  private mark(path: RepoPath, line: number): void {
    const set = this.shown.get(path) ?? new Set<number>();
    set.add(line);
    this.shown.set(path, set);
  }

  /** Paths with any shown line or given cite. */
  paths(): RepoPath[] {
    return [...new Set([...this.shown.keys(), ...this.given.keys()])].sort();
  }

  /** Build the CitableSet. */
  build(index: ContextIndex): CitableSet {
    const shown = this.shown;
    const given = this.given;
    const symbolCache = new Map<RepoPath, readonly { start: number; end: number }[]>();
    return {
      lines: (path) => (shown.has(path) || given.has(path) ? index.fileLines(path) : null),
      allows(path, start, end) {
        if ((given.get(path) ?? []).some(([a, b]) => a === start && b === end)) return true;
        const lines = shown.get(path);
        if (!lines) return false;
        let syms = symbolCache.get(path);
        if (!syms) {
          syms = index.symbolRanges(path).filter((s) => lines.has(s.start));
          symbolCache.set(path, syms);
        }
        const covered = (x: number) => lines.has(x) || (syms as readonly { start: number; end: number }[]).some((s) => s.start <= x && x <= s.end);
        let s = start;
        let e = end;
        while (s <= e && s - start < 2 && !covered(s)) s++;
        while (e >= s && end - e < 2 && !covered(e)) e--;
        if (s > e || !covered(s) || !covered(e)) return false;
        // short unseen runs between shown lines (blank lines, doc comments between two shown symbols, an elided
        // statement) do not make a range ungrounded; a long elided body does
        let run = 0;
        for (let x = s; x <= e; x++) {
          if (covered(x)) run = 0;
          else if (++run > CITE_GAP_LINES) return false;
        }
        return true;
      },
    };
  }
}

const EXISTING_RE = /^> (b_[0-9a-hjkmnp-tv-z]{8}) aspect=(\S+) kind=(\S+) depth=\S+ stale=(yes|no) lock=(human|-) claims=(\d+)/;

/** Parse EXISTING lines back into refs. */
export function parseExisting(lines: readonly string[]): Map<BlockId, ExistingRef> {
  const out = new Map<BlockId, ExistingRef>();
  for (const l of lines) {
    const m = EXISTING_RE.exec(l);
    if (!m) continue;
    const id = m[1] as BlockId;
    const ref: ExistingRef = { id, kind: m[3] as BlockKind, origin: m[5] === "human" ? "human" : "ai", stale: m[4] === "yes", claims: Number(m[6]) };
    if (m[2] !== "-") ref.aspect = m[2] as BlockAspect;
    if (m[5] === "human") ref.lock = "human-edited";
    out.set(id, ref);
  }
  return out;
}

const BLOCK_RE = /^> block (b_[0-9a-hjkmnp-tv-z]{8}) kind=(\S+)(?: depth=\S+)?(?: aspect=(\S+))?(?: claims=(\d+))?/;

/**
 * Blocks a patch prompt may answer for (doc.* `BLOCKS`, gen.deepdive `TOPIC`): header lines
 * `> block <id> kind=<k> [depth=<d>] [aspect=<a>] [claims=<n>]`.
 */
export function parseBlocks(lines: readonly string[]): Map<BlockId, ExistingRef> {
  const out = new Map<BlockId, ExistingRef>();
  for (const l of lines) {
    const m = BLOCK_RE.exec(l);
    if (!m) continue;
    const id = m[1] as BlockId;
    const ref: ExistingRef = { id, kind: m[2] as BlockKind, origin: "ai", stale: false, claims: Number(m[4] ?? 0) };
    if (m[3] && m[3] !== "-") ref.aspect = m[3] as BlockAspect;
    out.set(id, ref);
  }
  return out;
}

/** Where a task's answerable blocks are listed: EXISTING (gen.* regeneration), BLOCKS (doc.*), TOPIC (deep dive). */
function existingOf(prompt: GenPromptId, sections: ReadonlyMap<string, readonly string[]>): Map<BlockId, ExistingRef> {
  if (prompt === "gen.deepdive") return parseBlocks(sections.get("TOPIC") ?? []);
  if (GEN_PROMPTS[prompt].form === "patch") return parseBlocks(sections.get("BLOCKS") ?? []);
  return parseExisting(sections.get("EXISTING") ?? []);
}

const MODULE_ID_RE = /md_[0-9a-hjkmnp-tv-z]{8}/g;

/** Flow limits from the SEEDS section: min(3, seeds) … min(5, seeds). */
export function flowLimits(seeds: number): { min: number; max: number } {
  return { min: Math.min(3, seeds), max: Math.min(5, seeds) };
}

/** Build the ValidationContext of a task from its prepared DATA sections. */
export function buildContext(
  task: PlannedTask,
  sections: ReadonlyMap<string, readonly string[]>,
  lang: DocLang,
  index: ContextIndex,
  extraCitable: readonly (readonly string[])[] = [],
): ValidationContext {
  const spec = GEN_PROMPTS[task.prompt];
  const citable = new CitableBuilder();
  for (const lines of sections.values()) citable.add(lines);
  for (const lines of extraCitable) citable.add(lines);
  let modules: Set<ModuleId>;
  if (task.prompt === "gen.module" || task.prompt === "gen.parent") modules = new Set([task.target.id as ModuleId]);
  else if (task.prompt === "gen.labels") {
    modules = new Set();
    for (const l of sections.get("MODULES") ?? []) {
      const m = /^> (md_[0-9a-hjkmnp-tv-z]{8})\b/.exec(l);
      if (m) modules.add(m[1] as ModuleId);
    }
  } else {
    modules = new Set();
    for (const lines of sections.values()) for (const l of lines) for (const m of l.matchAll(MODULE_ID_RE)) modules.add(m[0] as ModuleId);
  }
  const seeds = (sections.get("SEEDS") ?? []).filter((l) => /^> seed\d+ /.test(l)).length;
  const s6 = task.target.kind === "parent" ? "parent" : "leaf";
  const taskSections = task.sections.length > 0 ? task.sections : (["s0"] as SectionId[]);
  return {
    prompt: task.prompt,
    form: lineForm(task.prompt),
    lang,
    lineTypes: spec.lineTypes,
    primarySection: taskSections[0] as SectionId,
    sections: taskSections,
    aspectsOf: (s) => sectionAspects(s, s6),
    existing: existingOf(task.prompt, sections),
    modules,
    citable: citable.build(index),
    flows: task.prompt === "gen.flows" ? flowLimits(seeds) : { min: 0, max: 0 },
    requiredAspects: spec.requiredAspects,
    moduleLineRequired: task.prompt === "gen.module" || task.prompt === "gen.parent",
  };
}
