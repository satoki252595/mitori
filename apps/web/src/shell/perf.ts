/**
 * Performance marks (contract `UI_PERF_MARKS`, ux.md §12.12) — emitted in every build; e2e budgets read them.
 * `markAfterPaint` issues the mark in the next animation frame (= right after the DOM change was painted).
 */
import type { UI_PERF_MARKS } from "../contract.ts";

export type PerfMark = (typeof UI_PERF_MARKS)[number];

export function mark(name: PerfMark, detail?: Record<string, unknown>): void {
  try {
    performance.mark(name, detail === undefined ? undefined : { detail });
  } catch {
    /* marks are best-effort */
  }
}

export function markAfterPaint(name: PerfMark, detail?: Record<string, unknown>): void {
  if (typeof requestAnimationFrame === "undefined") {
    mark(name, detail);
    return;
  }
  requestAnimationFrame(() => mark(name, detail));
}

/** Timestamp of the user input that triggered the current work (event `timeStamp`), carried as `detail.trigger`. */
let lastTrigger: number | null = null;

export function noteTrigger(e: { timeStamp: number } | null): void {
  lastTrigger = e ? e.timeStamp : null;
}

export function takeTrigger(): number | undefined {
  const t = lastTrigger;
  lastTrigger = null;
  return t ?? undefined;
}
