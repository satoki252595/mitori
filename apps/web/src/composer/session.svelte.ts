/**
 * One open Composer (contract `ComposerState`, ux.md §5.2 / §6.2 R1). The draft thread is created LAZILY on the
 * first input or chip change (UXP-22: closing an untouched Composer creates nothing); afterwards the body is saved
 * 500 ms after typing stops (`PATCH /threads/:th`, or this browser's storage when the daemon is unreachable) and the
 * estimate is refreshed 300 ms after a change (`POST /jobs/estimate`), while chips and the router are predicted in
 * the same frame (`predict`). Submitting hands the session to the loop (optimistic card, ux.md §6.4).
 */
import {
  type AnchorInput,
  type BlockId,
  DEFAULT_LIMITS,
  type EstimateItem,
  INTENT_JOB_KIND,
  type JobEstimate,
  MitoriError,
  type ModelId,
  type SectionId,
  type ThreadDetail,
  type ThreadId,
  type ThreadIntent,
} from "@mitori/core";
import { type ComposerChip, type ComposerState, type ExecPath, UI_THRESHOLDS } from "../contract.ts";
import { getJson, removeItem, STORAGE_KEYS, setJson } from "../shell/storage.ts";
import type { Stores } from "../stores/app.svelte.ts";
import { answerIntent, contextAdjust, mergeChips, type Prediction, predict } from "./predict.ts";

/** Where a Composer is anchored (built from the DOM selection, a focused block or a claim). */
export interface ComposerTarget {
  block: BlockId;
  section: SectionId;
  anchor: AnchorInput;
  /** Normalized block text (ANCHOR_TEXT_RULES) the offsets refer to. */
  text: string;
  /** Display quote: 18 chars around the selection. */
  quote: { before: string; mark: string; after: string };
  /** `story.go:633` — the first cite of the selection / block. */
  fileLine: string | null;
  /** Block hash at open time (doc edit 3-way base). */
  blockHash: string;
  /** Stable key of the anchor (offline drafts, intent memory). */
  key: string;
  /** Whole-block anchor (focused block or claim, not a text selection). */
  wholeBlock: boolean;
}

export type SaveState = "idle" | "saving" | "saved" | "offline";

const DEFAULT_MODEL: ModelId = "claude-sonnet-5-5";

export class ComposerSession {
  readonly tempKey = `tmp_${crypto.randomUUID()}`;
  readonly target: ComposerTarget;
  intent = $state<ThreadIntent>("note");
  body = $state("");
  draft = $state<ThreadId | null>(null);
  version = 0;
  /** The 2-way choice of `change` on a doc anchor (`ComposerState.target`). */
  fixTarget = $state<"code" | "doc">("code");
  docMd = $state<string | undefined>(undefined);
  /** Markdown the doc edit started from (3-way base, and the undo text). */
  docBase = $state.raw<{ md: string; hash: string } | null>(null);
  estimate = $state.raw<JobEstimate | undefined>(undefined);
  chips = $state.raw<ComposerChip[]>([]);
  readonly candidateKeys = new Set<string>();
  mentions = $state.raw<{ path: string; start: number; end: number; label: string }[]>([]);
  path = $state<ExecPath>("push");
  override = $state.raw<ComposerState["override"]>(undefined);
  stale = $state(false);
  save = $state<SaveState>("idle");
  /** The server estimate just replaced the prediction and differed (0.35 s accent frame). */
  flash = $state(false);
  /** 「詳細 ▸」 open at newcomer level. */
  details = $state(false);
  error = $state<string | null>(null);
  /** The estimate request is in flight. */
  estimating = $state(false);
  /** Doc edit: claims the edit would drop (「出典{n}件が外れます」, UXP-20). */
  dropped = $state.raw<{ claim: string; label: string }[] | null>(null);
  /** Doc edit: the block changed elsewhere (3-way: base / other / mine). */
  conflict = $state.raw<{ base: string; other: string; otherHash: string } | null>(null);
  readonly #s: Stores;
  #saveTimer: ReturnType<typeof setTimeout> | null = null;
  #estTimer: ReturnType<typeof setTimeout> | null = null;
  #creating: Promise<ThreadId | null> | null = null;
  #estSeq = 0;
  #savedBody = "";

  constructor(s: Stores, target: ComposerTarget, intent: ThreadIntent, path: ExecPath) {
    this.#s = s;
    this.target = target;
    this.intent = intent;
    this.path = path;
    const offline = this.#offlineKey();
    const kept = offline ? getJson<{ body: string; intent: ThreadIntent }>("local", offline) : null;
    if (kept?.body) {
      this.body = kept.body;
      this.save = "offline";
    }
  }

  get ws() {
    return this.#s.workspace.key;
  }

