# contracts/testing.md — 実装者が用意するテストヘルパと API

- 版: 1.0 draft（2026-10-03） / 所有: test・eval・bench 担当（WP-12） / 詳細仕様: `docs/design/specs/testing.md`（以下「spec」）
- 状態: **契約**。付録 A の型宣言は `core.ts`・`api.ts`・`indexer.ts`・`gen.ts`・`loop.ts` に対して `tsc@6.0.3`（strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` + `noUnused*`）で 0 エラーを確認済み。付録を `testkit.ts` として contracts に置き `contracts/tsconfig.json` の `files` に足せば同じ検査ができる。
- 変更手続き: ヘルパの削除・意味変更は spec と同時に改訂する。core / api の変更が要るものは §4 の CR として architect に出す（本書は core.ts / api.ts を変えない）。
- 改訂 R1（2026-10-03）: §4 の CR-1〜6 は core / api に適用済み（`contracts/CR-LEDGER.md`）。`Random`・`Metrics`・`METRIC_NAMES`・`UsageRecord.scope.kind "eval"`・`@mitori/testkit`・`HealthRes.build`・`ScanSummaryView.stageMs` が使える。テスト ID の追加・置換は `specs/testing.md` の「改訂 R1」節。

---

## 1. 置き場所と境界

| 置き場所 | 中身 | import してよい場所 |
|---|---|---|
| `testkit/`（workspace `@mitori/testkit`） | 隔離・fixture・truth・golden・cassette store・key・server / daemon 起動・perf・e2e ヘルパ。下の各 `testing` を再 export する | `**/test/**`・`e2e/**`・`bench/**`・`eval/**` だけ |
| `packages/platform/src/testing.ts`（`@mitori/platform/testing`） | `memDb`・`memGitReader`・`createFakeSpawner`・`inlineWorkerPool`・`createFakeClock`・`createTestLogger`・platform conformance のケース | 同上 |
| `packages/agent/src/testing.ts`（`@mitori/agent/testing`） | `createReplaySpawner`・`createTeeSpawner`・`synth`・`createFakeEngine`・`createImmediateScheduler`・`memLedger` | 同上 |
| `packages/server/src/test-hooks.ts` | `/__test/*` ルート（§3-4）。`__MITORI_TEST__` が false のビルドでは DCE で消える | server の composition root だけ |

- **production の `src/**` は `@mitori/testkit` も `@mitori/<pkg>/testing` も import しない**。`scripts/check-boundaries.ts` が検査する（CR-4 で `@mitori/testkit` を `PACKAGE_DEPS` に入れて機械検査にする）。
- `testing.ts` は自パッケージの内部実装を使ってよいが、他パッケージの内部には触れない（公開 `index.ts` か `testing.ts` 経由）。

## 2. 必須ヘルパ一覧（型は付録 A）

### 2.1 隔離・時刻・乱数・ログ

| 名前 | 提供 | 用途 / 守ること |
|---|---|---|
| `testkit/preload.ts` | testkit | bunfig `[test] preload`。spec §1.5 の 8 項目（番兵 `MITORI_HOME`、git の隔離、network guard、spawn guard、seed、console.error の検出 …） |
| `createTestHome()` | testkit | 0700 の一時 `MITORI_HOME` と子プロセス用 env |
| `createFakeClock(start?)` | platform/testing | `Clock` + `advance`/`set`/`setTimeout`。既定の開始時刻 2026-01-01T00:00:00.000Z |
| `seededRandom(seed)` | testkit | core `Random` port の seeded 実装（CR-1 は R1 で適用済み） |
| `createTestLogger()` | platform/testing | 記録 + `assertNoContent()`（200 字超・改行を含む値 = 内容の漏れ） |
| `collectingSink<E>()` | testkit | `EventSink` の記録と `waitFor` |

### 2.2 storage・git・spawn・worker

| 名前 | 提供 | 用途 / 守ること |
|---|---|---|
| `memDb(migrations?)` | platform/testing | bun:sqlite `:memory:`、migration を `(pkg, version)` 順に適用 |
| `memGitReader(files)` | platform/testing | in-memory の `GitReader`（blob id は本物の git blob id） |
| `createFakeSpawner()` | platform/testing | 予約した `ScriptedChild` を返す。**一致しない spawn は例外**（黙って実プロセスを起動しない） |
| `inlineWorkerPool(fn)` | platform/testing | 同一スレッドで動く `WorkerPool` |
| platform conformance | `testkit/conformance/platform.ts` | Bun と Node 22 の両 runner で同じケースを走らせる（spec §4.1） |

### 2.3 fixture・truth

| 名前 | 提供 | 用途 / 守ること |
|---|---|---|
| `fixtures/build.ts` / `buildFixture(name, {step})` | testkit | `mitori.fixture/1` から決定的に構築（固定 author / 日時、`commits.json` と SHA 一致）。`digest()` で「利用者の dir が不変」を検査 |
| `loadTruth(name)` / `scoreIndex(indexer, truth)` | testkit | `mitori.fixture-truth/1` との比較（spec §2.4 の判定表） |
| `indexerFromGolden(name)` | testkit | golden から作る読み取り専用 `Indexer`（gen / loop の unit で parse しない） |
| `fixtures/gen/*.ts` | testkit | `gen:palette-50k`・`gen:doc-1000`・`gen:large-file` の決定的 generator |

### 2.4 golden

| 名前 | 提供 | 用途 / 守ること |
|---|---|---|
| `expectGolden(rel, actual)` | testkit | `fixtures/golden/<rel>` と比較。object は canonical JSON。`MITORI_UPDATE_GOLDEN=1` で書き換え |
| `scripts/golden-guard.ts` | root | golden の変更に版の変更を要求（spec §2.6 の表） |

### 2.5 fake LLM（cassette）

| 名前 | 提供 | 用途 / 守ること |
|---|---|---|
| `normalizeForKey` / `cassetteKey` / `cassetteKeyFromSpawn` | testkit | spec §3.3 の正規化と key。**同じ要求に対して 2 つの key 関数は同じ値**（golden テスト必須） |
| `openCassettes({dirs, mode, maxUsd})` | testkit | `mitori.cassette/1` の読み書き。`CI=true` では mode を `replay` に強制。保存時に secret scan と lean init の検査 |
| `createReplaySpawner(store, opts)` | agent/testing | claude-cli の spawn を cassette で代替（`effect` 行で agent mode の編集も再現）。git・gate は `fallback` へ |
| `createTeeSpawner(real, store, {maxUsd})` | agent/testing | 録画。`maxUsd` 到達で `E_BUDGET_EXCEEDED` |
| `synth.text / genLines / failure` | agent/testing | 手書きシナリオ（spec §3.6 の 15 種） |
| `createFakeEngine({normalizer})` | agent/testing | プロセスなしの `Engine`。**本物の `StreamNormalizer`** に cassette 行を流す |
| `createImmediateScheduler(engines)` / `memLedger()` | agent/testing | 即時実行の scheduler（`setWindow` で 5h 枠を注入）、in-memory ledger |

### 2.6 server・daemon

| 名前 | 提供 | 用途 / 守ること |
|---|---|---|
| `startTestServer(opts)` | testkit | in-process の server（int）。`api`（CLI 扱い）・`asBrowser()`（nonce → cookie、`Sec-Fetch-Site: same-origin`）・`raw()`（Host・ヘッダを自由に）・`sse()` |
| `startTestDaemon(opts)` | testkit | 子プロセスの daemon（e2e・eval）。`login(page)`・`cli()`・`spawnCli()`（blocking `mitori review`）・`metrics()`・`seedDoc` |
| `SseRecorder` | testkit | `waitFor(type, pred)`、`assertMonotonicRev()` |
| `TEST_ROUTES` / `TEST_METRICS` / `TestFault` | testkit（定数）+ server（実装） | §3-4 |

### 2.7 perf

| 名前 | 提供 | 用途 / 守ること |
|---|---|---|
| `measure(id, fn, {runs, warmup})` / `rssPeak(fn)` | testkit | `Samples`（median・p95・cv） |
| `machineFactor()` | testkit | calib workload の比（[0.5, 5]）。spec §6.8 |
| `budget(id)` | testkit | `bench/budgets.json`（`mitori.budgets/1`）の 1 項目 |
| `defineBench({...})` | `bench/harness.ts` | spec §6.2（inproc / process） |

### 2.8 ブラウザ（e2e・UI perf）

| 名前 | 提供 | 用途 / 守ること |
|---|---|---|
| `ui.domNodes / mountedCodeLines / interactions / marks / cls / focusNotObscured / axe / throttleCpu` | testkit（Playwright 上で実装） | spec §5・§6.4・§6.6 |
| `ime.compose / imeKey` | testkit | Chromium は CDP `Input.imeSetComposition`、WebKit は Safari 順序の合成イベント（spec §5.3） |
| `servedBytes(baseUrl, paths, encoding)` | testkit | 実配信バイト（spec §6.5） |
| `PERF_MARKS` | testkit（定数）+ web（発行） | web は**全ビルドで** `performance.mark(name, { detail: { trigger, id } })` を出す。`trigger` は原因になった入力の `event.timeStamp` |

## 3. production コードがテストのために満たすこと

1. 時刻はすべて `Clock`、乱数はすべて `Random`（CR-1。採用までは test ビルドで `MITORI_TEST_SEED` を使う）から取る。`Date.now()`・`Math.random()`・`crypto.getRandomValues` の直接使用は lint で禁止（platform の実装を除く）。
2. `MITORI_HOME` が設定されていれば、cli・server・platform のすべてがそれを `~/.mitori` の代わりに使う。`os.homedir()` からの直接解決は platform の `resolveHome()` だけ。
3. `globalThis.__MITORI_TEST__`（`bun build --compile` では `false` を define）が true のときだけ、server が `/__test/*` を組み込む。bearer 必須・`/api/v1` の外・`ROUTE_META` の対象外。
4. `/__test/*` の意味:
   - `GET /__test/metrics` → `{ counters: Record<TestMetricName, number>, timings: Record<string, { n, p50, p95, max }> }`。counter は daemon 起動からの累計で、bench は scenario 前後の差分を `budgets.json` の `counters` と比べる。
   - `POST /__test/engine { cassetteDirs, speed, maxDtMs, scenario? }` → 以後の claude-cli spawn を ReplaySpawner に切り替える。
   - `POST /__test/clock { advanceMs }` → daemon の `Clock` を進める（Undo トーストの失効、prep の期限、idle unload）。
   - `POST /__test/fault { kind: TestFault, target? }` → 次の 1 回だけ故障を注入する（git 失敗、disk full、engine の異常終了 / hang、SQLite busy、watcher のイベント欠落、worker crash）。
   - `POST /__test/trust-all { ws }` → 当該 workspace の未決 trust を全部 trusted にする（e2e・eval の自動化専用）。
5. claude-cli の spawn は prompt を必ず stdin、system を必ず `--system-prompt-file` で渡す（I2・I3。ReplaySpawner が key を作る前提）。
6. agent mode の worktree の編集は `git diff` で取り出せる状態に保つ（録画の `effect` 行）。
7. web は `PERF_MARKS` を発行し、Vite の chunk 名を `cm6`・`merge`・`diagram`・`shiki`・`mermaid`・`viewer` に固定する。テストビルドの `t()` は欠落キーで `console.error("[i18n-missing] <key>")` を出す。
8. indexer は構造化のパラメータ（`leafMinLoc`・`leafMaxLoc`・`maxDepth`・`fanout`）を注入できる（小さな fixture の module 検査）。
9. 決定的カウンタ `TEST_METRICS` を該当箇所で数える（CR-2 の `Metrics` port 経由。採用まではテストビルドだけの内部カウンタ）。
10. release バイナリは `/__test/`・`ReplaySpawner`・`__MITORI_TEST__` の文字列を含まない（spec §10 AC-9）。

## 4. 必要な core / api の変更（architect への要求）

| ID | 変更 | 理由 |
|---|---|---|
| CR-1 | core §18 に `Random { bytes(n: number): Uint8Array }` と `newId(kind, random)` | golden・cassette の再現（ID・nonce・token） |
| CR-2 | core §18 に `Metrics { inc(name, n?); observe(name, ms) }` と名前表 | 決定的カウンタ、`/__test/metrics`、doctor |
| CR-3 | `UsageRecord.scope.kind` に `"eval"` | eval harness 自身の呼び出しを区別して集計 |
| CR-4 | `PackageName` / `PACKAGE_DEPS` に `"@mitori/testkit"`、ARCHITECTURE §3.3 規則 5 に `testing.ts` subpath | 境界の機械検査 |
| CR-5 | api `ScanSummaryView.stageMs?: Partial<Record<ScanStage, number>>` | bench の段別時間 |
| CR-6 | api `HealthRes.build: "release" \| "test"` | e2e・eval・release smoke の接続先確認 |

## 5. テスト専用フォーマット（製品の `FORMAT` には入れない）

| 形式 | 定義 |
|---|---|
| `mitori.fixture/1` | spec §2.2 |
| `mitori.fixture-truth/1` | spec §2.3–2.4、付録 A `FixtureTruth` |
| `mitori.cassette/1` | spec §3.2–3.3、付録 A `CassetteHeader` / `CassetteLine` |
| `mitori.budgets/1` | spec §6.1、付録 A `BudgetEntry` |
| `mitori.bench-result/1` | spec §6.2 |
| `mitori.quiz/1` | spec §7.3 |
| `mitori.eval-report/1` | spec §7.7 |
| `mitori.review-finding/1` | spec §9.3 |

---

## 付録 A. 型宣言（`testkit.ts`。型検査済み）

```ts
/**
 * @mitori/testkit — public surface (contract snapshot; mirrors docs/design/contracts/testing.md §2).
 * Test-only. Production `src/**` of any package MUST NOT import this module or any `@mitori/<pkg>/testing` subpath.
 */

