import { describe, expect, test } from "bun:test";
import type { CodeSlice, FileEntry, GitOid, RepoPath } from "@mitori/core";
import type { Indexer, Skeleton } from "@mitori/indexer";
import { CitableBuilder } from "./context.ts";
import {
  baseMode,
  FILE_FULL_MAX_TOKENS,
  FILES_CHUNK_TOKENS,
  fileChunks,
  fileCost,
  filesChunkOf,
  filesInput,
  filesModeOf,
  isFilesMode,
  noteFiles,
} from "./files.ts";

type Spec = { lines: number; tokens: number; excluded?: boolean };

/** The parts of the index the files mode reads: file entries, numbered reads and doc skeletons. */
function fakeIndex(files: Record<string, Spec>): Pick<Indexer, "file" | "read" | "skeleton"> {
  const entry = (p: string): FileEntry | null => {
    const s = files[p];
    if (!s) return null;
    return {
      path: p as RepoPath,
      blob: `blob-${p}` as GitOid,
      size: s.lines * 40,
      lang: "typescript",
      class: "source",
      ...(s.excluded ? { excluded: "generated" as const } : {}),
      lines: s.lines,
      loc: s.lines,
      tokensEst: s.tokens,
    } as FileEntry;
  };
  return {
    file: (p) => entry(p),
    read: async (p, range): Promise<CodeSlice> => {
      const start = range?.start ?? 1;
      const end = range?.end ?? files[p]?.lines ?? 0;
      const text = Array.from({ length: end - start + 1 }, (_, i) => `${start + i}|line ${start + i} of ${p}`).join("\n");
      return { path: p, blob: `blob-${p}` as GitOid, start, end, text, numbered: true, tokens: 10, redactions: 0 };
    },
    skeleton: (target) => {
      const p = (target as { path: RepoPath }).path;
      const text = `=== ${p}\n1|export class Big {\n40|  run(): void\n`;
      return { tier: "doc", text, tokens: 20, files: [p], omitted: [], perFile: [], redactions: 0, key: "k" } as unknown as Skeleton;
    },
  };
}

describe("GEN-M4-03 complete effort: per-file note modes and chunks (§3.2, §5.6.12)", () => {
  test("mode names: files, files#k; the base mode looks the spec up", () => {
    expect([filesModeOf(1), filesModeOf(2), filesModeOf(0)]).toEqual(["files", "files#2", "files"]);
    expect(["files", "files#2", "files#10"].map(isFilesMode)).toEqual([true, true, true]);
    expect([undefined, "topic", "files#", "files#0", "files#x", "filesx"].map(isFilesMode)).toEqual([false, false, false, false, false, false]);
    expect([filesChunkOf("files"), filesChunkOf("files#3"), filesChunkOf(undefined)]).toEqual([1, 3, 1]);
    expect([baseMode("files#4"), baseMode("files"), baseMode("complete"), baseMode(undefined)]).toEqual(["files", "files", "complete", undefined]);
  });

  test("chunks: path order, excluded / empty files skipped, a file never splits, each chunk ≤ the FILES budget", () => {
    const files: Record<string, Spec> = {
      "src/b.ts": { lines: 300, tokens: 9000 }, // over the full-text limit: costs the skeleton cap
      "src/a.ts": { lines: 100, tokens: 4000 },
      "src/c.ts": { lines: 120, tokens: 5200 },
      "src/gen.ts": { lines: 50, tokens: 2000, excluded: true },
      "src/empty.ts": { lines: 0, tokens: 0 },
      "src/d.ts": { lines: 200, tokens: 5000 },
    };
    const ix = fakeIndex(files);
    const m = { paths: Object.keys(files) as RepoPath[] };
    expect(noteFiles(ix, m)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"]);
    expect(fileCost(ix, "src/b.ts" as RepoPath)).toBe(FILE_FULL_MAX_TOKENS + 30);
    expect(fileCost(ix, "src/a.ts" as RepoPath)).toBe(Math.round(4000 * 1.14) + 30);
    const chunks = fileChunks(ix, m);
    expect(chunks.map((c) => c.paths)).toEqual([["src/a.ts", "src/b.ts", "src/c.ts"], ["src/d.ts"]]);
    for (const c of chunks) expect(c.tokens).toBeLessThanOrEqual(FILES_CHUNK_TOKENS);
    expect(chunks.flatMap((c) => c.paths).sort()).toEqual(noteFiles(ix, m));
    // the same index gives the same chunks (planner and input builder agree)
    expect(fileChunks(ix, m)).toEqual(chunks);
  });

  test("FILES: a small file in full with N| lines, a large one as its skeleton under a header the citable set reads", async () => {
    const ix = fakeIndex({ "src/a.ts": { lines: 3, tokens: 30 }, "src/big.ts": { lines: 900, tokens: 9000 } });
    const { lines, blobs } = await filesInput(ix, ["src/a.ts", "src/big.ts"] as RepoPath[]);
    expect(lines).toEqual([
      "=== src/a.ts · lines 1-3",
      "1|line 1 of src/a.ts",
      "2|line 2 of src/a.ts",
      "3|line 3 of src/a.ts",
      "=== src/big.ts · skeleton of 900 lines",
      "1|export class Big {",
      "40|  run(): void",
      "",
    ]);
    expect([...blobs.keys()]).toEqual(["src/a.ts", "src/big.ts"]);
    const citable = new CitableBuilder().add(lines).build({ fileLines: (p) => (p === "src/big.ts" ? 900 : 3), symbolRanges: () => [] });
    expect(citable.allows("src/a.ts", 2, 3)).toBe(true);
    expect(citable.allows("src/big.ts", 40, 40)).toBe(true);
    expect(citable.allows("src/big.ts", 500, 500)).toBe(false);
  });
});