  /** Contract snapshot (for components that take `ComposerState`). */
  get state(): ComposerState {
    return {
      anchor: {
        primary: "doc",
        doc: { block: this.target.block, blockHash: this.target.blockHash, ...(this.target.anchor.doc?.quote ? { quote: this.target.anchor.doc.quote } : {}) },
      },
      intent: this.intent,
      body: this.body,
      ...(this.draft ? { draft: this.draft } : {}),
      tempKey: this.tempKey,
      target: this.fixTarget,
      ...(this.docMd !== undefined ? { docMd: this.docMd } : {}),
      ...(this.estimate ? { estimate: this.estimate } : {}),
      chips: this.chips,
      predicted: this.predicted,
      path: this.path,
      ...(this.override ? { override: this.override } : {}),
      stale: this.stale,
    };
  }

  predicted: Prediction = $derived.by(() =>
    predict({
      chips: this.chips,
      body: this.body,
      intent: this.intent,
      outTokens: this.estimate?.estimate.outTokens ?? 0,
      model: this.estimate?.estimate.model ?? DEFAULT_MODEL,
      limits: this.#s.session.settings?.settings.limits ?? DEFAULT_LIMITS,
      override: this.override,
    }),
  );

  /** The job kind this Composer would create (`note` is dispatched only by Finish). */
  get kind() {
    return INTENT_JOB_KIND[this.intent === "change" && this.fixTarget === "doc" ? "doc_edit" : this.intent];
  }

  /** Notes never start a job; the doc-target edit costs 0 tok. */
  get runsJob(): boolean {
    return this.intent !== "note" && !(this.intent === "change" && this.fixTarget === "doc");
  }

