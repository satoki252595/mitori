/**
 * Undo model (ux.md §6.7, contract `UndoTarget`): ONE reversible action at a time, shown as the 10 s undo toast and
 * reachable with ⌘Z while that toast lives (`undo.last` when `undoAvailable`).
 *  - accept → checkpoint undo (`POST /checkpoints/:ck/undo`; diverged files ⇒ the force dialog);
 *  - reject / discard draft → DEFERRED: the UI hides it now, the API call happens when the toast is gone (or on
 *    `pagehide` / leaving the workspace), so undo is local and costs nothing;
 *  - doc edit (apply doc) → re-save the previous Markdown.
 * A newer reversible action replaces the toast, so the older deferred one is committed at that moment.
 */
import { type BlockId, type BlockView, type CheckpointId, type JobId, MitoriError, type ThreadId, type UndoRes, type WorkspaceKey } from "@mitori/core";
import { UI_THRESHOLDS, type UndoTarget } from "../contract.ts";
import { errorText } from "../shell/index.ts";
import { markAfterPaint } from "../shell/perf.ts";
import type { Stores } from "../stores/app.svelte.ts";

export const UNDO_TOAST = "loop.undo";

interface Deferred {
  target: UndoTarget;
  commit: () => Promise<unknown>;
}

export class UndoManager {
  /** Live reversible action (null once its toast is gone). */
  last = $state.raw<UndoTarget | null>(null);
  /** Undo refused: files changed after accept (the force dialog of §6.7). */
  diverged = $state.raw<{ ck: CheckpointId; job: JobId; files: string[] } | null>(null);
  /** Drafts being discarded (hidden until the deferred DELETE runs). */
  discarding = $state.raw<ReadonlySet<ThreadId>>(new Set());
  #deferred: Deferred | null = null;
  #docPrev = new Map<BlockId, { md: string }>();
  readonly #s: Stores;
  /** Called after an undo restored the previous state (re-fetch what the loop shows). */
  onUndone: (t: UndoTarget) => void = () => {};

  constructor(s: Stores) {
    this.#s = s;
  }