import type {
  Clock,
  EngineId,
  EventSink,
  ExcludeReason,
  FactKind,
  FileClass,
  GitOid,
  GitReader,
  Iso8601,
  LineNo,
  LogFields,
  Logger,
  Migration,
  RepoPath,
  SourceLang,
  SqlDb,
  SubscriptionWindow,
  SymbolKey,
  SymbolKind,
  UnixMs,
  UsageRecord,
  WorkspaceKey,
  Xxh3,
} from "./core.ts";
import type {
  ApiRoutes,
  RouteKey,
  SseEvent,
  SseEventType,
} from "./api.ts";
import type { Indexer } from "./indexer.ts";
import type { WorkerPool } from "./core.ts"; // R1: WorkerPool moved to core (CONS-26)
import type { GenLine } from "./gen.ts";
import type {
  AgentScheduler,
  Engine,
  EngineRequest,
  ScheduledRequest,
  Spawner,
  SpawnSpec,
  StreamNormalizer,
  UsageLedger,
} from "./loop.ts";

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
export declare function createTestHome(opts?: { keep?: boolean }): Promise<TestHome>;

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
export declare function createFakeClock(start?: Iso8601): FakeClock;

/**
 * Seedable randomness. Replaced by core's `Random` port once CR-1 is accepted
 * (until then production code reads `MITORI_TEST_SEED` in test builds only).
 */
