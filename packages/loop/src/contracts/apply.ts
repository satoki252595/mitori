import type { AnchorEngine } from "@mitori/anchor";
import type { Hasher, PatchEdit, RepoPath } from "@mitori/core";
import type { ApplyEditsInput, ApplyEditsResult } from "../contract.ts";
import { CONTRACT_LIMITS } from "../contract.ts";
import { pathMatcher } from "../router/deny.ts";
import { newTextLines, normLine, type Segment, segments, snippetText } from "./text.ts";

type Problem = ApplyEditsResult["problems"][number];
type Edit = ApplyEditsInput["edits"][number];

/** An edit resolved against the current text of its file. `insert` ⇒ `end = start - 1`. */
interface Resolved {
  index: number;
  edit: Edit;
  kind: "replace" | "insert";
  start: number;
  end: number;
  delta: number;
}

const isReplace = (e: Edit): boolean => e.end !== undefined && e.end >= e.start;

/**
 * Pure text-level patch application (spec §5.2 steps 1–6): all-or-nothing. Every problem found is reported (the
 * repair turn quotes them), but `files` is non-empty only when there are none. The git layer writes the files.
 */
export function applyEdits(input: ApplyEditsInput, anchors: Pick<AnchorEngine, "lineMap">, hasher: Hasher): ApplyEditsResult {
  const problems: Problem[] = [];
  const problem = (edit: number, code: Problem["code"], message: string) => problems.push({ edit, code, message });
  const denied = pathMatcher(input.deny);
  const inScope = new Set<RepoPath>(input.writeScope);

  // 1. scope, deny, existence, base — per edit.
  const byFile = new Map<RepoPath, number[]>();
  const refuse = (e: Edit, i: number): [Problem["code"], string] | null => {
    if (!inScope.has(e.path)) return ["E_SCOPE_VIOLATION", `edit ${i}: ${e.path} is not in the write scope`];
    if (denied(e.path)) return ["E_DENY_GLOB", `edit ${i}: ${e.path} matches a deny glob`];
    if (input.current[e.path] === undefined) return ["E_PATCH_APPLY", `edit ${i}: ${e.path} does not exist (patch mode never creates files)`];
    if (!Number.isInteger(e.start) || e.start < 1 || (e.end !== undefined && !Number.isInteger(e.end))) {
      return ["E_PATCH_RANGE", `edit ${i}: start/end must be positive integers`];
    }
    const bundled = input.bundleText[e.path];
    if (e.base !== undefined && bundled && !bundled.blob.startsWith(e.base)) {
      return ["E_PATCH_RANGE", `edit ${i}: base ${e.base} is not the blob ${bundled.blob.slice(0, 7)} that ${e.path} was shown with`];
    }
    return null;
  };
  for (const [i, e] of input.edits.entries()) {
    const bad = refuse(e, i);
    if (bad) {
      problem(i, bad[0], bad[1]);
      continue;
    }
    const list = byFile.get(e.path) ?? [];
    list.push(i);
    byFile.set(e.path, list);
  }

  // 2–3. coordinates: map bundle → current text when the file changed, then first_line check with the ±3 search.
  const resolved = new Map<RepoPath, Resolved[]>();
  const sources = new Map<RepoPath, Segment[]>();
  for (const [path, indexes] of byFile) {
    const cur = segments(input.current[path] as string);
    sources.set(path, cur);
    const curLines = cur.map((s) => s.text);
    const bundled = input.bundleText[path];
    const map = bundled && input.currentBlob[path] !== bundled.blob ? anchors.lineMap(bundled.text, input.current[path] as string) : null;
    const frameLines = bundled && map ? segments(bundled.text).length : curLines.length;
    const list: Resolved[] = [];
    for (const i of indexes) {
      const edit = input.edits[i] as Edit;
      const r = resolveOne(i, edit, curLines, frameLines, map, problem);
      if (r) list.push(r);
    }
    resolved.set(path, list);
  }

  // 5. overlaps (per file).
  for (const list of resolved.values()) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const x = list[a] as Resolved;
        const y = list[b] as Resolved;
        if (conflicts(x, y))
          problem(
            Math.max(x.index, y.index),
            "E_PATCH_APPLY",
            `edit ${Math.max(x.index, y.index)}: overlaps edit ${Math.min(x.index, y.index)} in ${x.edit.path}`,
          );
      }
    }
  }

  if (problems.length > 0 || input.edits.length === 0) {
    problems.sort((p, q) => p.edit - q.edit);
    return { ok: problems.length === 0, files: {}, stamped: [], shifted: [], problems };
  }

  // 4 + 6. stamp `expect`, then apply bottom-up.
  const files: Record<RepoPath, string> = {};
  const stamped: PatchEdit[] = new Array(input.edits.length);
  const shifted: { edit: number; delta: number }[] = [];
  for (const [path, list] of resolved) {
    const cur = sources.get(path) as Segment[];
    const curLines = cur.map((s) => s.text);
    for (const r of list) {
      const expect = hasher.xxh3(r.kind === "replace" ? snippetText(curLines, r.start, r.end) : "");
      const out: PatchEdit = { path, start: r.start, newText: r.edit.newText, expect, firstLine: r.edit.firstLine };
      if (r.kind === "replace") out.end = r.end;
      if (r.edit.base !== undefined) out.base = r.edit.base;
      stamped[r.index] = out;
      if (r.delta !== 0) shifted.push({ edit: r.index, delta: r.delta });
    }
    files[path] = render(cur, list);
  }
  shifted.sort((p, q) => p.edit - q.edit);
  return { ok: true, files, stamped, shifted, problems };
}

