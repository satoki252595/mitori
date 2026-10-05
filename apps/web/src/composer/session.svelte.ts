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
  type CodeTarget,
  type CodeTargets,
  type ContextAdjust,
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
  type WorkspaceKey,
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

/** A code range in the request: an `@` mention or a picked target candidate (sent as `ContextAdjust.add`). */
export interface MentionRange {
  path: string;
  start: number;
  end: number;
  label: string;
  /** Enclosing symbol of a picked candidate. */
  symbol?: string;
}

/** Fix targets are re-asked this long after the request text changes (terms of the text find symbols). */
const TARGETS_DEBOUNCE_MS = 400;

const DEFAULT_MODEL: ModelId = "claude-sonnet-5-5";

export class ComposerSession {
  readonly tempKey = `tmp_${crypto.randomUUID()}`;
  readonly target: ComposerTarget;
  readonly ws: WorkspaceKey | null;
  intent = $state<ThreadIntent>("note");
  body = $state("");
  draft = $state<ThreadId | null>(null);
  /** A confirm card can reopen this session to narrow the context of its already-open thread. */
  submitted = false;
  version = 0;
  /** The 2-way choice of `change` on a doc anchor (`ComposerState.target`). */
  /**
   * `change` on a doc anchor: `code` = make the code follow the request; `ai` = the code is right, the AI rewrites the
   * doc sentence (EX-06: an Explain with `docFix`); `doc` = edit the block's Markdown yourself (0 tok).
   */
  fixTarget = $state<"code" | "ai" | "doc">("code");
  docMd = $state<string | undefined>(undefined);
  /** Markdown the doc edit started from (3-way base, and the undo text). */
  docBase = $state.raw<{ md: string; hash: string } | null>(null);
  estimate = $state.raw<JobEstimate | undefined>(undefined);
  chips = $state.raw<ComposerChip[]>([]);
  readonly candidateKeys = new Set<string>();
  mentions = $state.raw<MentionRange[]>([]);
  /** Persisted exclusions, including `write:<path>` (CODE stays readable). */
  removedKeys = $state.raw<string[]>([]);
  /**
   * Code targets of a Fix on a doc anchor (CR ux-F1, `POST /jobs/targets`): `cited` = the anchored claim's cites (the
   * router writes them), `candidates` = suggestions the user picks. `null` until known, or when nothing changes code.
   */
  targets = $state.raw<CodeTargets | null>(null);
  /** The targets request is in flight. */
  targetsLoading = $state(false);
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
  #saving: Promise<ThreadId | null> | null = null;
  #estSeq = 0;
  #targetsSeq = 0;
  #targetsTimer: ReturnType<typeof setTimeout> | null = null;
  #savedBody = "";
  #savedContext = "{}";
  #savedIntent: ThreadIntent = "note";