export interface RandomSource {
  /** n random bytes. */
  bytes(n: number): Uint8Array;
}
export declare function seededRandom(seed: string | number): RandomSource;

/** Logger that records lines and fails tests on content leaks (privacy rule, ARCHITECTURE §8.2). */
export interface TestLogger extends Logger {
  /** Recorded lines. */
  readonly lines: readonly { lvl: "debug" | "info" | "warn" | "error"; ns: string; msg: string; fields: LogFields }[];
  /** Throws if any field value has a newline or > 200 chars (file/prompt content) unless `privacy.logContent`. */
  assertNoContent(): void;
}
export declare function createTestLogger(): TestLogger;

/** EventSink that records and can await events. */
export interface CollectingSink<E> extends EventSink<E> {
  /** Recorded events in emit order. */
  readonly events: readonly E[];
  /** Resolve on the first (past or future) event matching `pred`; rejects after `timeoutMs` (default 2000). */
  waitFor(pred: (e: E) => boolean, timeoutMs?: number): Promise<E>;
  /** Forget recorded events. */
  clear(): void;
}
export declare function collectingSink<E>(): CollectingSink<E>;

/* ------------------------------------------------------------ 2. storage/git */

/** bun:sqlite `:memory:` with WAL-equivalent pragmas and the given migrations applied in `(pkg, version)` order. */
export declare function memDb(migrations?: readonly Migration[]): SqlDb;

