/**
 * M0 contract freeze (WP-00a, 2026-10-03): moved from `docs/design/contracts/testing.md 付録 A` (付録 A) — that
 * file stays as the frozen snapshot; THIS file is now the source of truth for @mitori/testkit.
 * - Any change to an exported name or shape is a contract change: weekly CR batch (label `contract-change`),
 *   recorded in `packages/core/CR-LEDGER.md` (architect answers within 48 h).
 * - Declared functions/consts became `E_UNSUPPORTED` stubs in the owning sub-directory; a pointer comment
 *   (// `name` → module) marks each original place. Implement them there; keep the signature.
 */

import type {
  AgentScheduler,
  Engine,
  EngineRequest,
  ScheduledRequest,
  SpawnSpec,
  Spawner,
} from "@mitori/agent";
import type {
  ApiRoutes,
  Clock,
  EngineId,
  EventSink,
  ExcludeReason,
  FactKind,
  FileClass,
  GitOid,
  Iso8601,
  LineNo,
  LogFields,
  Logger,
  RepoPath,
  RouteKey,
  SourceLang,
  SseEvent,
  SseEventType,
  SubscriptionWindow,
  SymbolKey,
  SymbolKind,
  UnixMs,
  WorkspaceKey,
  Xxh3,
} from "@mitori/core";

/* ---------------------------------------------------------------- 0. formats */

/** Test-only artifact formats (not product formats; they never appear in `FORMAT`). */
export const TEST_FORMATS = {
  cassette: "mitori.cassette/1",
  fixture: "mitori.fixture/1",
  fixtureTruth: "mitori.fixture-truth/1",
  budgets: "mitori.budgets/1",
  benchResult: "mitori.bench-result/1",
  quiz: "mitori.quiz/1",
  evalReport: "mitori.eval-report/1",
  finding: "mitori.review-finding/1",
} as const;

/* ------------------------------------------------------- 1. isolation & time */

/** Isolated `MITORI_HOME` (0700) + env for child processes. */
export interface TestHome {
  /** Absolute dir used as `MITORI_HOME`. */
  dir: string;
  /** Env to pass to spawned mitori processes (MITORI_HOME, GIT_CONFIG_*, TZ, LANG, PATH guard). */
  env: Record<string, string>;
  /** Remove (no-op when `MITORI_TEST_KEEP=1`). */
  cleanup(): Promise<void>;
}
// `createTestHome` → ./home/index.ts

/** Controllable clock. Starts at 2026-01-01T00:00:00.000Z unless given. */
export interface FakeClock extends Clock {
  /** Advance by ms (fires due timers registered via `setTimeout`). */
  advance(ms: number): void;
  /** Jump to a time. */
  set(at: Iso8601 | UnixMs): void;
  /** setTimeout replacement bound to this clock (inject where the code under test schedules). */
  setTimeout(fn: () => void, ms: number): number;
  /** clearTimeout replacement. */
  clearTimeout(id: number): void;
}
// `createFakeClock` → ./ports/index.ts

/**
 * Seedable randomness. Replaced by core's `Random` port once CR-1 is accepted
 * (until then production code reads `MITORI_TEST_SEED` in test builds only).
 */
export interface RandomSource {
  /** n random bytes. */
  bytes(n: number): Uint8Array;
}
// `seededRandom` → ./home/index.ts

/** Logger that records lines and fails tests on content leaks (privacy rule, ARCHITECTURE §8.2). */
export interface TestLogger extends Logger {
  /** Recorded lines. */
  readonly lines: readonly { lvl: "debug" | "info" | "warn" | "error"; ns: string; msg: string; fields: LogFields }[];
  /** Throws if any field value has a newline or > 200 chars (file/prompt content) unless `privacy.logContent`. */
  assertNoContent(): void;
}
// `createTestLogger` → ./ports/index.ts