function resolveOne(
  index: number,
  edit: Edit,
  curLines: readonly string[],
  frameLines: number,
  map: ReturnType<AnchorEngine["lineMap"]> | null,
  problem: (edit: number, code: Problem["code"], message: string) => void,
): Resolved | null {
  const replace = isReplace(edit);
  const count = curLines.length;
  const range = (message: string) => {
    problem(index, "E_PATCH_RANGE", `edit ${index}: ${message}`);
    return null;
  };
  let start = edit.start;
  let end = replace ? (edit.end as number) : start - 1;

  if (replace ? end > frameLines : start > frameLines + 1)
    return range(`${replace ? `lines ${start}-${end}` : `insert point ${start}`} is outside ${edit.path} (${frameLines} lines)`);

  if (map) {
    // The file changed since the bundle: the edited lines must still exist, unchanged and contiguous.
    if (replace) {
      const s = map.map(start);
      const e = map.map(end);
      if (s === null || e === null || e - s !== end - start) return range(`lines ${start}-${end} of ${edit.path} changed since they were shown`);
      for (let l = start; l <= end; l++) if (map.map(l) === null) return range(`lines ${start}-${end} of ${edit.path} changed since they were shown`);
      start = s;
      end = e;
    } else if (start <= frameLines) {
      const s = map.map(start);
      if (s === null) return range(`insert point ${start} of ${edit.path} changed since it was shown`);
      start = s;
      end = s - 1;
    } else {
      const last = frameLines === 0 ? 0 : map.map(frameLines);
      if (last === null) return range(`end of ${edit.path} changed since it was shown`);
      start = last + 1;
      end = last;
    }
  }

  if (replace ? end > count : start > count + 1)
    return range(`${replace ? `lines ${start}-${end}` : `insert point ${start}`} is outside ${edit.path} (${count} lines)`);

  let delta = 0;
  if (replace && normLine(curLines[start - 1] as string) !== normLine(edit.firstLine)) {
    const len = end - start + 1;
    const hits: number[] = [];
    for (const d of CONTRACT_LIMITS.firstLineShifts) {
      const s = start + d;
      if (s < 1 || s + len - 1 > count) continue;
      if (normLine(curLines[s - 1] as string) === normLine(edit.firstLine)) hits.push(d);
    }
    if (hits.length !== 1) {
      return range(
        hits.length === 0
          ? `first_line does not match line ${start} of ${edit.path} (found "${clip(curLines[start - 1] as string)}")`
          : `first_line matches ${hits.length} nearby lines of ${edit.path}; cannot tell which one was meant`,
      );
    }
    delta = hits[0] as number;
    start += delta;
    end += delta;
  }
  return { index, edit, kind: replace ? "replace" : "insert", start, end, delta };
}

function conflicts(a: Resolved, b: Resolved): boolean {
  if (a.kind === "replace" && b.kind === "replace") return a.start <= b.end && b.start <= a.end;
  if (a.kind === "insert" && b.kind === "insert") return false;
  const [ins, rep] = a.kind === "insert" ? [a, b] : [b, a];
  return rep.start < ins.start && ins.start <= rep.end;
}

/** Apply the resolved edits to the segments, bottom-up; untouched lines keep their own line endings. */
function render(cur: readonly Segment[], list: readonly Resolved[]): string {
  const eol = dominantEol(cur);
  const endedWithEol = cur.length === 0 || (cur[cur.length - 1] as Segment).eol !== "";

  // One operation per position: inserts at the same point concatenate in output order, ahead of a replacement that starts there.
  const ops = new Map<number, { remove: number; add: Segment[] }>();
  const at = (pos: number) => {
    const have = ops.get(pos);
    if (have) return have;
    const fresh: { remove: number; add: Segment[] } = { remove: 0, add: [] };
    ops.set(pos, fresh);
    return fresh;
  };
  const sorted = [...list].sort((a, b) => a.index - b.index);
  for (const r of sorted) if (r.kind === "insert") at(r.start).add.push(...toSegments(r.edit.newText, eol));
  for (const r of sorted) {
    if (r.kind !== "replace") continue;
    const op = at(r.start);
    op.remove = r.end - r.start + 1;
    op.add.push(...toSegments(r.edit.newText, eol));
  }

  const out = [...cur];
  for (const pos of [...ops.keys()].sort((a, b) => b - a)) {
    const op = ops.get(pos) as { remove: number; add: Segment[] };
    out.splice(pos - 1, op.remove, ...op.add);
  }
  // The file's final-newline state is preserved: lines that became interior need a terminator, the last one follows the original.
  for (let i = 0; i < out.length - 1; i++) if ((out[i] as Segment).eol === "") out[i] = { text: (out[i] as Segment).text, eol };
  if (out.length > 0) {
    const last = out[out.length - 1] as Segment;
    out[out.length - 1] = { text: last.text, eol: endedWithEol ? (last.eol === "" ? eol : last.eol) : "" };
  }
  let text = "";
  for (const s of out) text += s.text + s.eol;
  return text;
}

function toSegments(newText: string, eol: string): Segment[] {
  return newTextLines(newText).map((text) => ({ text, eol }));
}

/** CRLF when CRLF terminators outnumber the others; LF otherwise (including files without any newline). */
function dominantEol(cur: readonly Segment[]): string {
  let crlf = 0;
  let other = 0;
  for (const s of cur) {
    if (s.eol === "\r\n") crlf++;
    else if (s.eol !== "") other++;
  }
  return crlf > other ? "\r\n" : "\n";
}

function clip(line: string): string {
  const t = line.trim();
  return t.length > 60 ? `${t.slice(0, 60)}…` : t;
}
