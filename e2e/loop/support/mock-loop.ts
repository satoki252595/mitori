/**
 * Mock daemon for the WP-10b loop e2e (`@wp10b`): the review-loop routes (threads, jobs, review rounds, inbox, trust,
 * checkpoints, proposals, doc edits) with in-memory state and a REPLAYED engine — recorded `job.event` timelines
 * (patch: prepare → bundle → spawn → think → apply → scope → gates → ready; answer: bundle → spawn → streamed text →
 * verify → done) played back over the SSE stream, scaled by `speed`. Everything else (SPA files, doc, map, settings,
 * palette…) is proxied to WP-10a's mock (`e2e/web/support/mock-server.ts`, started as a child on `port + 1`), so the
 * Reader under test is the real one with the same fixtures.
 * Test control: POST /__loop/configure {…LoopOptions} · POST /__loop/emit {sse} · GET /__loop/log ·
 * POST /__loop/waiting {clients, agents}.
 * Run: bun e2e/loop/support/mock-loop.ts <port>
 */
import { resolve } from "node:path";
import type {
  AcceptReq,
  Anchor,
  AnchorInput,
  BlockView,
  Checkpoint,
  CheckpointId,
  DocProposalView,
  EstimateItem,
  FileDiff,
  GateResult,
  HunkId,
  InboxFilter,
  InboxItem,
  Job,
  JobEstimate,
  JobEvent,
  JobId,
  MessageView,
  ProposalId,
  Round,
  SectionId,
  SectionView,
  Thread,
  ThreadId,
  ThreadIntent,
  TrustRequest,
} from "@mitori/core";

const PORT = Number(process.argv[2] ?? 4410);
const BASE = `http://127.0.0.1:${PORT + 1}`;
const WS = "ws_cr1t00000000";
const ROOT = resolve(import.meta.dir, "../../..");

export interface LoopOptions {
  /** Gate outcome of ready jobs. */
  gates: "pass" | "untrusted" | "fail" | "pending";
  /** Ready jobs touch sensitive files (no one-key accept, SEC-12). */
  sensitive: boolean;
  /** Lines of the generated diff (≥ 2,000 ⇒ CM6). */
  diffLines: number;
  /** Replay speed factor (2 = twice as fast). */
  speed: number;
  /** `mitori review` waiters. */
  waiters: number;
  /** Estimates require confirmation (100k+). */
  requiresConfirm: boolean;
  /** A pending gates trust request exists. */
  trustPending: boolean;
  /** Pre-seeded threads / jobs for the Inbox (doc_edit draft, failed job, outdated note, ready job). */
  seedInbox: boolean;
  /** Delay of `POST /jobs/estimate` and `POST /threads` (ms) — the optimistic card must not wait for them. */
  latencyMs: number;
}

const DEFAULTS: LoopOptions = {
  gates: "pass",
  sensitive: false,
  diffLines: 0,
  speed: 4,
  waiters: 0,
  requiresConfirm: false,
  trustPending: false,
  seedInbox: false,
  latencyMs: 0,
};

type StoredThread = Thread & { messages: MessageView[] };
type StoredJob = Job & { diff: FileDiff[]; events: JobEvent[]; proposalViews: DocProposalView[]; anchorBlock: string | null };

let opts: LoopOptions = { ...DEFAULTS };
let threads = new Map<ThreadId, StoredThread>();
let jobs = new Map<JobId, StoredJob>();
let checkpoints = new Map<CheckpointId, Checkpoint>();
let proposals = new Map<ProposalId, DocProposalView>();
let round: Round | null = null;
let waiting = { clients: 0, agents: ["claude-code"] };
let log: { method: string; path: string; body?: unknown; at: number }[] = [];
let seq = 1000;
let rev = 1;
let ids = 0;
let timers: ReturnType<typeof setTimeout>[] = [];
const blocks = new Map<string, BlockView>();
const original = new Map<string, BlockView>();
const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
const enc = new TextEncoder();
const now = () => new Date().toISOString();
const id = <P extends string>(p: P): `${P}${string}` => `${p}${(++ids).toString(32).padStart(10, "0")}` as `${P}${string}`;

function reset(o: Partial<LoopOptions>): void {
  for (const t of timers) clearTimeout(t);
  timers = [];
  opts = { ...DEFAULTS, ...o };
  threads = new Map();
  jobs = new Map();
  checkpoints = new Map();
  proposals = new Map();
  round = null;
  waiting = { clients: opts.waiters, agents: ["claude-code"] };
  log = [];
  blocks.clear();
  for (const [k, v] of original) blocks.set(k, v);
}

function emit(e: Record<string, unknown> & { type: string }): void {
  seq++;
  rev++;
  const full = { seq, ws: WS, rev, at: now(), ...e };
  const frame = enc.encode(`id: ${seq}\ndata: ${JSON.stringify(full)}\n\n`);
  for (const c of streams) {
    try {
      c.enqueue(frame);
    } catch {
      streams.delete(c);
    }
  }
}

const json = (v: unknown, status = 200) => Response.json(v, { status, headers: { "x-mitori-rev": String(rev) } });
const err = (code: string, status: number, params?: Record<string, unknown>) =>
  Response.json({ error: { code, message: code, retryable: false, ...(params ? { params } : {}) } }, { status });
const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms / Math.max(0.1, opts.speed)));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- doc blocks (from the base mock)
async function loadBlocks(): Promise<void> {
  if (original.size) return;
  const outline = (await (await fetch(`${BASE}/api/v1/ws/${WS}/doc`)).json()) as { sections: { id: SectionId }[] };
  for (const s of outline.sections) {
    const r = await fetch(`${BASE}/api/v1/ws/${WS}/doc/sections/${s.id}`);
    if (!r.ok) continue;
    const v = (await r.json()) as SectionView;
    for (const b of v.blocks) original.set(b.id, b);
  }
  for (const [k, v] of original) blocks.set(k, v);
}