/** EventSink that records and can await events. */
export interface CollectingSink<E> extends EventSink<E> {
  /** Recorded events in emit order. */
  readonly events: readonly E[];
  /** Resolve on the first (past or future) event matching `pred`; rejects after `timeoutMs` (default 2000). */
  waitFor(pred: (e: E) => boolean, timeoutMs?: number): Promise<E>;
  /** Forget recorded events. */
  clear(): void;
}
// `collectingSink` → ./home/index.ts

/* ------------------------------------------------------------ 2. storage/git */

// `memDb` → ./ports/index.ts

// `memGitReader` → ./ports/index.ts

/** Scripted child process served by {@link FakeSpawner}. */
export interface ScriptedChild {
  /** stdout lines. */
  stdout?: readonly string[];
  /** stderr lines. */
  stderr?: readonly string[];
  /** Exit code (default 0). */
  exitCode?: number;
  /** Delay before the first line (FakeClock time). */
  delayMs?: number;
  /** Never exit until killed. */
  hang?: boolean;
}

/** Spawner double for unit tests (git, gates). Unmatched spawns throw (no silent real processes). */
export interface FakeSpawner extends Spawner {
  /** Specs received, in order. */
  readonly calls: readonly SpawnSpec[];
  /** Register a scripted child for specs matching `match` (first registered match wins). */
  script(match: (spec: SpawnSpec) => boolean, child: ScriptedChild | ((spec: SpawnSpec) => ScriptedChild)): FakeSpawner;
}
// `createFakeSpawner` → ./ports/index.ts

// `inlineWorkerPool` → ./ports/index.ts

/* --------------------------------------------------------------- 3. fixtures */

/** Fixture names (see specs/testing.md §2.3). `gen:*` are generated deterministically at build time. */
export type FixtureName =
  | "ts-small"
  | "py-small"
  | "go-small"
  | "rust-small"
  | "mixed"
  | "nongit"
  | "injection"
  | "secrets" // SEC-07 / RT-32 [CR m0-11]
  | "edge-inventory"
  | "doc-roundtrip"
  | "gen:palette-50k"
  | "gen:doc-1000"
  | "gen:large-file";

/** A materialized fixture (deterministic commits: fixed author/committer/date). */
export interface FixtureRepo {
  /** Name. */
  name: FixtureName;
  /** Absolute working-tree root (inside a temp dir). */
  root: string;
  /** False for `nongit`. */
  git: boolean;
  /** Commit ids of `history` steps, oldest first (golden: `fixtures/golden/<name>/commits.json`). */
  commits: readonly GitOid[];
  /** Check out history step `n` (0 = first commit) into the working tree. */
  checkout(step: number): Promise<void>;
  /** Write a file (relative path; traversal rejected). */
  write(path: RepoPath, content: string | Uint8Array): Promise<void>;
  /** xxh3 over (path, mode, bytes) of the whole tree incl. untracked — "user dir unchanged" assertions. */
  digest(): Promise<Xxh3>;
  /** Remove the temp dir. */
  dispose(): Promise<void>;
}
// `buildFixture` → ./fixtures/index.ts

/** One expected fact. `key` derivation per kind is fixed (specs/testing.md §2.4). */
export interface TruthFact {
  /** Kind. */
  kind: FactKind;
  /** Defining file. */
  path: RepoPath;
  /** Defining line (checked when present). */
  line?: LineNo;
  /** Match key, e.g. `GET /api/books` (route), `tsundoku export` (cli), `DATABASE_URL` (env). */
  key: string;
  /** Extra attributes compared exactly (framework, hasDefault, flags, fields, entry, purpose …). */
  attrs?: Readonly<Record<string, string | boolean | readonly string[]>>;
  /** Reported but not gated (e.g. router-prefix composition). */
  stretch?: boolean;
}