/** GitReader over an in-memory file map (blob ids = real git blob ids, sha1). */
export declare function memGitReader(files: Readonly<Record<RepoPath, string | Uint8Array>>, opts?: { head?: GitOid | null; branch?: string | null }): GitReader;

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
export declare function createFakeSpawner(opts?: { clock?: Clock }): FakeSpawner;

/** WorkerPool running `fn` in-thread (unit tests; no wasm worker start-up cost). */
export declare function inlineWorkerPool<Req, Res>(fn: (req: Req) => Res | Promise<Res>): WorkerPool<Req, Res>;

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
export declare function buildFixture(name: FixtureName, opts?: { step?: number | "dirty"; into?: string }): Promise<FixtureRepo>;

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
export declare function loadTruth(name: FixtureName): FixtureTruth;

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
export declare function scoreIndex(indexer: Indexer, truth: FixtureTruth): Promise<TruthScore[]>;

/** Read-only Indexer backed by a fixture's golden outputs (gen/loop unit tests without parsing). */
export declare function indexerFromGolden(name: FixtureName): Indexer;

/* ----------------------------------------------------------------- 4. golden */

/**
 * Compare with `fixtures/golden/<rel>`; objects are written as canonical JSON (sorted keys, 2 spaces, LF, trailing LF).
 * With `MITORI_UPDATE_GOLDEN=1` the file is (re)written and the assertion passes.
 */
