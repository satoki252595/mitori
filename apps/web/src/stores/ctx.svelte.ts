/**
 * Context column state machine (contract `ContextColumnStore`, ux.md §4.4 / JUDGEMENT §6.2): margin | code |
 * review, with the previous mode restored by Escape / `o` / accept / reject.
 */
import type { JobId } from "@mitori/core";
import { type CodePin, type ContextColumnStore, type CtxMode, UI_THRESHOLDS } from "../contract.ts";

export class CtxState implements ContextColumnStore {
  mode = $state<CtxMode>("margin");
  prev = $state<CtxMode | null>(null);
  pin = $state.raw<CodePin | null>(null);
  job = $state<JobId | null>(null);
  wide = $state(false);
  /** Code-mode width chosen with the separator (cookie `cw`). */
  codeWidth = $state<number>(560);
  /** Available code width from the layout (container − rail − 672). */
  codeRoom = $state<number>(560);
  marginWidth = $state<number>(368);

  get width(): number {
    if (this.mode === "review") return 640;
    if (this.mode === "code")
      return Math.max(
        UI_THRESHOLDS.ctxCodeMinPx,
        Math.min(UI_THRESHOLDS.ctxCodeMaxPx, Math.min(this.codeWidth, Math.max(UI_THRESHOLDS.ctxCodeMinPx, this.codeRoom))),
      );
    return this.marginWidth;
  }

  set(mode: CtxMode, opts: { pin?: CodePin; job?: JobId } = {}): void {
    if (mode !== this.mode) this.prev = this.mode;
    this.mode = mode;
    this.pin = mode === "code" ? (opts.pin ?? null) : null;
    this.job = mode === "review" ? (opts.job ?? this.job) : null;
    if (mode !== "review") this.wide = false;
  }

  back(): void {
    const to = this.prev ?? "margin";
    this.prev = null;
    this.mode = to === this.mode ? "margin" : to;
    this.pin = null;
    this.wide = false;
  }

  /** Default for a level when opening S2 (`code` for expert, else margin); never while reviewing or pinned. */
  defaultFor(level: "newcomer" | "standard" | "expert"): void {
    if (this.mode === "review" || this.pin) return;
    this.mode = level === "expert" ? "code" : "margin";
    this.prev = null;
  }

  /** Separator keys: ±24 px within the clamp (WCAG 2.5.7). */
  nudge(dir: -1 | 1): number {
    this.codeWidth = Math.max(UI_THRESHOLDS.ctxCodeMinPx, Math.min(UI_THRESHOLDS.ctxCodeMaxPx, this.codeWidth + dir * 24));
    return this.codeWidth;
  }
}