/** Hand-written ground truth (`fixtures/repos/<name>/truth.json`). Independent of the implementation. */
export interface FixtureTruth {
  /** Format. */
  v: typeof TEST_FORMATS.fixtureTruth;
  /** Fixture. */
  fixture: FixtureName;
  /** Asserted file classifications. */
  files: readonly { path: RepoPath; class: FileClass; excluded?: ExcludeReason; lang: SourceLang }[];
  /** True when `files` lists every tracked file. */
  filesExhaustive: boolean;
  /** Expected facts (exact set for non-stretch facts). */
  facts: readonly TruthFact[];
  /** Facts that must NOT be detected (false-positive traps). */
  forbiddenFacts: readonly TruthFact[];
  /** Key symbols (subset). */
  symbols: readonly { key: SymbolKey; kind: SymbolKind; start: LineNo; end: LineNo; exported: boolean }[];
  /** Exhaustive resolved in-repo import edges (file → file). */
  imports: readonly { from: RepoPath; to: RepoPath }[];
  /** Expected cross-file references (graded by recall/precision tolerances). */
  calls: readonly { from: SymbolKey; to: SymbolKey }[];
  /** Module partition constraints under the test structure params. */
  modules: { together: readonly (readonly RepoPath[])[]; apart: readonly (readonly [RepoPath, RepoPath])[] };
  /** Tolerances for non-exact categories. */
  tolerances: { callsRecall: number; callsPrecision: number };
}
// `loadTruth` → ./fixtures/index.ts

/** Scored comparison of facts vs truth. */
export interface TruthScore {
  /** Category. */
  category: FactKind | "imports" | "calls" | "symbols" | "files" | "modules";
  /** Precision in [0,1]. */
  precision: number;
  /** Recall in [0,1]. */
  recall: number;
  /** Expected but missing keys. */
  missing: readonly string[];
  /** Detected but not expected (forbidden hits are listed with a `!` prefix). */
  unexpected: readonly string[];
}
// `scoreIndex` → ./fixtures/index.ts

// `indexerFromGolden` → ./fixtures/index.ts

/* ----------------------------------------------------------------- 4. golden */

// `expectGolden` → ./golden/index.ts

/* ---------------------------------------------------------- 5. fake LLM layer */

/** Cassette playback/record mode (`MITORI_CASSETTE`). CI = `replay`. `record`/`auto` need `MITORI_LIVE=1`. */
export type CassetteMode = "replay" | "record" | "auto" | "off";

/** Header line of a `mitori.cassette/1` file. */
export interface CassetteHeader {
  /** Format. */
  v: typeof TEST_FORMATS.cassette;
  /** Request key (16 hex) or `scenario:<name>`. */
  key: string;
  /** How the cassette is selected. */
  match: "exact" | "scenario" | "synthetic";
  /** Engine recorded. */
  engine: EngineId;
  /** CLI version string (`claude --version`). */
  cli?: string;
  /** Full model id. */
  model: string;
  /** Effort. */
  effort: string;
  /** Tool profile. */
  tools: "none" | "read_edit";
  /** Prompt version of the template that produced the request. */
  promptVer?: string;
  /** xxh3 of normalized system / prompt (diagnostics). */
  systemHash: Xxh3;
  /** xxh3 of normalized prompt. */
  promptHash: Xxh3;
  /** Recording time. */
  recordedAt: Iso8601;
  /** Usage from the terminal result (ledger-format). */
  usage: { in: number; cacheWrite: number; cacheWrite1h: number; cacheRead: number; out: number; apiUsd: number };
  /** Engine wall time. */
  durationMs: number;
  /** Time to first token. */
  ttftMs?: number;
  /** Process exit code. */
  exit: number;
}

/** One recorded output line (`dt` = ms since previous line). Exactly one of `line` / `stderr` / `effect`. */
export interface CassetteLine {
  /** Delay since previous line. */
  dt: number;
  /** Raw stdout line (stream-json), byte-exact without trailing LF. */
  line?: string;
  /** Raw stderr line. */
  stderr?: string;
  /** Agent-mode file effect recorded as a unified diff of the worktree; applied to `spec.cwd` on replay. */
  effect?: { kind: "patch"; diff: string };
  /** `after_sigint` lines are emitted only after the replayed child receives SIGINT (recorded cancel tail). */
  phase?: "main" | "after_sigint";
}

