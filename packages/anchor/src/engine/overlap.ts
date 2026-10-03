/** Overlap of an old range with hunks (loop spec §1.7). */
import type { LineNo } from "@mitori/core";
import type { LineHunk } from "../contract.ts";

/** Replace/delete hunks intersect `[start, end]`; a pure insert counts only strictly inside (`start ≤ oldStart < end`). */
export function overlaps(start: LineNo, end: LineNo, hunks: readonly LineHunk[]): boolean {
  for (const h of hunks) {
    if (h.oldLines > 0) {
      if (h.oldStart <= end && h.oldStart + h.oldLines - 1 >= start) return true;
    } else if (start <= h.oldStart && h.oldStart < end) return true;
  }
  return false;
}
