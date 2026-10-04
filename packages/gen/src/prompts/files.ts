/**
 * `gen.deepdive` mode files — the S8 per-file notes of the complete effort (gen spec §3.2 table: "S8 file note (leaf
 * ごとに gen.deepdive mode=files。入力 ≤ 20k token で分割)", §5.2 FILES). A leaf's source files are packed in path order
 * into chunks of ≤ {@link FILES_CHUNK_TOKENS}; chunk k of a module is the task with mode `files` (k = 1) or `files#k`.
 * A file shows in full (`=== <path> · lines 1-<n>` + `N|` lines) up to {@link FILE_FULL_MAX_TOKENS}; a longer one
 * shows its doc-tier skeleton (declarations, doc comments, numbered) so its note still cites real lines.
 * Pure functions of the index: the planner and the input builder compute the same chunks.
 */
import type { GitOid, ModuleInfo, RepoPath } from "@mitori/core";
import type { Indexer } from "@mitori/indexer";

/** FILES tokens per task (§5.2 FILES budget). */
export const FILES_CHUNK_TOKENS = 20_000;
/** A file over this many tokens is shown as its doc skeleton instead of in full. */
export const FILE_FULL_MAX_TOKENS = 6_000;
/** Header / numbering overhead per file (tokens). */
const PER_FILE_OVERHEAD = 30;
/** `N|` prefixes add ~12–14 % to code tokens (CodeSlice.numbered). */
const NUMBERED_FACTOR = 1.14;

/** True for the files mode of gen.deepdive (`files`, `files#2`, …). */
export function isFilesMode(mode: string | undefined): boolean {
  return mode === "files" || (mode !== undefined && /^files#[1-9][0-9]*$/.test(mode));
}

/** The mode of chunk k (1-based). */
export function filesModeOf(k: number): string {
  return k <= 1 ? "files" : `files#${k}`;
}

/** Chunk index (1-based) of a files mode. */
export function filesChunkOf(mode: string | undefined): number {
  const m = /^files#([1-9][0-9]*)$/.exec(mode ?? "");
  return m ? Number(m[1]) : 1;
}

/** The base mode for GEN_PROMPTS lookups (`files#3` → `files`). */
export function baseMode(mode: string | undefined): string | undefined {
  return isFilesMode(mode) ? "files" : mode;
}

type FilesIndex = Pick<Indexer, "file">;

/** Tokens a file costs in FILES (full text numbered, or its skeleton capped at the full-text limit). */
export function fileCost(ix: Pick<Indexer, "file">, path: RepoPath): number {
  const est = ix.file(path)?.tokensEst ?? 0;
  return Math.min(Math.round(est * NUMBERED_FACTOR), FILE_FULL_MAX_TOKENS) + PER_FILE_OVERHEAD;
}

/** Source files of a leaf module (non-excluded), in path order. */
export function noteFiles(ix: FilesIndex, m: Pick<ModuleInfo, "paths">): RepoPath[] {
  return [...m.paths]
    .filter((p) => {
      const f = ix.file(p);
      return f !== null && !f.excluded && f.lines > 0;
    })
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The chunks of a leaf module's files (each ≤ FILES_CHUNK_TOKENS; a file never splits). */
export function fileChunks(ix: FilesIndex, m: Pick<ModuleInfo, "paths">): { paths: RepoPath[]; tokens: number }[] {
  const out: { paths: RepoPath[]; tokens: number }[] = [];
  let cur: RepoPath[] = [];
  let size = 0;
  for (const p of noteFiles(ix, m)) {
    const t = fileCost(ix, p);
    if (cur.length > 0 && size + t > FILES_CHUNK_TOKENS) {
      out.push({ paths: cur, tokens: size });
      cur = [];
      size = 0;
    }
    cur.push(p);
    size += t;
  }
  if (cur.length > 0) out.push({ paths: cur, tokens: size });
  return out;
}

/** FILES lines of one chunk, plus the blobs of the files shown with `N|` lines. */
export async function filesInput(
  ix: Pick<Indexer, "file" | "read" | "skeleton">,
  paths: readonly RepoPath[],
): Promise<{ lines: string[]; blobs: Map<RepoPath, GitOid> }> {
  const lines: string[] = [];
  const blobs = new Map<RepoPath, GitOid>();
  for (const p of paths) {
    const f = ix.file(p);
    if (!f || f.excluded || f.lines === 0) continue;
    if (Math.round(f.tokensEst * NUMBERED_FACTOR) <= FILE_FULL_MAX_TOKENS) {
      const slice = await ix.read(p, { start: 1, end: f.lines }, { numbered: true });
      lines.push(`=== ${p} · lines 1-${slice.end}`, ...slice.text.split("\n"));
      blobs.set(p, slice.blob);
    } else {
      const sk = ix.skeleton({ kind: "file", path: p }, "doc", "claude-v5");
      lines.push(`=== ${p} · skeleton of ${f.lines} lines`, ...sk.text.split("\n").filter((l) => !l.startsWith("=== ")));
      blobs.set(p, f.blob);
    }
  }
  return { lines, blobs };
}