/** A cassette in memory. */
export interface Cassette {
  /** Header. */
  header: CassetteHeader;
  /** Lines. */
  lines: readonly CassetteLine[];
}

/** Context for path/nonce normalization in keys. */
export interface KeyContext {
  /** Engine cwd (worktree or empty sandbox). */
  cwd: string;
  /** MITORI_HOME. */
  home: string;
  /** Workspace root. */
  root?: string;
}

// `normalizeForKey` → ./cassette/index.ts

// `cassetteKey` → ./cassette/index.ts

// `cassetteKeyFromSpawn` → ./cassette/index.ts

/** Cassette directory set (search order = array order). */
export interface CassetteStore {
  /** Mode in effect. */
  readonly mode: CassetteMode;
  /** Lookup by exact key. */
  find(key: Xxh3): Cassette | null;
  /** Load a scenario cassette by name (`<suite>/<name>`). */
  load(name: string): Cassette;
  /** Persist (record mode). Refuses when the secret scan or the lean-init check fails. */
  save(c: Cassette, normalizedPrompt: string): Promise<string>;
  /** Cassettes never used in this process (strict mode reports them). */
  unused(): readonly string[];
  /** API-equivalent USD spent by recordings in this process. */
  spentUsd(): number;
}
// `openCassettes` → ./cassette/index.ts

// `createReplaySpawner` → ./cassette/index.ts

// `createTeeSpawner` → ./cassette/index.ts

/** Failure scenarios the synthesizer can produce (specs/testing.md §3.6). */
export type SynthFailure =
  | "rate_limit_429"
  | "refusal"
  | "auth_source_api_key"
  | "truncated_no_result"
  | "hang"
  | "garbage_stdout"
  | "budget_exceeded"
  | "exit_nonzero"
  | "stdin_warning"
  | "permission_denied"
  | "split_multibyte";

/** Options of the stream synthesizer (claude stream-json). */
export interface SynthOptions {
  /** Model in init/result. */
  model?: string;
  /** Session id. */
  sessionId?: string;
  /** `init.apiKeySource` (default "none"). */
  apiKeySource?: string;
  /** Chars per text delta (default 40). */
  chunkChars?: number;
  /** ms between lines (default 10). */
  dtMs?: number;
  /** Result usage (defaults computed from text length via CHARS_PER_TOKEN). */
  usage?: Partial<{ input_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number; output_tokens: number }>;
  /** Emit a rate_limit_event. */
  window?: { fiveHour: number; sevenDay?: number; overage?: boolean };
  /** Structured output (json-schema runs). */
  structured?: unknown;
  /** Permission denials in the result. */
  denials?: readonly { tool: string; target?: string }[];
}

// `synth` → ./cassette/index.ts

/** One rule of the fake engine (first match wins; `times` = how often it may match, default ∞). */
export interface FakeEngineRule {
  /** Predicate over the request. */
  when: (req: EngineRequest) => boolean;
  /** Cassette (replayed through the real StreamNormalizer). */
  reply: Cassette | ((req: EngineRequest, n: number) => Cassette);
  /** Max matches. */
  times?: number;
}

/** Engine double that replays cassettes through the real normalizer (no process). */
export interface FakeEngine extends Engine {
  /** Requests received. */
  readonly requests: readonly EngineRequest[];
  /** Add a rule. */
  on(rule: FakeEngineRule): FakeEngine;
}
// `createFakeEngine` → ./cassette/index.ts

/** Scheduler double: runs submissions immediately (no concurrency/yield) and records them. */
export interface RecordingScheduler extends AgentScheduler {
  /** Submitted requests. */
  readonly submitted: readonly ScheduledRequest[];
  /** Inject a window observation (drives yield logic in callers). */
  setWindow(w: SubscriptionWindow | null): void;
}
// `createImmediateScheduler` → ./cassette/index.ts

// `memLedger` → ./cassette/index.ts

/* ------------------------------------------------------------ 6. server/daemon */