const plain = (html: string) =>
  html
    .replace(/<a class="mcite"[\s\S]*?<\/a>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

function anchorOf(a: AnchorInput): Anchor {
  const b = a.doc ? blocks.get(a.doc.block) : undefined;
  if (!a.doc) return { primary: a.primary };
  return { primary: "doc", doc: { block: a.doc.block, ...(a.doc.quote ? { quote: a.doc.quote } : {}), offset: a.doc.selStart, blockHash: b?.hash ?? "0" } };
}

function citesOf(block: string | null): { path: string; start: number; end: number }[] {
  const html = block ? (blocks.get(block)?.html ?? "") : "";
  return [...html.matchAll(/data-cite="([^":]+):(\d+)-(\d+)"/g)].map((m) => ({ path: m[1] as string, start: Number(m[2]), end: Number(m[3]) }));
}

// ---------------------------------------------------------------- threads
function summary(t: StoredThread) {
  const { messages, ...rest } = t;
  return {
    ...rest,
    preview: messages[messages.length - 1]?.body.slice(0, 120) ?? "",
    messages: messages.length,
    jobState: t.jobs.length ? jobs.get(t.jobs[t.jobs.length - 1] as JobId)?.state : undefined,
  };
}
function detail(t: StoredThread) {
  return { ...t, jobViews: t.jobs.map((j) => jobView(jobs.get(j) as StoredJob)) };
}
function message(th: ThreadId, by: MessageView["by"], kind: MessageView["kind"], body: string, job?: JobId): MessageView {
  return {
    id: id("m_"),
    thread: th,
    by,
    kind,
    body,
    round: round?.n ?? 1,
    ...(job ? { job } : {}),
    createdAt: now(),
    html: `<p>${body.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string)}</p>`,
  };
}
function touch(t: StoredThread, patch: Partial<StoredThread>): void {
  Object.assign(t, patch, { version: t.version + 1, updatedAt: now() });
  emit({ type: "thread.upsert", thread: summary(t) });
}

function createThread(b: { anchor: AnchorInput; intent: ThreadIntent; body: string; draft: boolean }): StoredThread {
  const thId = id("th_");
  const t: StoredThread = {
    id: thId,
    anchor: anchorOf(b.anchor),
    anchorHealth: "ok",
    stale: false,
    intent: b.intent,
    state: b.draft ? "draft" : "open",
    round: round?.n ?? 1,
    version: 1,
    title: b.body.split("\n")[0]?.slice(0, 60) ?? "",
    jobs: [],
    createdAt: now(),
    updatedAt: now(),
    messages: [],
  };
  t.messages.push(message(thId, "human", "comment", b.body));
  threads.set(thId, t);
  emit({ type: "thread.upsert", thread: summary(t) });
  return t;
}

// ---------------------------------------------------------------- estimates
function estimateFor(th: StoredThread, extra: { mode?: Job["route"]["mode"]; model?: string; remove?: string[] } = {}): JobEstimate {
  const block = th.anchor.doc?.block ?? null;
  const cites = citesOf(block);
  const all: EstimateItem[] = [
    { key: "fixed", kind: "fixed", label: "system + 規約", tokens: 1800, cached: true, removable: false },
    { key: "anchor", kind: "doc", label: `§3 ${blocks.get(block ?? "")?.section ?? ""}`, tokens: 240, cached: false, removable: false },
    ...cites.map(
      (c, i): EstimateItem => ({
        key: `code${i}`,
        kind: "code",
        label: `${c.path.split("/").pop()}:${c.start}-${c.end}`,
        tokens: 12 * (c.end - c.start + 1),
        cached: false,
        removable: true,
        path: c.path,
        lines: c.end - c.start + 1,
      }),
    ),
    { key: "ask", kind: "ask", label: "ask", tokens: Math.max(40, Math.ceil((th.messages[0]?.body.length ?? 0) * 0.8)), cached: false, removable: false },
    { key: "out", kind: "output", label: "out", tokens: 1200, cached: false, removable: false },
  ];
  const items = all.filter((i) => !extra.remove?.includes(i.key));
  const lines = items.reduce((n, i) => n + (i.lines ?? 0), 0);
  const files = new Set(items.filter((i) => i.path).map((i) => i.path)).size;
  const mode = extra.mode ?? (th.intent === "question" || th.intent === "review" ? "answer" : lines <= 120 && files <= 2 ? "patch" : "agent");
  const model = (extra.model ?? "claude-sonnet-5-5") as "claude-sonnet-5-5";
  const inTok = items.filter((i) => i.kind !== "output" && !i.cached).reduce((n, i) => n + i.tokens, 0);
  const big = opts.requiresConfirm ? 120_000 : 0;
  return {
    route: {
      mode,
      reason: mode === "answer" ? "intent_question" : mode === "patch" ? "small_change" : "large_change",
      model,
      effort: "medium",
      tools: mode === "agent" ? "read_edit" : "none",
      contract: mode === "answer" ? "answer/1" : mode === "patch" ? "patch/1" : "agent/1",
      anchoredLines: lines,
      files,
      requiresConfirm: false,
    },
    estimate: {
      id: id("es_"),
      engine: "claude-cli",
      model,
      inTokens: inTok + big,
      cacheReadTokens: 1800,
      cacheWriteTokens: 0,
      outTokens: 1200,
      apiUsd: Math.round(((inTok + big) * 2 + 1800 * 0.2 + 1200 * 10) / 1e3) / 1e3,
      seconds: { p50: mode === "answer" ? 6 : 13, p90: mode === "answer" ? 9 : 20 },
      concurrency: 1,
      windowDeltaPct: null,
      billing: "subscription-window",
      confidencePct: 12,
      calibrationN: 34,
      band: "lt10k",
      items,
      requiresConfirm: opts.requiresConfirm,
      confirmReasons: opts.requiresConfirm ? ["over_token_threshold"] : [],
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    },
    bundle: { tokens: inTok, omitted: [] },
    candidates: [
      { key: "cand0", kind: "related", label: "config.go:45-141", tokens: 600, cached: false, removable: true, path: "internal/config/config.go", lines: 97 },
    ],
    history: { p25: mode === "answer" ? 4 : 10, p75: mode === "answer" ? 8 : 16, n: 34 },
  };
}

// ---------------------------------------------------------------- jobs + replayed engine
const GATES = [
  { id: "fmt:gofmt", ms: 120, at: 3400 },
  { id: "lint:govet", ms: 700, at: 4100 },
  { id: "test:go", ms: 6200, at: 6200 },
] as const;

function bigDiff(n: number): FileDiff {
  const lines = Array.from({ length: n }, (_, i) => (i % 3 === 0 ? `-\told line ${i}` : `+\tnew line ${i} // generated`));
  return {
    path: "internal/review/generated.go",
    status: "modified",
    binary: false,
    additions: lines.filter((l) => l.startsWith("+")).length,
    deletions: lines.filter((l) => l.startsWith("-")).length,
    hunks: [{ id: "internal/review/generated.go:10" as HunkId, oldStart: 10, oldLines: Math.ceil(n / 3), newStart: 10, newLines: n - Math.ceil(n / 3), lines }],
  };
}

function diffFor(): FileDiff[] {
  if (opts.diffLines > 0) return [bigDiff(opts.diffLines)];
  return [
    {
      path: "cmd/crit/cli_handlers_story.go",
      status: "modified",
      binary: false,
      additions: 4,
      deletions: 2,
      hunks: [
        {
          id: "cmd/crit/cli_handlers_story.go:572" as HunkId,
          oldStart: 572,
          oldLines: 5,
          newStart: 572,
          newLines: 6,
          lines: [
            "\t\treturn resumeStory(f)",
            "\t}",
            "-\tagentCmd := config.LoadConfig(mustCWD()).AgentCmd",
            "+\tcfg := config.LoadConfig(mustCWD())",
            "+\tagentCmd := cfg.AgentCmd",
            ' \tif agentCmd == "" {',
          ].map((l) => (l[0] === "+" || l[0] === "-" || l[0] === " " ? l : ` ${l}`)),
        },
        {
          id: "cmd/crit/cli_handlers_story.go:633" as HunkId,
          oldStart: 633,
          oldLines: 3,
          newStart: 634,
          newLines: 4,
          lines: [
            " \tout, err := generateStory(agentCmd, prompt)",
            "-\tif err != nil { out, err = generateStory(agentCmd, prompt+retryHint(err)) }",
            "+\tfor i := 0; err != nil && i < cfg.StoryRetries(); i++ {",
            "+\t\tout, err = generateStory(agentCmd, prompt+retryHint(err))",
            "+\t}",
          ],
        },
      ],
    },
    {
      path: "internal/config/config.go",
      status: "modified",
      binary: false,
      additions: 2,
      deletions: 0,
      hunks: [
        {
          id: "internal/config/config.go:45" as HunkId,
          oldStart: 45,
          oldLines: 1,
          newStart: 45,
          newLines: 3,
          lines: [" type Config struct {", '+\tStoryMaxRetries int `json:"story_max_retries"`', "+\t// 0–3, default 1"],
        },
      ],
    },
  ];
}

function jobView(j: StoredJob): Job {
  const { diff: _d, events: _e, proposalViews: _p, anchorBlock: _a, ...rest } = j;
  return rest;
}

function setJob(j: StoredJob, patch: Partial<StoredJob>): void {
  Object.assign(j, patch);
  emit({ type: "job.upsert", job: jobView(j) });
}

function event(j: StoredJob, e: JobEvent): void {
  j.events.push(e);
  emit({ type: "job.event", job: j.id, event: e });
}

function startJob(th: StoredThread, est: JobEstimate): StoredJob {
  const jId = id("j_");
  const j: StoredJob = {
    id: jId,
    ws: WS,
    kind: th.intent === "question" ? "explain" : "fix",
    threads: [th.id],
    engine: "claude-cli",
    route: est.route,
    state: "queued",
    attempt: 1,
    estimate: est.estimate,
    writeScope: est.route.mode === "answer" ? [] : ["cmd/crit/cli_handlers_story.go", "internal/config/config.go"],
    gates: [],
    proposals: [],
    promptVer: "loop@1",
    createdAt: now(),
    diff: [],
    events: [],
    proposalViews: [],
    anchorBlock: th.anchor.doc?.block ?? null,
  };
  jobs.set(jId, j);
  th.jobs.push(jId);
  touch(th, { state: "queued" });
  emit({ type: "job.upsert", job: jobView(j) });
  const t0 = Date.now();
  const at = (ms: number) => t0 + ms / Math.max(0.1, opts.speed);
  if (est.route.mode === "answer") {
    later(80, () => {
      setJob(j, { state: "running", startedAt: now() });
      touch(th, { state: "running" });
      event(j, { t: "phase", phase: "bundle", detail: "MBF/1 · 1.9k tok · 3 範囲 · router → answer（intent_question）", at: at(80) });
    });
    later(400, () =>
      event(j, {
        t: "phase",
        phase: "spawn",
        detail: 'claude -p --setting-sources "" --strict-mcp-config --tools "" --no-session-persistence --output-format stream-json --model claude-sonnet-5-5',
        at: at(400),
      }),
    );
    later(700, () => event(j, { t: "phase", phase: "think", detail: "ttft 1.4s · answer/1 を受信中", at: at(700) }));
    const answer = "この0.7は、過去のレビューで「ほぼ同じ文」と人が判断した組の類似度の下限から決めた経験値です。";
    const chunks = answer.match(/.{1,8}/gu) ?? [];
    chunks.forEach((c, i) => {
      later(900 + i * 120, () => event(j, { t: "text", delta: c, at: at(900 + i * 120) }));
    });
    const end = 900 + chunks.length * 120;
    later(end + 300, () => {
      event(j, { t: "phase", phase: "done", at: at(end + 300) });
      event(j, {
        t: "usage",
        usage: { in: 1900, cacheWrite: 0, cacheRead: 1800, out: 260, apiUsd: 0.0067, wallMs: 4200 } as never,
        final: true,
        at: at(end + 300),
      });
      setJob(j, {
        state: "done",
        finishedAt: now(),
        usage: { calls: 1, in: 1900, cacheWrite: 0, cacheRead: 1800, out: 260, apiUsd: 0.0067 } as never,
        timings: { modelMs: 3600, wallMs: 4200 },
      });
      const m = message(th.id, "agent:claude-cli/claude-sonnet-5-5", "answer", answer, j.id);
      th.messages.push(m);
      emit({ type: "thread.message", message: m });
      touch(th, { state: "answered" });
    });
    return j;
  }
  later(100, () => {
    setJob(j, { state: "preparing", startedAt: now() });
    event(j, { t: "phase", phase: "prepare", detail: `snapshot → refs/mitori/j/${jId}/base · dirty 0`, at: at(100) });
  });
  later(300, () => event(j, { t: "phase", phase: "bundle", detail: "MBF/1 · 2.4k tok · 4 範囲 · router → patch（small_change）", at: at(300) }));
  later(700, () => {
    setJob(j, { state: "running" });
    touch(th, { state: "running" });
    event(j, {
      t: "phase",
      phase: "spawn",
      detail: 'claude -p --setting-sources "" --strict-mcp-config --tools "" --no-session-persistence --output-format stream-json --model claude-sonnet-5-5',
      at: at(700),
    });
  });
  later(900, () => event(j, { t: "phase", phase: "think", detail: "ttft 2.2s · patch/1 を stream で受信", at: at(900) }));
  later(3100, () => event(j, { t: "phase", phase: "apply", detail: "patch/1 · 2 files · 3 hunks を worktree に適用", at: at(3100) }));
  later(3200, () => event(j, { t: "phase", phase: "scope", detail: "2 files ⊂ WRITE · deny glob 0", at: at(3200) }));
  later(3300, () => {
    setJob(j, { state: "gating" });
    event(j, { t: "phase", phase: "gate", at: at(3300) });
  });
  const results: GateResult[] = [];
  for (const g of GATES) {
    later(g.at, () => {
      const status: GateResult["status"] =
        opts.gates === "pass"
          ? "pass"
          : opts.gates === "fail" && g.id === "test:go"
            ? "fail"
            : opts.gates === "untrusted"
              ? "untrusted"
              : opts.gates === "pending"
                ? "pending_consent"
                : "pass";
      const r: GateResult = { gate: g.id, status, ms: g.ms, ...(g.id === "fmt:gofmt" ? { autofixed: true, autofixedLines: 4 } : {}) };
      results.push(r);
      event(j, { t: "gate", gate: r, at: at(g.at) });
    });
  }
  later(6400, () => {
    const diff = diffFor();
    const block = j.anchorBlock;
    const pv: DocProposalView[] = [];
    if (block && blocks.get(block)) {
      const orig = blocks.get(block) as BlockView;
      const ppId = id("pp_");
      const txt = plain(orig.html);
      const p: DocProposalView = {
        id: ppId,
        block: block as `b_${string}`,
        section: orig.section,
        op: "update",
        baseHash: orig.hash,
        md: `${txt.replace("1回だけ", "")} 回数はglobal設定のstory_max_retries（既定1、0〜3に丸める）で決まる。`,
        source: { kind: "job", id: jId },
        reason: "再試行回数を設定にした",
        state: "pending",
        createdAt: now(),
        html: "",
        diffHtml: `<p>${txt.replace("1回だけ", '<del class="d">1回だけ</del>')}<ins class="a">回数はglobal設定の<code>story_max_retries</code>（既定1、0〜3に丸める）で決まる。</ins></p>`,
      };
      proposals.set(ppId, p);
      pv.push(p);
      emit({ type: "doc.proposal.upsert", proposal: p });
    }
    const add = diff.reduce((n, f) => n + f.additions, 0);
    const del = diff.reduce((n, f) => n + f.deletions, 0);
    const passed = results.every((r) => r.status === "pass");
    const failed = results.some((r) => r.status === "fail");
    event(j, {
      t: "result",
      stop: "end",
      structured: {
        summary:
          "generateStoryの1回きりの再試行を、maxRetries回までのループにした。\nConfig.StoryMaxRetries（story_max_retries）とStoryRetries()を追加。未設定は1、0〜3に丸める。\nmergeConfigsには足していないので、agent_cmdと同じくglobal設定でだけ効く。",
      },
      denials: [],
      durationMs: 5600,
      ttftMs: 2200,
      at: at(6400),
    });
    event(j, { t: "phase", phase: "ready", at: at(6450) });
    setJob(j, {
      state: "ready",
      finishedAt: now(),
      gates: results,
      gateVerdict: passed ? "passed" : failed ? "failed" : "unverified",
      sensitive: opts.sensitive,
      diff,
      proposalViews: pv,
      proposals: pv.map((p) => p.id),
      diffStat: { files: diff.length, additions: add, deletions: del, hunks: diff.reduce((n, f) => n + f.hunks.length, 0) },
      usage: { calls: 1, in: 2500, cacheWrite: 0, cacheRead: 620, out: 1200, apiUsd: 0.016 } as never,
      timings: { modelMs: 6000, wallMs: 13100 },
      windowDeltaPct: 1,
      baseRef: `refs/mitori/j/${jId}/base`,
      hunkDecisions: Object.fromEntries(diff.flatMap((f) => f.hunks.map((h) => [h.id, "pending"]))),
    });
    touch(th, { state: "proposed" });
  });
  return j;
}

function accept(j: StoredJob, req: AcceptReq) {
  const hunks = j.diff.flatMap((f) => f.hunks.map((h) => h.id));
  const accepted = req.accept === "all" ? hunks : req.accept;
  if (j.sensitive && req.accept === "all") return err("E_PRECONDITION", 412);
  const ckId = id("ck_");
  const ck: Checkpoint = {
    id: ckId,
    job: j.id,
    ref: `refs/mitori/ck/${ckId}`,
    before: "aaaa",
    after: "bbbb",
    files: j.diff.map((f) => f.path),
    createdAt: now(),
  };
  checkpoints.set(ckId, ck);
  emit({ type: "checkpoint.upsert", checkpoint: ck });
  for (const pId of req.proposals ?? []) {
    const p = proposals.get(pId);
    const b = p?.block ? blocks.get(p.block) : undefined;
    if (p && b) {
      const nb: BlockView = {
        ...b,
        html: `<div class="mb" data-block="${b.id}" data-kind="${b.kind}" data-depth="${b.depth}" data-fresh="fresh" data-lock="human-edited" data-ln="${b.mdLine}"><p>${p.md}</p></div>`,
        hash: `${b.hash}x`,
        proposals: [],
      };
      blocks.set(b.id, nb);
      emit({ type: "doc.block.upsert", block: nb });
      proposals.delete(pId);
      emit({ type: "doc.proposal.removed", id: pId });
    }
  }
  const partial = accepted.length < hunks.length;
  setJob(j, { state: partial ? "partially_accepted" : "accepted", checkpoint: ckId });
  for (const tId of j.threads) {
    const t = threads.get(tId);
    if (t) touch(t, { state: "applied" });
  }
  return json({ kind: "applied", job: jobView(j), checkpoint: ck, files: ck.files, staleThreads: [] });
}

// ---------------------------------------------------------------- review rounds / inbox
function pendingThreads(): StoredThread[] {
  return [...threads.values()].filter((t) => t.state === "open" && (t.intent !== "note" || t.sendToAi));
}
function reviewStatus() {
  return {
    round,
    pending: pendingThreads().map((t) => t.id),
    heldNotes: [...threads.values()].filter((t) => t.state === "open" && t.intent === "note" && !t.sendToAi).map((t) => t.id),
    waitingClients: waiting.clients,
    waitingAgents: waiting.agents,
  };
}

function threadTags(t: StoredThread): InboxFilter[] {
  const tags: InboxFilter[] = [];
  if (t.state === "resolved") return ["resolved"];
  if (["answered", "proposed", "needs_input", "failed"].includes(t.state) || t.anchorHealth === "outdated") tags.push("mine");
  if (t.state === "queued" || t.state === "running") tags.push("working");
  if (t.state === "failed") tags.push("failed");
  if (t.anchorHealth === "outdated") tags.push("outdated");
  if (t.state === "draft") tags.push("draft");
  return tags;
}

function inbox(): InboxItem[] {
  const out: InboxItem[] = [];
  for (const t of threads.values()) {
    if (t.state === "draft" && !t.messages[0]?.body.trim()) continue;
    const b = t.anchor.doc ? blocks.get(t.anchor.doc.block) : undefined;
    out.push({
      kind: "thread",
      id: t.id,
      title: t.title,
      state: t.state,
      displayState: t.anchorHealth === "outdated" ? "outdated" : t.state,
      tags: threadTags(t),
      intent: t.intent,
      anchor: {
        ...(b ? { section: b.section } : {}),
        ...(t.anchor.code
          ? { path: t.anchor.code.path, line: t.anchor.code.start }
          : (() => {
              const c = citesOf(t.anchor.doc?.block ?? null)[0];
              return c ? { path: c.path, line: c.start } : {};
            })()),
      },
      thread: t.id,
      updatedAt: t.updatedAt,
      href: b ? `/w/${WS}/doc/${b.section}#${b.id}` : `/w/${WS}/threads/${t.id}`,
    });
  }
  for (const j of jobs.values()) {
    if (j.state !== "ready" && j.state !== "failed") continue;
    const t = threads.get(j.threads[0] as ThreadId);
    out.push({
      kind: "job",
      id: j.id,
      title: t?.title ?? j.id,
      state: j.state,
      displayState: j.state,
      tags: j.state === "ready" ? ["review", "mine"] : ["failed", "mine"],
      ...(t ? { intent: t.intent } : {}),
      cost: { usd: j.usage?.apiUsd ?? 0, tokens: 3700, estimated: false },
      ...(t ? { thread: t.id } : {}),
      job: j.id,
      updatedAt: j.finishedAt ?? j.createdAt,
      href: `/w/${WS}/review/${j.id}`,
    });
  }
  if (opts.trustPending)
    out.push({ kind: "trust", id: "tr_gates00001", title: "gates", state: "pending", tags: ["mine", "trust"], updatedAt: now(), href: "" });
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

const TRUST: TrustRequest = {
  id: "tr_gates00001",
  item: "gates",
  hash: "9f2c4e1a7b3d5c6e8f0a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6",
  preview: "gofmt -l {files}\ngo vet {pkgs}\ngo test {pkgs} -run {tests}",
  status: "pending",
};

function seed(): void {
  const list = [...original.values()].filter((b) => b.section === "s3" && b.kind === "prose");
  const b0 = list[0];
  const b1 = list[1] ?? b0;
  if (!b0 || !b1) return;
  const q = (b: BlockView) => ({ prefix: "", exact: plain(b.html).slice(0, 18), suffix: "" });
  const mk = (b: BlockView, intent: ThreadIntent, body: string, state: Thread["state"], extra: Partial<StoredThread> = {}) => {
    const t = createThread({ anchor: { primary: "doc", doc: { block: b.id, selStart: 0, selEnd: 18, quote: q(b) } }, intent, body, draft: state === "draft" });
    Object.assign(t, { state, ...extra });
    return t;
  };
  mk(b0, "doc_edit", "「storyの章は8つまで」はingestでも強制される。", "draft", { title: "「8章上限はingestでも強制される」と書き換えた" });
  mk(b1, "note", "ここ、空白圧縮後のオフセットで合ってる？", "open", { anchorHealth: "outdated" });
  const f = mk(b1, "change", "Hirschbergを Myers O(ND) に置き換える", "failed");
  const est = estimateFor(f);
  const fj: StoredJob = {
    id: id("j_"),
    ws: WS,
    kind: "fix",
    threads: [f.id],
    engine: "claude-cli",
    route: est.route,
    state: "failed",
    attempt: 3,
    estimate: est.estimate,
    writeScope: [],
    gates: [],
    proposals: [],
    promptVer: "loop@1",
    createdAt: now(),
    finishedAt: now(),
    failure: {
      code: "E_BUDGET_EXCEEDED",
      message: "input 31.2k > 30k",
      stderrTail: ["go test ./internal/diff: FAIL", "--- FAIL: TestMyers (0.01s)", "exit status 1"],
      actions: ["retry", "narrow_scope", "copy_prompt", "escalate"],
    },
    usage: { calls: 3, in: 31_200, cacheWrite: 0, cacheRead: 0, out: 2000, apiUsd: 0.043 } as never,
    diff: [],
    events: [],
    proposalViews: [],
    anchorBlock: b1.id,
  };
  jobs.set(fj.id, fj);
  f.jobs.push(fj.id);
}

// ---------------------------------------------------------------- routes
async function loopRoute(req: Request, url: URL, body: unknown): Promise<Response | null> {
  const p = url.pathname.replace(/^\/api\/v1/, "");
  const m = req.method;
  if (m === "GET" && p === "/events") {
    let ctrl: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        ctrl = c;
        streams.add(c);
        c.enqueue(enc.encode(":\n\n"));
        seq++;
        c.enqueue(
          enc.encode(
            `id: ${seq}\ndata: ${JSON.stringify({ type: "hello", version: "dev", apiVersion: 1, resumedFrom: null, boot: "boot1", seq, ws: null, rev: null, at: now() })}\n\n`,
          ),
        );
      },
      cancel() {
        streams.delete(ctrl);
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
  }
  const wm = /^\/ws\/(ws_[0-9a-z]+)(\/.*)$/.exec(p);
  if (!wm) return null;
  const rest = wm[2] as string;
  const b = (body ?? {}) as Record<string, unknown>;
  if (m === "GET" && rest === "/threads") return json({ items: [...threads.values()].map(summary), next: null });
  if (m === "POST" && rest === "/threads") {
    await loadBlocks();
    if (opts.latencyMs) await sleep(opts.latencyMs);
    const t = createThread(b as never);
    return json(detail(t));
  }
  const th = /^\/threads\/(th_[0-9a-z]+)(\/[a-z-]+)?$/.exec(rest);
  if (th) {
    const t = threads.get(th[1] as ThreadId);
    if (!t) return err("E_NOT_FOUND", 404);
    const sub = th[2] ?? "";
    if (m === "GET" && sub === "") return json(detail(t));
    if (m === "PATCH" && sub === "") {
      if (typeof b.body === "string" && t.messages[0]) t.messages[0].body = b.body;
      if (typeof b.body === "string") t.title = b.body.split("\n")[0]?.slice(0, 60) ?? "";
      if (b.intent) t.intent = b.intent as ThreadIntent;
      if (typeof b.sendToAi === "boolean") t.sendToAi = b.sendToAi;
      touch(t, {});
      return json(detail(t));
    }
    if (m === "DELETE" && sub === "") {
      threads.delete(t.id);
      emit({ type: "thread.removed", id: t.id });
      return json({ ok: true });
    }
    if (m === "POST" && sub === "/transition") {
      const on = b.on as string;
      const next: Record<string, Thread["state"]> = {
        submit: "open",
        resolve: "resolved",
        reopen: "open",
        reply: t.state === "needs_input" ? "queued" : "open",
        cancel: "open",
      };
      if (typeof b.message === "string" && b.message) t.messages.push(message(t.id, "human", "comment", b.message));
      touch(t, { state: next[on] ?? t.state, ...(on === "resolve" ? { resolution: (b.resolution as Thread["resolution"]) ?? "answered" } : {}) });
      return json(detail(t));
    }
    if (m === "POST" && sub === "/messages") {
      const msg = message(t.id, "human", "comment", String(b.body ?? ""));
      t.messages.push(msg);
      emit({ type: "thread.message", message: msg });
      touch(t, {});
      return json(detail(t));
    }
    if (m === "POST" && sub === "/reanchor") {
      touch(t, { anchor: anchorOf(b.anchor as AnchorInput), anchorHealth: "ok" });
      return json(detail(t));
    }
    if (m === "POST" && sub === "/promote") return json({});
  }
  if (m === "GET" && rest === "/jobs") return json({ items: [...jobs.values()].map(jobView), next: null });
  if (m === "POST" && rest === "/jobs/estimate") {
    if (opts.latencyMs) await sleep(opts.latencyMs);
    const t = threads.get(((b.threads as string[]) ?? [])[0] as ThreadId);
    if (!t) return err("E_NOT_FOUND", 404);
    const ctx = (b.context ?? {}) as { remove?: string[] };
    return json(
      estimateFor(t, {
        ...(b.mode ? { mode: b.mode as never } : {}),
        ...(b.model ? { model: b.model as string } : {}),
        ...(ctx.remove ? { remove: ctx.remove } : {}),
      }),
    );
  }
  if (m === "POST" && rest === "/jobs") {
    const t = threads.get(((b.threads as string[]) ?? [])[0] as ThreadId);
    if (!t) return err("E_NOT_FOUND", 404);
    if (opts.requiresConfirm && !b.confirm) return err("E_PRECONDITION", 412);
    const est = estimateFor(t, { ...(b.mode ? { mode: b.mode as never } : {}) });
    return json(jobView(startJob(t, est)));
  }
  const jm = /^\/jobs\/(j_[0-9a-z]+)(\/[a-z/]+)?$/.exec(rest);
  if (jm) {
    const j = jobs.get(jm[1] as JobId);
    if (!j) return err("E_NOT_FOUND", 404);
    const sub = jm[2] ?? "";
    if (m === "GET" && sub === "") return json({ ...jobView(j), diff: j.diff, proposalViews: j.proposalViews, events: j.events, bundleTokens: 2400 });
    if (m === "GET" && sub === "/events") return json(j.events);
    if (m === "GET" && sub === "/diff") return json(j.diff);
    if (m === "POST" && sub === "/accept") return accept(j, b as unknown as AcceptReq);
    if (m === "POST" && sub === "/reject") {
      setJob(j, { state: "rejected" });
      for (const tId of j.threads) {
        const t = threads.get(tId);
        if (t) touch(t, { state: "rejected" });
      }
      for (const pId of j.proposals) {
        proposals.delete(pId);
        emit({ type: "doc.proposal.removed", id: pId });
      }
      return json(jobView(j));
    }
    if (m === "POST" && sub === "/cancel") {
      for (const tm of timers) clearTimeout(tm);
      setJob(j, { state: "cancelled", finishedAt: now() });
      return json(jobView(j));
    }
    if (m === "POST" && sub === "/commit") return json({ commit: "c0ffee1234567890" });
    if (m === "POST" && sub === "/gates/run") {
      setJob(j, { gates: j.gates.map((g) => ({ ...g, status: "pass" })), gateVerdict: "passed" });
      return json(jobView(j));
    }
    if (m === "POST" && (sub === "/retry" || sub === "/revise")) return json(jobView(j));
  }
  const ck = /^\/checkpoints\/(ck_[0-9a-z]+)\/undo$/.exec(rest);
  if (m === "POST" && ck) {
    const c = checkpoints.get(ck[1] as CheckpointId);
    if (!c) return err("E_NOT_FOUND", 404);
    const j = jobs.get(c.job);
    c.undoneAt = now();
    emit({ type: "checkpoint.upsert", checkpoint: c });
    if (j) {
      setJob(j, { state: "reverted" });
      if (j.anchorBlock && original.has(j.anchorBlock)) {
        const ob = original.get(j.anchorBlock) as BlockView;
        blocks.set(ob.id, ob);
        emit({ type: "doc.block.upsert", block: ob });
      }
      for (const tId of j.threads) {
        const t = threads.get(tId);
        if (t) touch(t, { state: "open" });
      }
    }
    return json({ checkpoint: c, restored: c.files, diverged: [] });
  }
  if (m === "GET" && rest === "/checkpoints") return json([...checkpoints.values()]);
  if (m === "GET" && rest === "/review") return json(reviewStatus());
  if (m === "POST" && rest === "/review/estimate") {
    const list = ((b.threads as string[]) ?? []).map((x) => threads.get(x as ThreadId)).filter(Boolean) as StoredThread[];
    const parts = list.length ? [{ threads: list.map((t) => t.id), kind: "fix", estimate: estimateFor(list[0] as StoredThread) }] : [];
    return json({
      estimateId: id("es_"),
      partitions: parts,
      batchTokens: 3200 * Math.max(1, list.length) - 800 * (list.length - 1),
      separateTokens: 3200 * list.length,
      apiUsd: 0.02 * list.length,
      requiresConfirm: false,
    });
  }
  if (m === "POST" && rest === "/review/finish") {
    const mode = b.mode as "push" | "pull";
    const list = pendingThreads();
    round = { n: (round?.n ?? 0) + 1, mode, state: "dispatched", threads: list.map((t) => t.id), approved: list.length === 0, startedAt: now() };
    emit({ type: "review.round", round });
    const created: Job[] = [];
    for (const t of list) {
      t.batchRound = round.n;
      if (mode === "push") created.push(jobView(startJob(t, estimateFor(t))));
      else touch(t, { state: "queued" });
    }
    return json({ round, jobs: created, savedTokens: 800 });
  }
  if (m === "GET" && rest === "/trust") return json(opts.trustPending ? [TRUST] : []);
  if (m === "POST" && rest.startsWith("/trust/")) {
    opts.trustPending = false;
    return json({ id: TRUST.id, ws: WS, item: "gates", hash: TRUST.hash, decision: b.decision, at: now() });
  }
  if (m === "GET" && rest === "/inbox") {
    await loadBlocks();
    return json({ items: inbox(), next: null });
  }
  if (m === "POST" && rest === "/prompt") return json({ text: `# mitori prompt\n${String(b.ask ?? "")}\n`, tokens: 2300 });
  if (m === "GET" && rest === "/symbols")
    return json(
      [
        {
          key: "internal/config/config.go#Config",
          path: "internal/config/config.go",
          blob: "0",
          kind: "struct",
          name: "Config",
          qualname: "Config",
          start: 45,
          end: 141,
          signature: "type Config struct",
          sigHash: "0",
          bodyHash: "0",
          exported: true,
        },
        {
          key: "cmd/crit/cli_handlers_story.go#generateStory",
          path: "cmd/crit/cli_handlers_story.go",
          blob: "0",
          kind: "function",
          name: "generateStory",
          qualname: "generateStory",
          start: 600,
          end: 690,
          signature: "func generateStory()",
          sigHash: "0",
          bodyHash: "0",
          exported: false,
        },
      ].filter((x) => x.name.toLowerCase().includes((url.searchParams.get("q") ?? "").toLowerCase())),
    );
  const bm = /^\/doc\/blocks\/(b_[0-9a-z]+)(\/edit)?$/.exec(rest);
  if (bm) {
    await loadBlocks();
    const bv = blocks.get(bm[1] as string);
    if (!bv) return null;
    if (m === "GET" && !bm[2] && url.searchParams.get("md")) return json({ ...bv, md: plain(bv.html), mdForm: "file" });
    if (m === "POST" && bm[2]) {
      if (b.baseHash !== bv.hash) return err("E_DOC_BASE_MISMATCH", 409);
      if (b.apply === "doc") {
        const nb: BlockView = {
          ...bv,
          html: `<div class="mb" data-block="${bv.id}" data-kind="${bv.kind}" data-depth="${bv.depth}" data-fresh="fresh" data-lock="human-edited" data-ln="${bv.mdLine}"><p>${String(b.md)}</p></div>`,
          hash: `${bv.hash}e`,
          lock: "human-edited",
        };
        blocks.set(bv.id, nb);
        emit({ type: "doc.block.upsert", block: nb });
        return json({ block: nb, checks: [] });
      }
      const t = createThread({
        anchor: { primary: "doc", doc: { block: bv.id, selStart: 0, selEnd: 10 } },
        intent: "doc_edit",
        body: String(b.md),
        draft: false,
      });
      return json({ thread: summary(t), estimate: estimateFor(t) });
    }
  }
  const pm = /^\/doc\/proposals\/(pp_[0-9a-z]+)\/(accept|reject)$/.exec(rest);
  if (pm && m === "POST") {
    const pp = proposals.get(pm[1] as ProposalId);
    proposals.delete(pm[1] as ProposalId);
    emit({ type: "doc.proposal.removed", id: pm[1] });
    if (pm[2] === "accept" && pp?.block) {
      const bv = blocks.get(pp.block) as BlockView;
      const nb = { ...bv, html: `<div class="mb" data-block="${bv.id}"><p>${pp.md}</p></div>` };
      emit({ type: "doc.block.upsert", block: nb });
      return json(nb);
    }
    return json({ ok: true });
  }
  if (m === "GET" && rest.startsWith("/doc/proposals")) return json([...proposals.values()]);
  return null;
}

async function proxy(req: Request, url: URL, raw: ArrayBuffer | null): Promise<Response> {
  const headers = new Headers(req.headers);
  headers.delete("host");
  // fetch() decodes the body: ask the base mock for identity bytes and pass no encoding on
  headers.delete("accept-encoding");
  const r = await fetch(`${BASE}${url.pathname}${url.search}`, { method: req.method, headers, ...(raw?.byteLength ? { body: raw } : {}) });
  const h = new Headers(r.headers);
  h.delete("content-length");
  h.delete("content-encoding");
  return new Response(r.body, { status: r.status, headers: h });
}

// ---------------------------------------------------------------- server
const base = Bun.spawn(["bun", resolve(ROOT, "e2e/web/support/mock-server.ts"), String(PORT + 1)], { cwd: ROOT, stdout: "ignore", stderr: "inherit" });
process.on("exit", () => base.kill());
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    base.kill();
    process.exit(0);
  });
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(`${BASE}/__mock/log`)).ok) break;
  } catch {
    /* not up yet */
  }
  await sleep(50);
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const raw = req.method !== "GET" && req.method !== "HEAD" ? await req.arrayBuffer() : null;
    let body: unknown;
    if (raw && raw.byteLength > 0) {
      try {
        body = JSON.parse(new TextDecoder().decode(raw));
      } catch {
        body = undefined;
      }
    }
    if (url.pathname === "/__loop/configure") {
      reset((body ?? {}) as Partial<LoopOptions>);
      await fetch(`${BASE}/__mock/configure`, {
        method: "POST",
        body: JSON.stringify((body as { base?: unknown })?.base ?? {}),
        headers: { "content-type": "application/json" },
      });
      original.clear();
      await loadBlocks();
      if (opts.seedInbox) seed();
      return json({ ok: true });
    }
    if (url.pathname === "/__loop/emit") {
      emit(body as never);
      return json({ ok: true, tabs: streams.size });
    }
    if (url.pathname === "/__loop/waiting") {
      waiting = { ...waiting, ...(body as object) };
      emit({ type: "review.waiting", round: (round?.n ?? 0) + 1, clients: waiting.clients, agents: waiting.agents });
      return json({ ok: true });
    }
    if (url.pathname === "/__loop/log") return json(log);
    if (url.pathname === "/__loop/state") return json({ threads: [...threads.values()].map(summary), jobs: [...jobs.values()].map(jobView) });
    if (url.pathname.startsWith("/api/")) {
      log.push({ method: req.method, path: url.pathname + url.search, body, at: Date.now() });
      const r = await loopRoute(req, url, body);
      if (r) return r;
    }
    return proxy(req, url, raw);
  },
});
console.log(`loop mock on http://127.0.0.1:${PORT} (base ${BASE})`);