  #ws(): WorkspaceKey | null {
    return this.#s.workspace.key;
  }

  /** Show the undo toast for `target` (the previous deferred action is committed first). */
  #offer(target: UndoTarget, key: string, params: Record<string, string | number>): void {
    void this.flush();
    this.last = target;
    this.#s.bottom.toast({
      id: UNDO_TOAST,
      kind: "undo",
      key,
      params,
      action: { key: "review.action.undo", kbd: "Mod+Z", run: () => void this.undo() },
    });
  }

  /** Accepted into the working tree: the checkpoint is the undo point. */
  accepted(job: JobId, ck: CheckpointId, key: string, params: Record<string, string | number>): void {
    this.#offer({ kind: "checkpoint", ck, job }, key, params);
    this.#watch(null);
  }

  /** ⌘⌫ / 却下: hidden now, `POST /jobs/:job/reject` once the toast is gone. */
  rejectLater(job: JobId, params: Record<string, string | number>): void {
    const ws = this.#ws();
    if (!ws) return;
    this.#offer({ kind: "reject", job }, "review.toast.rejected", params);
    this.#s.review.pendingRejects.set(job, Date.now() + 10_000);
    this.#watch({
      target: { kind: "reject", job },
      commit: async () => {
        const j = await this.#s.api.call("POST /ws/:ws/jobs/:job/reject", { params: { ws, job }, body: {} });
        this.#s.review.jobs.set(j.id, j);
      },
    });
  }

  /** Discard a draft: hidden now, `DELETE /threads/:th` once the toast is gone. */
  discardLater(th: ThreadId): void {
    const ws = this.#ws();
    if (!ws) return;
    this.#offer({ kind: "discardDraft", th }, "threads.toast.discarded", {});
    this.discarding = new Set([...this.discarding, th]);
    this.#watch({ target: { kind: "discardDraft", th }, commit: () => this.#s.api.call("DELETE /ws/:ws/threads/:th", { params: { ws, th } }) });
  }

  /** A doc edit was saved: keep the previous Markdown for undo. */
  docEdited(block: BlockId, rev: number, prevMd: string): void {
    this.#docPrev.set(block, { md: prevMd });
    this.#offer({ kind: "docEdit", block, rev }, "proposals.toast.docEdited", {});
    this.#watch(null);
  }

  /**
   * Arm the end of the undo window: when the toast is gone (it may be paused while hovered / focused), the
   * deferred action — if any — is committed and ⌘Z no longer applies.
   */
  #watch(d: Deferred | null): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#deferred = d;
    const target = this.last;
    const tick = () => {
      if (this.last === target && this.#s.bottom.has(UNDO_TOAST)) {
        this.#timer = setTimeout(tick, 500);
        return;
      }
      this.#timer = null;
      if (this.last === target) this.last = null;
      if (d && this.#deferred === d) void this.#commit(d);
    };
    this.#timer = setTimeout(tick, UI_THRESHOLDS.undoToastMs);
  }
  #timer: ReturnType<typeof setTimeout> | null = null;

  async #commit(d: Deferred): Promise<void> {
    if (this.#deferred === d) this.#deferred = null;
    if (this.last && sameTarget(this.last, d.target)) this.last = null;
    try {
      await d.commit();
    } catch (err) {
      this.#s.bottom.toast({
        id: "loop.undo.commit",
        kind: "error",
        key: "review.toast.commitFailed",
        params: { error: errorText(MitoriError.from(err).toData()) },
      });
    } finally {
      if (d.target.kind === "reject") this.#s.review.pendingRejects.delete(d.target.job);
      if (d.target.kind === "discardDraft") {
        const th = d.target.th;
        this.discarding = new Set([...this.discarding].filter((x) => x !== th));
        this.#s.review.threads.delete(th);
      }
    }
  }

  /** Commit the pending deferred action now (`pagehide`, workspace switch, a newer undo toast). */
  flush(): Promise<void> {
    const d = this.#deferred;
    return d ? this.#commit(d) : Promise.resolve();
  }

  /** ⌘Z / the toast button. */
  async undo(force = false): Promise<void> {
    const t = this.last;
    const ws = this.#ws();
    if (!t || !ws) return;
    this.#s.bottom.dismiss(UNDO_TOAST);
    this.last = null;
    try {
      if (t.kind === "reject" || t.kind === "discardDraft") {
        if (this.#timer) clearTimeout(this.#timer);
        this.#timer = null;
        this.#deferred = null;
        if (t.kind === "reject") this.#s.review.pendingRejects.delete(t.job);
        else this.discarding = new Set([...this.discarding].filter((x) => x !== t.th));
      } else if (t.kind === "checkpoint") {
        const res: UndoRes = await this.#s.api.call("POST /ws/:ws/checkpoints/:ck/undo", { params: { ws, ck: t.ck }, body: force ? { force: true } : {} });
        if (res.diverged.length > 0 && !force) {
          this.diverged = { ck: t.ck, job: t.job, files: res.diverged };
          this.last = t;
          return;
        }
        this.#s.bottom.toast({ id: "loop.undone", kind: "success", key: "review.toast.undone" });
      } else {
        const prev = this.#docPrev.get(t.block);
        const cur = this.#blockView(t.block);
        if (!prev || !cur) return;
        const res = await this.#s.api.call("POST /ws/:ws/doc/blocks/:block/edit", {
          params: { ws, block: t.block },
          body: { baseHash: cur.hash, md: prev.md, mdForm: "file", apply: "doc", confirmDrop: true },
        });
        if (res.block) this.#s.doc.upsertBlock(res.block);
        this.#docPrev.delete(t.block);
        this.#s.bottom.toast({ id: "loop.undone", kind: "success", key: "review.toast.undone" });
      }
      markAfterPaint("mitori:undo:applied");
      this.onUndone(t);
    } catch (err) {
      this.#s.bottom.toast({
        id: "loop.undo.failed",
        kind: "error",
        key: "review.toast.undoFailed",
        params: { error: errorText(MitoriError.from(err).toData()) },
      });
    }
  }

  /** The diverged dialog's 「それでも戻す」. */
  forceUndo(): Promise<void> {
    this.diverged = null;
    return this.undo(true);
  }

  keepDiverged(): void {
    this.diverged = null;
    this.last = null;
  }

  #blockView(id: BlockId): BlockView | null {
    const sec = this.#s.doc.index?.blockSection.get(id);
    const page = sec ? (this.#s.doc.index?.pageOf.get(sec) ?? sec) : null;
    for (const s of [sec, page]) {
      const b = s ? this.#s.doc.section(s)?.blocks.find((x) => x.id === id) : undefined;
      if (b) return b;
    }
    return null;
  }
}

function sameTarget(a: UndoTarget, b: UndoTarget): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "reject" && b.kind === "reject") return a.job === b.job;
  if (a.kind === "discardDraft" && b.kind === "discardDraft") return a.th === b.th;
  return a === b;
}