export declare function expectGolden(rel: string, actual: string | object, opts?: { normalize?: (text: string) => string }): void;

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

/** Normalization applied to system and prompt text before hashing (specs/testing.md §3.3, byte-exact rules). */
export declare function normalizeForKey(text: string, ctx: KeyContext): string;

/** Key from an engine request. MUST equal {@link cassetteKeyFromSpawn} of the SpawnSpec built for the same request. */
export declare function cassetteKey(
  req: Pick<EngineRequest, "model" | "effort" | "tools" | "jsonSchema" | "resume" | "system" | "prompt">,
  engine: EngineId,
  ctx: KeyContext,
): Xxh3;

/** Key from a claude-cli SpawnSpec (argv flags + `--system-prompt-file` content + stdin). */
export declare function cassetteKeyFromSpawn(spec: SpawnSpec, readFile: (path: string) => string, ctx: KeyContext): Xxh3;

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
export declare function openCassettes(opts: { dirs: readonly string[]; mode?: CassetteMode; maxUsd?: number }): CassetteStore;

/** Spawner that serves claude-cli processes from cassettes; non-engine argv (git, gates) go to `fallback`. */
export declare function createReplaySpawner(
  store: CassetteStore,
  opts: {
    /** Key context. */
    keyContext: KeyContext;
    /** Read a file (system prompt file). */
    readFile: (path: string) => string;
    /** 0 = no delays (default), 1 = recorded timing, n = recorded/n. */
    speed?: number;
    /** Cap per-line delay (default 200 ms). */
    maxDtMs?: number;
    /** Scenario router: return a cassette name to bypass exact matching. */
    scenario?: (spec: SpawnSpec) => string | null;
    /** Real spawner for allowed binaries (`git`, gate argv in int tests). */
    fallback?: Spawner;
  },
): Spawner;

/** Spawner that runs the real engine and records (record/auto). Stops spawning once `maxUsd` is reached. */
export declare function createTeeSpawner(real: Spawner, store: CassetteStore, opts: { keyContext: KeyContext; readFile: (path: string) => string; maxUsd: number }): Spawner;

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

/** Synthesizer of claude stream-json cassettes. */
export declare const synth: {
  /** Plain answer text. */
  text(text: string, o?: SynthOptions): Cassette;
  /** `gen.block/1` output; strings are emitted verbatim (malformed-line tests). */
  genLines(lines: readonly (GenLine | string)[], o?: SynthOptions): Cassette;
  /** A failure mode. */
  failure(kind: SynthFailure, o?: SynthOptions): Cassette;
};

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
export declare function createFakeEngine(opts: { id?: EngineId; normalizer: StreamNormalizer; store?: CassetteStore; speed?: number; clock?: Clock }): FakeEngine;