  #offlineKey(): string | null {
    return this.ws ? STORAGE_KEYS.draft(this.ws, this.target.key) : null;
  }

  // ------------------------------------------------------------------------------------------- editing
  setIntent(i: ThreadIntent): void {
    if (i === this.intent) return;
    this.intent = i;
    if (i !== "change") this.fixTarget = "code";
    this.stale = true;
    if (this.draft) this.#scheduleSave(0);
    this.#scheduleEstimate();
  }

  input(body: string): void {
    this.body = body;
    this.stale = true;
    this.#ensureDraft();
    this.#scheduleSave(UI_THRESHOLDS.draftDebounceMs);
    this.#scheduleEstimate();
  }

  toggleChip(key: string, next: ComposerChip["state"]): void {
    const c = this.chips.find((x) => x.item.key === key);
    if (!c) return;
    if (next === "removed" && !c.item.removable) return;
    this.chips = this.chips.map((x) => (x.item.key === key ? { ...x, state: next } : x));
    this.stale = true;
    this.#ensureDraft();
    this.#scheduleEstimate();
  }

  addMention(r: { path: string; start: number; end: number }): void {
    const label = `${r.path.split("/").pop() ?? r.path}:${r.start}-${r.end}`;
    this.mentions = [...this.mentions.filter((m) => !(m.path === r.path && m.start === r.start && m.end === r.end)), { ...r, label }];
    this.stale = true;
    this.#ensureDraft();
    this.#scheduleEstimate();
  }

  removeMention(i: number): void {
    this.mentions = this.mentions.filter((_, j) => j !== i);
    this.#scheduleEstimate();
  }

  setPath(p: ExecPath): void {
    this.path = p;
  }

  setOverride(o: ComposerState["override"]): void {
    this.override = o && (o.mode || o.model) ? o : undefined;
    this.stale = true;
    this.#scheduleEstimate();
  }

  /** The 2-way choice (`change` on a doc anchor): the doc target edits the block's Markdown (0 tok). */
  async setTarget(t: "code" | "doc"): Promise<void> {
    this.fixTarget = t;
    if (t !== "doc" || this.docMd !== undefined) return;
    const ws = this.ws;
    if (!ws) return;
    try {
      const v = await this.#s.api.call("GET /ws/:ws/doc/blocks/:block", { params: { ws, block: this.target.block }, query: { md: "file" } });
      const md = "md" in v ? v.md : "";
      this.docBase = { md, hash: v.hash };
      if (this.docMd === undefined) this.docMd = md;
    } catch (err) {
      this.error = MitoriError.from(err).code;
    }
  }

  setDocMd(md: string): void {
    this.docMd = md;
  }

  get docChanged(): boolean {
    return this.docMd !== undefined && this.docBase !== null && this.docMd !== this.docBase.md;
  }

  // ------------------------------------------------------------------------------------------- draft
  #ensureDraft(): Promise<ThreadId | null> {
    if (this.draft) return Promise.resolve(this.draft);
    if (this.#creating) return this.#creating;
    const ws = this.ws;
    if (!ws) return Promise.resolve(null);
    this.save = "saving";
    const body = this.body;
    this.#creating = this.#s.api
      .call("POST /ws/:ws/threads", {
        params: { ws },
        body: { anchor: this.target.anchor, intent: this.intent, body, draft: true },
        idempotencyKey: this.tempKey,
      })
      .then((th) => {
        this.#adopt(th);
        this.#savedBody = body;
        if (this.body !== body) this.#scheduleSave(UI_THRESHOLDS.draftDebounceMs);
        else this.save = "saved";
        this.#scheduleEstimate(0);
        return th.id;
      })
      .catch((err: unknown) => {
        this.#offline(err);
        return null;
      })
      .finally(() => {
        this.#creating = null;
      });
    return this.#creating;
  }

  /** Continue an existing draft (same anchor reopened): its id, version, intent and first message verbatim. */
  resume(d: ThreadDetail): void {
    this.#adopt(d);
    this.intent = d.intent === "doc_edit" ? "change" : d.intent;
    this.body = d.messages[0]?.body ?? "";
    this.#savedBody = this.body;
    this.save = "saved";
  }

  #adopt(th: ThreadDetail | { id: ThreadId; version: number }): void {
    this.draft = th.id;
    this.version = th.version;
    const key = this.#offlineKey();
    if (key) removeItem("local", key);
  }

  #offline(err: unknown): void {
    const e = MitoriError.from(err);
    if (e.code !== "E_NOT_READY") {
      this.error = e.code;
      this.save = "idle";
      return;
    }
    const key = this.#offlineKey();
    if (key) setJson("local", key, { body: this.body, intent: this.intent });
    if (this.save !== "offline") this.#s.bottom.toast({ id: "draft.offline", kind: "warn", key: "toast.draft.offline" });
    this.save = "offline";
  }

  #scheduleSave(ms: number): void {
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => void this.flushSave(), ms);
  }

  /** Save the body / intent now (Escape, submit). Resolves with the draft id (null when offline). */
  async flushSave(): Promise<ThreadId | null> {
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = null;
    const id = await this.#ensureDraft();
    const ws = this.ws;
    if (!id || !ws) return id;
    if (this.body === this.#savedBody && !this.stale) return id;
    const body = this.body;
    this.save = "saving";
    try {
      const th = await this.#s.api.call("PATCH /ws/:ws/threads/:th", { params: { ws, th: id }, body: { version: this.version, body, intent: this.intent } });
      this.version = th.version;
      this.#savedBody = body;
      this.save = "saved";
    } catch (err) {
      const e = MitoriError.from(err);
      if (e.code === "E_CONFLICT") {
        // another tab touched the draft: take its version, keep OUR text (verbatim) and save again
        const fresh = await this.#s.api.call("GET /ws/:ws/threads/:th", { params: { ws, th: id } }).catch(() => null);
        if (fresh) {
          this.version = fresh.version;
          this.#scheduleSave(0);
        }
      } else this.#offline(err);
    }
    return id;
  }

  // ------------------------------------------------------------------------------------------- estimate
  #scheduleEstimate(ms: number = UI_THRESHOLDS.estimateDebounceMs): void {
    if (!this.runsJob) return;
    if (this.#estTimer) clearTimeout(this.#estTimer);
    this.#estTimer = setTimeout(() => void this.refreshEstimate(), ms);
  }

  /** `POST /jobs/estimate` for the draft with the chip adjustments; the response replaces the prediction. */
  async refreshEstimate(): Promise<JobEstimate | null> {
    if (this.#estTimer) clearTimeout(this.#estTimer);
    this.#estTimer = null;
    const ws = this.ws;
    const th = this.draft;
    if (!ws || !th || !this.runsJob) return null;
    const seq = ++this.#estSeq;
    this.estimating = true;
    try {
      const before = this.predicted.tokensIn;
      const context = contextAdjust(this.chips, this.candidateKeys, this.mentions);
      const est = await this.#s.api.call("POST /ws/:ws/jobs/estimate", {
        params: { ws },
        body: {
          kind: this.kind,
          threads: [th],
          ...(Object.keys(context).length ? { context } : {}),
          ...(this.override?.mode ? { mode: this.override.mode } : {}),
          ...(this.override?.model ? { model: this.override.model } : {}),
        },
      });
      if (seq !== this.#estSeq) return est;
      this.applyEstimate(est);
      if (Math.abs(this.predicted.tokensIn - before) > 0 && this.chips.length > 0) {
        this.flash = true;
        setTimeout(() => (this.flash = false), 350);
      }
      return est;
    } catch (err) {
      if (seq === this.#estSeq) this.error = MitoriError.from(err).code;
      return null;
    } finally {
      if (seq === this.#estSeq) this.estimating = false;
    }
  }

  applyEstimate(est: JobEstimate): void {
    for (const c of est.candidates ?? []) this.candidateKeys.add(c.key);
    this.estimate = est;
    this.chips = mergeChips(this.chips, est.estimate.items, est.candidates ?? []);
    this.stale = false;
    this.error = null;
  }

  /** Items shown as chips (fixed + rules first). */
  get orderedChips(): ComposerChip[] {
    const rank = (it: EstimateItem) =>
      it.kind === "fixed" || it.kind === "rules" ? 0 : it.kind === "ask" || it.kind === "instructions" ? 3 : it.kind === "related" ? 2 : 1;
    return [...this.chips].filter((c) => c.item.kind !== "ask" && c.item.kind !== "instructions").sort((a, b) => rank(a.item) - rank(b.item));
  }

  /** Answer-mode intents run without edits (router R0). */
  get answers(): boolean {
    return answerIntent(this.intent);
  }

  dispose(): void {
    if (this.#estTimer) clearTimeout(this.#estTimer);
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
  }
}