  constructor(s: Stores, target: ComposerTarget, intent: ThreadIntent, path: ExecPath) {
    this.#s = s;
    this.target = target;
    this.ws = s.workspace.key;
    this.intent = intent;
    this.path = path;
    const offline = this.#offlineKey();
    const kept = offline ? getJson<{ body: string; intent: ThreadIntent; context?: ContextAdjust }>("local", offline) : null;
    if (kept) {
      this.body = kept.body;
      this.intent = kept.intent;
      this.#restoreContext(kept.context);
      this.save = "offline";
    }
    if (this.wantsTargets) void this.refreshTargets();
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

  predicted: Prediction = $derived.by(() => {
    const settings = this.#s.session.settings?.settings;
    const prediction = predict({
      chips: this.chips,
      body: this.body,
      intent: this.intent,
      outTokens: this.estimate?.estimate.outTokens ?? 0,
      model: this.estimate?.estimate.model ?? (answerIntent(this.sentIntent) ? settings?.models.answer : settings?.models.patch) ?? DEFAULT_MODEL,
      engine: this.estimate?.estimate.engine ?? settings?.defaultEngine ?? "claude-cli",
      ...(settings?.engines.generic.pricing ? { genericPricing: settings.engines.generic.pricing } : {}),
      limits: settings?.limits ?? DEFAULT_LIMITS,
      override: this.override,
    });
    if (this.estimate && !this.stale) prediction.usd = this.estimate.estimate.apiUsd;
    return prediction;
  });

  /** The job kind this Composer would create (`note` is dispatched only by Finish). */
  get kind() {
    return INTENT_JOB_KIND[this.intent === "change" && this.fixTarget === "doc" ? "doc_edit" : this.sentIntent];
  }

  /** EX-06: the AI doc fix is a question to the server (an Explain that also proposes the block rewritten). */
  get sentIntent(): ThreadIntent {
    return this.intent === "change" && this.fixTarget === "ai" ? "question" : this.intent;
  }

  /** EX-06: the job asks the answer to propose the anchored block rewritten to match the code. */
  get docFix(): boolean {
    return this.intent === "change" && this.fixTarget === "ai";
  }

  /** Notes never start a job; the doc-target edit costs 0 tok. */
  get runsJob(): boolean {
    return this.intent !== "note" && !(this.intent === "change" && this.fixTarget === "doc");
  }

  // ------------------------------------------------------------------------------------------- code targets (CR ux-F1)
  /** This Composer would change code from a doc anchor: the AI must know WHICH code (a cite, a pick or an `@`). */
  get wantsTargets(): boolean {
    return this.intent === "change" && this.fixTarget === "code" && this.target.anchor.primary === "doc";
  }

  /** The Fix has a write target: a cite of the anchor, or a range the user picked / mentioned. */
  get hasTarget(): boolean {
    return this.writeFiles.length > 0;
  }

  /** Whether the anchor has cites is not known yet (the first targets answer is on its way). */
  get targetsPending(): boolean {
    return this.wantsTargets && this.targets === null && !this.hasTarget;
  }

  /** A Fix with nothing to write: the Composer offers the candidates, or says how to point at code — never a silent 412. */
  get needsTarget(): boolean {
    return this.wantsTargets && this.targets !== null && !this.hasTarget;
  }

  /** Candidates not picked yet (a pick moves the range into `mentions`). */
  get openCandidates(): CodeTarget[] {
    const picked = (t: CodeTarget) => this.mentions.some((m) => m.path === t.path && m.start === t.start && m.end === t.end);
    return (this.targets?.candidates ?? []).filter((t) => !picked(t));
  }

  /** The same human-selected context on push, pull, copy and saved drafts (CR safe-6). */
  get context(): ContextAdjust {
    const c = contextAdjust(this.chips, this.candidateKeys, this.mentions);
    const add = [...new Map((c.add ?? []).map((a) => [`${a.path}:${a.start}-${a.end}`, a])).values()];
    const remove = [...new Set([...this.removedKeys, ...(c.remove ?? [])])].sort();
    return { ...(add.length ? { add } : {}), ...(remove.length ? { remove } : {}) };
  }

  /** Files the AI may write, shown before sending on every execution path. */
  get writeFiles(): string[] {
    const out: string[] = [];
    for (const p of [...(this.targets?.cited ?? []).map((t) => t.path), ...this.mentions.map((m) => m.path)])
      if (!this.removedKeys.includes(`write:${p}`) && !out.includes(p)) out.push(p);
    return out;
  }

  toggleWrite(path: string): void {
    const key = `write:${path}`;
    this.removedKeys = this.removedKeys.includes(key) ? this.removedKeys.filter((k) => k !== key) : [...this.removedKeys, key];
    this.stale = true;
    this.#ensureDraft();
    this.#scheduleSave(UI_THRESHOLDS.draftDebounceMs);
    this.#scheduleEstimate();
  }

  /** `POST /jobs/targets` for the anchor and the request typed so far (deterministic, 0 tok). */
  async refreshTargets(): Promise<CodeTargets | null> {
    if (this.#targetsTimer) clearTimeout(this.#targetsTimer);
    this.#targetsTimer = null;
    const ws = this.ws;
    if (!ws || !this.wantsTargets) return null;
    const seq = ++this.#targetsSeq;
    this.targetsLoading = true;
    try {
      const res = await this.#s.api.call("POST /ws/:ws/jobs/targets", {
        params: { ws },
        body: { anchor: this.target.anchor, ...(this.body.trim() ? { text: this.body } : {}) },
      });
      if (seq !== this.#targetsSeq) return res;
      const before = this.hasTarget;
      this.targets = res;
      // the cites became known: the estimate can run now (a draft that exists was waiting for them)
      if (this.hasTarget && !before) this.#scheduleEstimate(0);
      return res;
    } catch {
      // a stale view (quote mismatch) or a daemon restart: no candidates, the hint still says how to point at code
      if (seq === this.#targetsSeq) this.targets ??= { cited: [], candidates: [] };
      return null;
    } finally {
      if (seq === this.#targetsSeq) this.targetsLoading = false;
    }
  }

  /** One click / ⌥n on a candidate: it becomes a range of the request (and so of the write scope). */
  pickTarget(t: CodeTarget): void {
    this.addMention({ path: t.path, start: t.start, end: t.end, ...(t.symbol ? { symbol: t.symbol } : {}) });
  }

  #scheduleTargets(): void {
    if (!this.wantsTargets || (this.targets?.cited.length ?? 0) > 0) return;
    if (this.#targetsTimer) clearTimeout(this.#targetsTimer);
    this.#targetsTimer = setTimeout(() => void this.refreshTargets(), TARGETS_DEBOUNCE_MS);
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
    if (this.wantsTargets && this.targets === null) void this.refreshTargets();
    this.#scheduleEstimate();
  }

  input(body: string): void {
    this.body = body;
    this.stale = true;
    this.#ensureDraft();
    this.#scheduleSave(UI_THRESHOLDS.draftDebounceMs);
    this.#scheduleEstimate();
    this.#scheduleTargets();
  }

  toggleChip(key: string, next: ComposerChip["state"]): void {
    const c = this.chips.find((x) => x.item.key === key);
    if (!c) return;
    if (next === "removed" && !c.item.removable) return;
    this.chips = this.chips.map((x) => (x.item.key === key ? { ...x, state: next } : x));
    if (!this.candidateKeys.has(key)) this.removedKeys = [...this.removedKeys.filter((k) => k !== key), ...(next === "removed" ? [key] : [])];
    this.stale = true;
    this.#ensureDraft();
    this.#scheduleSave(UI_THRESHOLDS.draftDebounceMs);
    this.#scheduleEstimate();
  }

  addMention(r: { path: string; start: number; end: number; symbol?: string }): void {
    const label = `${r.path.split("/").pop() ?? r.path}:${r.start}-${r.end}`;
    this.mentions = [...this.mentions.filter((m) => !(m.path === r.path && m.start === r.start && m.end === r.end)), { ...r, label }];
    this.stale = true;
    this.#ensureDraft();
    this.#scheduleSave(UI_THRESHOLDS.draftDebounceMs);
    this.#scheduleEstimate();
  }

  removeMention(i: number): void {
    this.mentions = this.mentions.filter((_, j) => j !== i);
    this.stale = true;
    this.#scheduleSave(UI_THRESHOLDS.draftDebounceMs);
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
  async setTarget(t: "code" | "ai" | "doc"): Promise<void> {
    const was = this.sentIntent;
    this.fixTarget = t;
    // the draft's stored intent follows (an AI doc fix is a question), and the estimate is for the new job kind
    if (this.sentIntent !== was) {
      this.stale = true;
      if (this.draft) this.#scheduleSave(0);
      this.#scheduleEstimate();
    }
    if (t === "code" && this.targets === null) void this.refreshTargets();
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
    const context = this.context;
    const intent = this.sentIntent;
    this.#creating = this.#s.api
      .call("POST /ws/:ws/threads", {
        params: { ws },
        body: { anchor: this.target.anchor, intent, body, draft: true, context },
        idempotencyKey: this.tempKey,
      })
      .then((th) => {
        this.#adopt(th);
        this.#savedBody = body;
        this.#savedContext = JSON.stringify(context);
        this.#savedIntent = intent;
        if (this.body !== body || JSON.stringify(this.context) !== this.#savedContext || this.sentIntent !== intent)
          this.#scheduleSave(UI_THRESHOLDS.draftDebounceMs);
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
    this.submitted = d.state !== "draft";
    this.intent = d.intent === "doc_edit" ? "change" : d.intent;
    this.body = d.messages[0]?.body ?? "";
    this.#restoreContext(d.context);
    this.#savedBody = this.body;
    this.#savedContext = JSON.stringify(this.context);
    this.#savedIntent = this.sentIntent;
    this.save = "saved";
  }

  #restoreContext(context?: ContextAdjust): void {
    this.removedKeys = [...(context?.remove ?? [])];
    this.mentions = (context?.add ?? []).map((m) => ({ ...m, label: `${m.path.split("/").pop() ?? m.path}:${m.start}-${m.end}` }));
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
    if (key) setJson("local", key, { body: this.body, intent: this.intent, context: this.context });
    if (this.save !== "offline") this.#s.bottom.toast({ id: "draft.offline", kind: "warn", key: "toast.draft.offline" });
    this.save = "offline";
  }

  #scheduleSave(ms: number): void {
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => void this.flushSave(), ms);
  }

  /** Save the body / intent / context now (Escape, submit). Resolves with the draft id (null when offline). */
  async flushSave(): Promise<ThreadId | null> {
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = null;
    if (this.#saving) {
      await this.#saving;
      return this.flushSave();
    }
    this.#saving = this.#flushSave().finally(() => {
      this.#saving = null;
    });
    return this.#saving;
  }

  async #flushSave(): Promise<ThreadId | null> {
    const id = await this.#ensureDraft();
    const ws = this.ws;
    if (!id || !ws) return id;
    const context = this.context;
    const intent = this.sentIntent;
    const serialized = JSON.stringify(context);
    if (this.body === this.#savedBody && serialized === this.#savedContext && intent === this.#savedIntent) return id;
    const body = this.body;
    if (this.submitted && body !== this.#savedBody) {
      this.error = "E_PRECONDITION";
      this.save = "idle";
      return id;
    }
    this.save = "saving";
    try {
      const th = await this.#s.api.call("PATCH /ws/:ws/threads/:th", {
        params: { ws, th: id },
        body: { version: this.version, ...(!this.submitted ? { body } : {}), intent, context: Object.keys(context).length ? context : null },
      });
      this.version = th.version;
      this.#savedBody = body;
      this.#savedContext = serialized;
      this.#savedIntent = intent;
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
    if (this.wantsTargets && !this.hasTarget) {
      // nothing to write yet: no estimate request (it could only answer 412); the Composer shows the candidates / hint
      if (this.#estTimer) clearTimeout(this.#estTimer);
      this.#estTimer = null;
      this.#estSeq++;
      this.estimating = false;
      this.estimate = undefined;
      this.chips = [];
      return;
    }
    if (this.#estTimer) clearTimeout(this.#estTimer);
    this.#estTimer = setTimeout(() => void this.refreshEstimate(), ms);
  }

  /** `POST /jobs/estimate` for the draft with the chip adjustments; the response replaces the prediction. */
  async refreshEstimate(): Promise<JobEstimate | null> {
    if (this.#estTimer) clearTimeout(this.#estTimer);
    this.#estTimer = null;
    const ws = this.ws;
    if (!ws || !this.draft || !this.runsJob) return null;
    if (this.wantsTargets && !this.hasTarget) return null;
    const seq = ++this.#estSeq;
    this.estimating = true;
    try {
      // the server estimates what it has stored: the body's autosave (500 ms) is slower than this debounce (300 ms),
      // so write the text first — otherwise the estimate (and the plan a send reuses) is made for an empty ASK
      if (this.body !== this.#savedBody || JSON.stringify(this.context) !== this.#savedContext || this.sentIntent !== this.#savedIntent) await this.flushSave();
      const th = this.draft;
      if (!th) return null;
      const sent = this.#savedBody; // what the server has — and so what it estimates
      const before = this.predicted.tokensIn;
      const context = this.context;
      const serialized = JSON.stringify(context);
      if (this.body !== sent || serialized !== this.#savedContext || this.sentIntent !== this.#savedIntent)
        throw new MitoriError("E_CONFLICT", "draft has not been saved");
      const est = await this.#s.api.call("POST /ws/:ws/jobs/estimate", {
        params: { ws },
        body: {
          kind: this.kind,
          threads: [th],
          ...(this.docFix ? { docFix: true } : {}),
          ...(Object.keys(context).length ? { context } : {}),
          ...(this.override?.mode ? { mode: this.override.mode } : {}),
          ...(this.override?.model ? { model: this.override.model } : {}),
        },
      });
      if (seq !== this.#estSeq) return est;
      this.applyEstimate(est);
      // typed on while it was in flight: a send must not trust this one
      if (this.body !== sent || JSON.stringify(this.context) !== serialized) this.stale = true;
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
    this.chips = this.chips.map((c) => (c.item.removable && this.removedKeys.includes(c.item.key) ? { ...c, state: "removed" } : c));
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
    return answerIntent(this.sentIntent);
  }

  dispose(): void {
    if (this.#estTimer) clearTimeout(this.#estTimer);
    if (this.#targetsTimer) clearTimeout(this.#targetsTimer);
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
  }
}