/** Typed caller with raw access for security tests. */
export interface ApiCaller {
  /** Typed call (throws MitoriError on non-2xx). */
  call<K extends RouteKey>(
    key: K,
    args: { params: ApiRoutes[K]["params"]; query?: ApiRoutes[K]["query"]; body?: ApiRoutes[K]["body"]; idempotencyKey?: string },
  ): Promise<ApiRoutes[K]["res"]>;
  /** Raw request (custom Host / Sec-Fetch-Site / content-type / cookies). */
  raw(method: string, path: string, init?: { headers?: Record<string, string>; body?: string }): Promise<Response>;
}

/** SSE recorder. */
export interface SseRecorder {
  /** Events received (envelope included). */
  readonly events: readonly SseEvent[];
  /** Await an event of a type (past or future). */
  waitFor<T extends SseEventType>(type: T, pred?: (e: Extract<SseEvent, { type: T }>) => boolean, timeoutMs?: number): Promise<Extract<SseEvent, { type: T }>>;
  /** Assert `rev` strictly increasing per workspace with no gaps among replayable events. */
  assertMonotonicRev(): void;
  /** Disconnect (optionally reconnect with Last-Event-ID). */
  close(): void;
}

/** Deterministic counters exposed by test builds (`GET /__test/metrics`). */
export const TEST_METRICS = [
  "idx.parse.calls",
  "idx.files.hashed",
  "idx.files.stat",
  "idx.sql.writes",
  "doc.render.calls",
  "doc.render.cacheHits",
  "doc.flush.files",
  "gen.engine.calls",
  "gen.cache.hits",
  "loop.bundle.builds",
  "agent.spawns",
  "agent.spawns.real",
  "srv.requests",
  "srv.sse.events",
  "srv.writequeue.ops",
] as const;
/** Counter name. */
export type TestMetricName = (typeof TEST_METRICS)[number];

/** Test-only daemon routes (outside `/api/v1`; compiled only when `__MITORI_TEST__`; bearer required). */
export const TEST_ROUTES = {
  /** Counters + timing summaries. */
  metrics: "GET /__test/metrics",
  /** Switch engines to replay: `{ cassetteDirs, speed, maxDtMs, scenario? }`. */
  engine: "POST /__test/engine",
  /** Offset the daemon clock: `{ advanceMs }`. */
  clock: "POST /__test/clock",
  /** Inject a fault once: `{ kind: TestFault, target? }`. */
  fault: "POST /__test/fault",
  /** Trust every pending trust request of a workspace (eval/e2e automation only). */
  trustAll: "POST /__test/trust-all",
} as const;

/** Injectable faults. */
export type TestFault = "git_fail" | "disk_full" | "engine_exit" | "engine_hang" | "sqlite_busy" | "watch_drop" | "worker_crash";

/** In-process server (integration tests). */
export interface TestServer {
  /** `http://127.0.0.1:<port>`. */
  url: string;
  /** Bearer token. */
  token: string;
  /** Home. */
  home: TestHome;
  /** CLI-kind caller (bearer + `x-mitori-client: cli/test`). */
  api: ApiCaller;
  /** Browser-kind caller (nonce → cookie, `Sec-Fetch-Site: same-origin`). */
  asBrowser(): Promise<ApiCaller>;
  /** SSE recorder. */
  sse(ws?: WorkspaceKey): SseRecorder;
  /** Open a fixture as a workspace and wait for `scan.done`. */
  openWorkspace(repo: FixtureRepo): Promise<WorkspaceKey>;
  /** Counters. */
  metrics(): Promise<Partial<Record<TestMetricName, number>>>;
  /** Stop and drain. */
  close(): Promise<void>;
}
// `startTestServer` → ./server/index.ts

/**
 * Performance marks the web app emits in ALL builds (`performance.mark(name, { detail })`).
 * `detail.trigger` = `event.timeStamp` of the user input that caused it (absent for non-user work),
 * so latency = `mark.startTime - detail.trigger`.
 */