/** Scheduler double: runs submissions immediately (no concurrency/yield) and records them. */
export interface RecordingScheduler extends AgentScheduler {
  /** Submitted requests. */
  readonly submitted: readonly ScheduledRequest[];
  /** Inject a window observation (drives yield logic in callers). */
  setWindow(w: SubscriptionWindow | null): void;
}
export declare function createImmediateScheduler(engines: Partial<Record<EngineId, Engine>>): RecordingScheduler;

/** In-memory ledger. */
export declare function memLedger(): UsageLedger & { readonly rows: readonly UsageRecord[] };

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
export declare function startTestServer(opts?: {
  spawner?: Spawner;
  engines?: Partial<Record<EngineId, Engine>>;
  clock?: Clock;
  random?: RandomSource;
}): Promise<TestServer>;

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
export declare function startTestDaemon(opts: {
  fixture?: FixtureName;
  repoPath?: string;
  /** Pre-seed `.mitori/` from `fixtures/golden/<fixture>/doc-generated/`. */
  seedDoc?: "none" | "static" | "generated";
  cassetteDirs?: readonly string[];
  scenario?: Readonly<Record<string, string>>;
  speed?: number;
  maxDtMs?: number;
  binary?: "source" | "compiled";
  env?: Readonly<Record<string, string>>;
}): Promise<TestDaemon>;

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
export declare function measure(id: string, fn: () => unknown, opts?: { runs?: number; warmup?: number; unit?: Samples["unit"] }): Promise<Samples>;

/** Peak RSS (MB) of the current process sampled every 10 ms while `fn` runs. */
export declare function rssPeak<T>(fn: () => Promise<T>): Promise<{ value: T; peakMb: number }>;

/** runner time / reference time of the calibration workload, clamped to [0.5, 5]. */
export declare function machineFactor(): Promise<number>;

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
export declare function budget(id: string): BudgetEntry;

/* ------------------------------------------------------------ 8. browser e2e */

/** Page helpers (implemented over Playwright `page.evaluate` / CDP). */
export declare const ui: {
  /** `document.getElementsByTagName("*").length`. */
  domNodes(page: PageLike): Promise<number>;
  /** Mounted code lines: `.cm-line` + `pre.mcode .line`. */
  mountedCodeLines(page: PageLike): Promise<number>;
  /** Event Timing entries (durationThreshold 16) grouped by interactionId. */
  interactions(page: PageLike): Promise<readonly { interactionId: number; name: string; duration: number }[]>;
  /** `performance` marks/measures with prefix `mitori:`. */
  marks(page: PageLike, prefix?: string): Promise<readonly { name: string; startTime: number; duration: number }[]>;
  /** Sum of layout-shift values without recent input. */
  cls(page: PageLike): Promise<number>;
  /** Focused element's center is not covered by another element (WCAG 2.4.11). */
  focusNotObscured(page: PageLike): Promise<boolean>;
  /** axe-core run; returns serious/critical violations only. */
  axe(page: PageLike, opts?: { include?: string }): Promise<readonly { id: string; impact: string; nodes: number }[]>;
  /** CDP CPU throttling (Chromium only). */
  throttleCpu(page: PageLike, rate: number): Promise<void>;
};

/** IME simulation. `chromium` uses CDP Input.imeSetComposition; `webkit` dispatches Safari-ordered synthetic events. */
export declare const ime: {
  /** Compose `reading` (kana), then commit as `commit` with Enter (or cancel with Escape). */
  compose(page: PageLike, reading: string, commit: string | null, opts: { order: "chromium" | "webkit"; confirmKey?: "Enter" | "Escape" }): Promise<void>;
  /** Single key while IME is on (keydown key="Process", keyCode=229, code=Key*). */
  imeKey(page: PageLike, code: string): Promise<void>;
};

/** Actually served bytes for asset URLs (no browser). */
export declare function servedBytes(
  baseUrl: string,
  paths: readonly string[],
  encoding: "br" | "gzip",
): Promise<readonly { path: string; bytes: number; contentEncoding: string | null; immutable: boolean; contentType: string }[]>;
```
