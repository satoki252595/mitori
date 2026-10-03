import type { AnchorEngine, LineHunk, LineMap, LineRun } from "@mitori/anchor";
import type { Hasher } from "@mitori/core";

// Test-only fakes for WP-08a (the shared ones are still M0 stubs): a Hasher over Bun, and a small LCS-based
// `lineMap` with the same observable `map()` behaviour as the anchor engine (equal-mapped lines only).

const normLine = (l: string): string => l.replace(/\s+/gu, " ").trim();

function lines(text: string): string[] {
  if (text === "") return [];
  const out = text.split(/\r\n|\r|\n/u);
  if (out[out.length - 1] === "") out.pop();
  return out;
}

export const hasher: Hasher = {
  xxh3: (data) =>
    BigInt.asUintN(64, Bun.hash.xxHash3(data) as unknown as bigint)
      .toString(16)
      .padStart(16, "0"),
  sha256: (data) => new Bun.CryptoHasher("sha256").update(data).digest("hex"),
  gitBlob: (data, algo) => {
    const head = new TextEncoder().encode(`blob ${data.length}\0`);
    const all = new Uint8Array(head.length + data.length);
    all.set(head);
    all.set(data, head.length);
    return new Bun.CryptoHasher(algo).update(all).digest("hex");
  },
};

/** Blob id of a text, as git would compute it (sha1). */
export const blobOf = (text: string): string => hasher.gitBlob(new TextEncoder().encode(text), "sha1");

export function fakeLineMap(oldText: string, newText: string): LineMap {
  const a = lines(oldText).map(normLine);
  const b = lines(newText).map(normLine);
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const at = (r: number, c: number): number => dp[r]?.[c] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      (dp[i] as number[])[j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const forward = new Array<number | null>(n + 1).fill(null);
  const runs: LineRun[] = [];
  const hunks: LineHunk[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      forward[i + 1] = j + 1;
      const last = runs[runs.length - 1];
      if (last && last.oldStart + last.len === i + 1 && last.newStart + last.len === j + 1) last.len++;
      else runs.push({ oldStart: i + 1, newStart: j + 1, len: 1 });
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) i++;
    else j++;
  }
  return {
    map: (l) => forward[l] ?? null,
    exact: (l) => forward[l] !== null && forward[l] !== undefined,
    mapStart: (l) => forward[l] ?? 1,
    mapEnd: (l, s) => forward[l] ?? s,
    runs,
    hunks,
    d: n + m - 2 * (dp[0]?.[0] ?? 0),
    fallback: false,
    oldLines: n,
    newLines: m,
  };
}

export const fakeAnchors: Pick<AnchorEngine, "lineMap"> = { lineMap: fakeLineMap };