export const PERF_MARKS = [
  "mitori:shell:painted",
  "mitori:map:painted",
  "mitori:toc:painted",
  "mitori:facts:painted",
  "mitori:block:first",
  "mitori:section:rendered",
  "mitori:level:applied",
  "mitori:palette:results",
  "mitori:shortcut:handled",
  "mitori:composer:opened",
  "mitori:card:optimistic",
  "mitori:job:ready",
  "mitori:review:diff-mounted",
  "mitori:undo:applied",
  "mitori:stale:badge",
] as const;
/** Mark name. */
export type PerfMark = (typeof PERF_MARKS)[number];
/** `detail` payload of a mark. */
export interface PerfMarkDetail {
  /** Triggering input `event.timeStamp`. */
  trigger?: number;
  /** Related id (section, block, job, query id). */
  id?: string;
}

/** Minimal structural page type (keeps this contract free of Playwright types). */
export interface PageLike {
  /** Navigate. */
  goto(url: string): Promise<unknown>;
}

/** Subprocess daemon for e2e/eval (source build `bun run apps/cli/src/main.ts _serve` or the compiled binary). */
export interface TestDaemon {
  /** Base URL. */
  url: string;
  /** Bearer token. */
  token: string;
  /** Home. */
  home: TestHome;
  /** Fixture, when opened from one. */
  repo?: FixtureRepo;
  /** Workspace key of the opened repo. */
  ws?: WorkspaceKey;
  /** Log the page in (nonce URL) and navigate to `path`. */
  login(page: PageLike, path?: string): Promise<void>;
  /** Run the CLI against this daemon (same MITORI_HOME); cwd defaults to the repo root. */
  cli(args: readonly string[], opts?: { stdin?: string; timeoutMs?: number; cwd?: string }): Promise<{ code: number; stdout: string; stderr: string; ms: number }>;
  /** Start a long-running CLI process (e.g. blocking `mitori review`). */
  spawnCli(args: readonly string[], opts?: { cwd?: string }): { stdout: () => string; stderr: () => string; exited: Promise<number>; kill(): void };
  /** Counters. */
  metrics(): Promise<Partial<Record<TestMetricName, number>>>;
  /** Stop (`mitori stop`, then SIGKILL after 10 s). */
  stop(): Promise<void>;
}
// `startTestDaemon` → ./server/index.ts

/* ------------------------------------------------------------------ 7. perf */

/** Sample set of one measurement. */
export interface Samples {
  /** Budget id (`bench/budgets.json`). */
  id: string;
  /** Unit. */
  unit: "ms" | "s" | "MB" | "KB" | "B" | "tokens" | "count" | "ratio" | "pct" | "usd";
  /** Raw values. */
  values: readonly number[];
  /** Median. */
  median: number;
  /** 95th percentile (nearest-rank). */
  p95: number;
  /** Coefficient of variation (stdev / mean). */
  cv: number;
}
// `measure` → ./perf/index.ts

// `rssPeak` → ./perf/index.ts

// `machineFactor` → ./perf/index.ts

/** One `bench/budgets.json` entry. */
export interface BudgetEntry {
  /** Id. */
  id: string;
  /** Human description (ja). */
  metric: string;
  /** Target (green ≤ target, or ≥ for `dir: "min"`). */
  target: number;
  /** Limit (red beyond). */
  limit: number;
  /** Unit. */
  unit: Samples["unit"];
  /** Better direction. */
  dir: "max" | "min";
  /** Gates applied. */
  gates: readonly ("relative" | "absolute" | "structural" | "golden" | "eval" | "contract" | "counter")[];
  /** Owning package/spec. */
  owner: string;
  /** `<file>#<case>` that measures it. */
  measure: string;
  /** Scale absolute time limits by machineFactor on non-reference runners. */
  scale: "machine" | "none";
  /** Provisional value (to be confirmed by measurement). */
  provisional: boolean;
}
// `budget` → ./perf/index.ts

/* ------------------------------------------------------------ 8. browser e2e */

// `ui` → ./browser/index.ts

// `ime` → ./browser/index.ts

// `servedBytes` → ./browser/index.ts
