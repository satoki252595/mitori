/**
 * @mitori/agent/testing — test-only helpers (fakes, conformance cases). Importable only from tests
 * (`*.test.ts`, `test/` dirs), bench, eval, e2e and @mitori/testkit; never from production sources
 * (scripts/check-boundaries.ts enforces it). Owner: WP-05.
 *
 * Implements the fake-LLM layer of the testkit contract §5 (CR m0-6: the testkit re-exports these once WP-05 lands):
 * cassette keys, the cassette store, ReplaySpawner / TeeSpawner, `synth`, FakeEngine, the immediate scheduler and the
 * in-memory ledger — plus the small ports the agent tests need (fake clock, seeded random, hasher, memory fs/db).
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type Cancel,
  type Clock,
  canonicalJson,
  createSecretScanner,
  type EngineId,
  type EngineStatus,
  type EventSink,
  type FsReader,
  type FsStat,
  type GitOid,
  type Hasher,
  type Iso8601,
  type LogFields,
  type Logger,
  type Metrics,
  MitoriError,
  type SafeWriter,
  type SqlDb,
  type SqlParams,
  type SubscriptionWindow,
  type UsageRecord,
  type WriteQueue,
  type Xxh3,
} from "@mitori/core";
import { assembleBridge } from "./bridge/assemble.ts";
import { AGENT_MIGRATIONS } from "./bridge/index.ts";
import { expectedTools } from "./claude/engine.ts";
import type { BridgeFs } from "./claude/fsports.ts";
import { ClaudeProc } from "./claude/process.ts";
import type {
  AgentScheduler,
  ChildHandle,
  Engine,
  EngineRequest,
  EngineRun,
  EngineSession,
  ScheduledRequest,
  Spawner,
  SpawnSpec,
  StreamNormalizer,
} from "./contract.ts";
import {
  type Cassette,
  type CassetteHeader,
  type CassetteLine,
  cassetteScript,
  type KeyContext,
  normalizeForKeyWith,
  synthCassette,
} from "./fakes/cassette.ts";
import { createFakeSpawner, type ScriptedChild, type ScriptLine, scriptedChild } from "./fakes/child.ts";
import { createFakeClock, type FakeClock } from "./fakes/clock.ts";
import { testSettings } from "./fakes/settings.ts";
import { createUsageLedger, type UsageLedgerImpl } from "./ledger/ledger.ts";
import { Channel } from "./util/channel.ts";
import { timersFor } from "./util/timers.ts";

export { helpFlags, helpProblems, parseAuthStatus, REQUIRED_FLAGS } from "./claude/detect.ts";
export { expectedTools } from "./claude/engine.ts";
export type { Cassette, CassetteHeader, CassetteLine, KeyContext, SynthFailure, SynthOptions } from "./fakes/cassette.ts";
export { createFakeSpawner, type FakeChild, type FakeSpawner, type ScriptedChild, type ScriptLine, scriptedChild } from "./fakes/child.ts";
export { createFakeClock, type FakeClock, seededRandom } from "./fakes/clock.ts";
export { TEST_CLAUDE_PIN, testSettings } from "./fakes/settings.ts";

/* ---------------------------------------------------------------- ports */

/** Hasher over Bun's xxh3 / sha256 (platform's real Hasher is the same algorithm). */
export const testHasher: Hasher = {
  xxh3: (d) => Bun.hash.xxHash3(d).toString(16).padStart(16, "0") as Xxh3,
  sha256: (d) => new Bun.CryptoHasher("sha256").update(d).digest("hex"),
  gitBlob: (d, algo) => new Bun.CryptoHasher(algo).update(`blob ${d.length}\0`).update(d).digest("hex") as GitOid,
};

/** Recorded log line. */
export interface LogLine {
  lvl: "debug" | "info" | "warn" | "error";
  ns: string;
  msg: string;
  fields: LogFields;
}

export function createTestLogger(): Logger & { readonly lines: LogLine[] } {
  const lines: LogLine[] = [];
  const make = (ns: string): Logger => ({
    debug: (msg, fields = {}) => lines.push({ lvl: "debug", ns, msg, fields }),
    info: (msg, fields = {}) => lines.push({ lvl: "info", ns, msg, fields }),
    warn: (msg, fields = {}) => lines.push({ lvl: "warn", ns, msg, fields }),
    error: (msg, fields = {}) => lines.push({ lvl: "error", ns, msg, fields }),
    child: (n) => make(ns ? `${ns}.${n}` : n),
  });
  return Object.assign(make(""), { lines });
}

export function collectingSink<E>(): EventSink<E> & { readonly events: E[] } {
  const events: E[] = [];
  return { events, emit: (e) => events.push(e) };
}

export const nullMetrics: Metrics & { readonly counts: Record<string, number> } = (() => {
  const counts: Record<string, number> = {};
  return { counts, inc: (n, k = 1) => (counts[n] = (counts[n] ?? 0) + k), observe: () => {} };
})();

/** Metrics that count (fresh per test). */
export function countingMetrics(): Metrics & { readonly counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  return { counts, inc: (n, k = 1) => (counts[n] = (counts[n] ?? 0) + k), observe: () => {} };
}

/** Synchronous write queue (runs `fn` immediately). */
export const immediateWrite: WriteQueue = async (_label, fn) => fn();

/** bun:sqlite `:memory:` with the agent migrations (`use_*`). */
export function memStateDb(): SqlDb {
  const db = new Database(":memory:");
  const wrap: SqlDb = {
    exec: (sql) => db.exec(sql),
    run: (sql, params?: SqlParams) => {
      const r = db.query(sql).run(...((params === undefined ? [] : [params]) as []));
      return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) };
    },
    all: <T>(sql: string, params?: SqlParams) => db.query(sql).all(...((params === undefined ? [] : [params]) as [])) as T[],
    get: <T>(sql: string, params?: SqlParams) => (db.query(sql).get(...((params === undefined ? [] : [params]) as [])) as T | null) ?? null,
    tx: <T>(fn: () => T) => db.transaction(fn)(),
    close: () => db.close(),
  };
  for (const m of AGENT_MIGRATIONS) wrap.exec(m.up);
  return wrap;
}

/** In-memory ledger (the real one over `:memory:`). */
export function memLedger(clock: Clock = createFakeClock()): UsageLedgerImpl & { readonly rows: readonly UsageRecord[] } {
  const db = memStateDb();
  const ledger = createUsageLedger({
    db,
    stateWrite: immediateWrite,
    random: { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)) },
    clock,
    log: createTestLogger(),
  });
  return Object.defineProperty(ledger, "rows", {
    get: () => db.all<{ record: string }>("SELECT record FROM use_ledger ORDER BY rowid").map((r) => JSON.parse(r.record) as UsageRecord),
  }) as UsageLedgerImpl & { readonly rows: readonly UsageRecord[] };
}

/** In-memory SafeWriter + FsReader (system prompt files, the empty sandbox). */
export function memFs(): BridgeFs & { readonly files: Map<string, Uint8Array>; readonly dirs: Set<string>; readonly writes: { path: string; kind: string }[] } {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  const writes: { path: string; kind: string }[] = [];
  const enc = new TextEncoder();
  const addDirs = (p: string) => {
    for (let d = dirname(p); d !== "/" && d !== "."; d = dirname(d)) dirs.add(d);
  };
  const st = (isFile: boolean, size: number): FsStat => ({ size, mtimeNs: 0n, ino: 0n, isFile, isDir: !isFile, isSymlink: false });
  const safeWrite: SafeWriter = {
    async write(root, rel, bytes, kind) {
      if (rel.includes("..") || rel.startsWith("/")) throw new MitoriError("E_PATH_OUTSIDE", "bad path");
      const p = join(root, rel);
      files.set(p, typeof bytes === "string" ? enc.encode(bytes) : bytes);
      addDirs(p);
      writes.push({ path: p, kind });
    },
    async remove(root, rel) {
      const p = join(root, rel);
      files.delete(p);
      for (const f of [...files.keys()]) if (f.startsWith(`${p}/`)) files.delete(f);
      for (const d of [...dirs]) if (d === p || d.startsWith(`${p}/`)) dirs.delete(d);
    },
  };
  const fs: FsReader = {
    stat: (abs) => (files.has(abs) ? st(true, files.get(abs)?.length ?? 0) : dirs.has(abs) ? st(false, 0) : null),
    read: async (abs) => {
      const f = files.get(abs);
      if (!f) throw new MitoriError("E_NOT_FOUND", abs);
      return f;
    },
    readHead: async (abs, n) => (files.get(abs) ?? new Uint8Array()).slice(0, n),
    realpath: (abs) => (files.has(abs) || dirs.has(abs) ? abs : null),
    readdir: (abs) => {
      if (!dirs.has(abs)) return null;
      const names = new Set<string>();
      for (const p of [...files.keys(), ...dirs]) if (p.startsWith(`${abs}/`)) names.add(p.slice(abs.length + 1).split("/")[0] as string);
      return [...names];
    },
  };
  return { safeWrite, fs, files, dirs, writes };
}

/* ------------------------------------------------------------- cassettes */

const TMP_REAL = (() => {
  try {
    return realpathSync(tmpdir());
  } catch {
    return null;
  }
})();

/** Normalization applied to system and prompt text before hashing (specs/testing.md §3.3, byte-exact rules). */
export function normalizeForKey(text: string, ctx: KeyContext): string {
  return normalizeForKeyWith(text, ctx, TMP_REAL);
}

const keyOf = (parts: readonly string[]): Xxh3 => testHasher.xxh3(parts.join("\x1f"));
const schemaHash = (schema: unknown): string => (schema === undefined ? "-" : testHasher.xxh3(canonicalJson(schema)));

/** Key from an engine request. Equals {@link cassetteKeyFromSpawn} of the SpawnSpec built for the same request. */
export function cassetteKey(
  req: Pick<EngineRequest, "model" | "effort" | "tools" | "jsonSchema" | "resume" | "system" | "prompt">,
  engine: EngineId,
  ctx: KeyContext,
): Xxh3 {
  return keyOf([
    "mitori.cassette/1",
    engine,
    req.model,
    req.effort,
    req.tools,
    schemaHash(req.jsonSchema),
    req.resume ? "resume" : "-",
    normalizeForKey(req.system, ctx),
    normalizeForKey(req.prompt, ctx),
  ]);
}

const argAfter = (argv: readonly string[], flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

/** The prompt text of a stream-json stdin line. */
export function promptOfStdin(stdin: string): string {
  const first = stdin.split("\n")[0] ?? "";
  try {
    const c = (JSON.parse(first) as { message?: { content?: unknown } }).message?.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) return c.map((b) => (b as { text?: string }).text ?? "").join("");
  } catch {
    // not stream-json
  }
  return stdin;
}

/** Key from a claude-cli SpawnSpec (argv flags + `--system-prompt-file` content + stdin). */
export function cassetteKeyFromSpawn(spec: SpawnSpec, readFile: (path: string) => string, ctx: KeyContext): Xxh3 {
  const a = spec.argv;
  const tools = argAfter(a, "--tools");
  const schema = argAfter(a, "--json-schema");
  const sp = argAfter(a, "--system-prompt-file");
  return keyOf([
    "mitori.cassette/1",
    "claude-cli",
    argAfter(a, "--model") ?? "",
    argAfter(a, "--effort") ?? "",
    tools === undefined || tools === "" ? "none" : "read_edit",
    schema === undefined ? "-" : schemaHash(JSON.parse(schema)),
    a.includes("--resume") ? "resume" : "-",
    normalizeForKey(sp === undefined ? "" : readFile(sp), ctx),
    normalizeForKey(promptOfStdin(spec.stdin), ctx),
  ]);
}

export type CassetteMode = "replay" | "record" | "auto" | "off";

export interface CassetteStore {
  readonly mode: CassetteMode;
  find(key: Xxh3): Cassette | null;
  load(name: string): Cassette;
  save(c: Cassette, normalizedPrompt: string): Promise<string>;
  unused(): readonly string[];
  spentUsd(): number;
}

/** A replay miss (key, the recording command). */
export class CassetteMissError extends Error {
  constructor(readonly key: string) {
    super(`cassette miss: ${key} — re-record with MITORI_CASSETTE=record MITORI_LIVE=1`);
    this.name = "CassetteMissError";
  }
}

export function parseCassette(text: string): Cassette {
  const [head, ...rest] = text.split("\n").filter((l) => l.length > 0);
  if (!head) throw new MitoriError("E_FORMAT_INVALID", "empty cassette");
  const header = JSON.parse(head) as CassetteHeader;
  if (header.v !== "mitori.cassette/1") throw new MitoriError("E_FORMAT_INVALID", `not a cassette: ${header.v}`);
  return { header, lines: rest.map((l) => JSON.parse(l) as CassetteLine) };
}

export const serializeCassette = (c: Cassette): string => `${[c.header, ...c.lines].map((x) => JSON.stringify(x)).join("\n")}\n`;

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (n.endsWith(".cassette.jsonl")) out.push(p);
  }
  return out;
}

/** Lean-init + secret checks before a recording is kept (testing spec §3.5). */
export function sanitizeCassette(c: Cassette): void {
  const scanner = createSecretScanner();
  for (const l of c.lines) {
    const text = l.line ?? l.stderr ?? l.effect?.diff ?? "";
    if (scanner.scan(text).length > 0) throw new MitoriError("E_SECRET_DETECTED", "a recorded line contains a secret");
    if (l.line?.includes('"subtype":"init"')) {
      const init = JSON.parse(l.line) as { apiKeySource?: string; mcp_servers?: unknown[]; skills?: unknown[] };
      if (init.apiKeySource !== "none" || (init.mcp_servers?.length ?? 0) > 0 || (init.skills?.length ?? 0) > 0) {
        throw new MitoriError("E_AGENT_CAPABILITY", "not a lean recording (apiKeySource/mcp/skills)");
      }
    }
  }
}

export function openCassettes(opts: { dirs: readonly string[]; mode?: CassetteMode; maxUsd?: number }): CassetteStore {
  const env = process.env;
  const mode: CassetteMode = env.CI === "true" ? "replay" : (opts.mode ?? (env.MITORI_CASSETTE as CassetteMode | undefined) ?? "replay");
  const byKey = new Map<string, string>();
  for (const d of opts.dirs) for (const p of walk(d)) byKey.set(p.slice(p.lastIndexOf("/") + 1, -".cassette.jsonl".length), p);
  const used = new Set<string>();
  let spent = 0;
  const read = (p: string): Cassette => {
    used.add(p);
    return parseCassette(readFileSync(p, "utf8"));
  };
  return {
    mode,
    find: (key) => {
      const p = byKey.get(key);
      return p ? read(p) : null;
    },
    load: (name) => {
      for (const d of opts.dirs) {
        const p = join(d, `${name}.cassette.jsonl`);
        if (existsSync(p)) return read(p);
      }
      throw new CassetteMissError(`scenario:${name}`);
    },
    async save(c, normalizedPrompt) {
      if (mode === "replay" || mode === "off") throw new MitoriError("E_PRECONDITION", `cassette store is in ${mode} mode`);
      sanitizeCassette(c);
      const dir = opts.dirs[0];
      if (!dir) throw new MitoriError("E_PRECONDITION", "no cassette dir");
      mkdirSync(dir, { recursive: true });
      const p = join(dir, `${c.header.key}.cassette.jsonl`);
      writeFileSync(p, serializeCassette(c));
      writeFileSync(join(dir, `${c.header.key}.prompt.txt`), normalizedPrompt);
      byKey.set(c.header.key, p);
      used.add(p);
      spent += c.header.usage.apiUsd;
      return p;
    },
    unused: () => [...new Set(byKey.values())].filter((p) => !used.has(p)),
    spentUsd: () => spent,
  };
}

const isClaudeStream = (spec: SpawnSpec): boolean => spec.argv.includes("-p") && argAfter(spec.argv, "--output-format") === "stream-json";

/** Put `$CWD` / `$MITORI_HOME` / `$HOME` back to the current values (recordings store placeholders). */
function restorePaths(c: Cassette, spec: SpawnSpec, ctx: KeyContext): Cassette {
  const home = process.env.HOME ?? "";
  const fix = (s: string) => s.split("$CWD").join(spec.cwd).split("$MITORI_HOME").join(ctx.home).split("$HOME").join(home);
  return { header: c.header, lines: c.lines.map((l) => (l.line === undefined ? l : { ...l, line: fix(l.line) })) };
}

function applyEffect(cwd: string, diff: string): void {
  const r = Bun.spawnSync(["git", "apply", "--whitespace=nowarn", "-"], { cwd, stdin: new TextEncoder().encode(diff), env: { PATH: process.env.PATH ?? "" } });
  if (r.exitCode !== 0) throw new MitoriError("E_PATCH_APPLY", `cassette effect did not apply: ${r.stderr.toString().slice(0, 200)}`);
}

/** Spawner that serves claude-cli processes from cassettes; non-engine argv (git, gates) go to `fallback`. */
export function createReplaySpawner(
  store: CassetteStore,
  opts: {
    keyContext: KeyContext;
    readFile: (path: string) => string;
    speed?: number;
    maxDtMs?: number;
    scenario?: (spec: SpawnSpec) => string | null;
    fallback?: Spawner;
  },
): Spawner & { readonly calls: readonly SpawnSpec[] } {
  const calls: SpawnSpec[] = [];
  return {
    calls,
    spawn(spec: SpawnSpec): ChildHandle {
      calls.push(spec);
      if (!isClaudeStream(spec)) {
        if (opts.fallback) return opts.fallback.spawn(spec);
        throw new MitoriError("E_UNSUPPORTED", `replay spawner: ${spec.command} is not an engine process and no fallback is set`);
      }
      const name = opts.scenario?.(spec) ?? null;
      const key = name === null ? cassetteKeyFromSpawn(spec, opts.readFile, opts.keyContext) : `scenario:${name}`;
      const c = name === null ? store.find(key) : store.load(name);
      if (!c) throw new CassetteMissError(key);
      const restored = restorePaths(c, spec, opts.keyContext);
      const script = cassetteScript(restored);
      const effects = restored.lines.filter((l) => l.effect);
      if (effects.length > 0) {
        // effects run in recorded order, right before the next stdout line
        const lines: ScriptLine[] = [];
        for (const l of restored.lines) {
          if (l.effect) {
            const diff = l.effect.diff;
            lines.push({ dt: l.dt, run: () => applyEffect(spec.cwd, diff) });
          } else if (l.line !== undefined) lines.push({ line: l.line, dt: l.dt, phase: l.phase ?? "main" });
          else if (l.stderr !== undefined) lines.push({ stderr: l.stderr, dt: l.dt, phase: l.phase ?? "main" });
        }
        script.lines = lines;
      }
      const sopts: { speed?: number; maxDtMs?: number } = {};
      if (opts.speed !== undefined) sopts.speed = opts.speed;
      if (opts.maxDtMs !== undefined) sopts.maxDtMs = opts.maxDtMs;
      return scriptedChild(spec, script, sopts);
    },
  };
}

/** Spawner that runs the real engine and records (record/auto). Stops spawning once `maxUsd` is reached. */
export function createTeeSpawner(
  real: Spawner,
  store: CassetteStore,
  opts: { keyContext: KeyContext; readFile: (path: string) => string; maxUsd: number },
): Spawner {
  return {
    spawn(spec: SpawnSpec): ChildHandle {
      if (!isClaudeStream(spec)) return real.spawn(spec);
      if (store.spentUsd() >= opts.maxUsd) throw new MitoriError("E_BUDGET_EXCEEDED", "cassette recording budget reached");
      const child = real.spawn(spec);
      const lines: CassetteLine[] = [];
      let last = performance.now();
      let sigint = false;
      const dt = () => {
        const n = performance.now();
        const d = Math.round(n - last);
        last = n;
        return d;
      };
      const out = new Channel<string>();
      const err = new Channel<string>();
      const outPump = (async () => {
        for await (const l of child.stdout) {
          lines.push(sigint ? { dt: dt(), line: l, phase: "after_sigint" } : { dt: dt(), line: l });
          out.push(l);
        }
        out.close();
      })();
      const errPump = (async () => {
        for await (const l of child.stderr) {
          lines.push({ dt: dt(), stderr: l });
          err.push(l);
        }
        err.close();
      })();
      const exited = child.exited.then(async (code) => {
        await Promise.all([outPump, errPump]); // every line is in before the cassette is written
        const key = cassetteKeyFromSpawn(spec, opts.readFile, opts.keyContext);
        const result = [...lines].reverse().find((l) => l.line?.includes('"type":"result"'));
        const r = result?.line
          ? (JSON.parse(result.line) as { usage?: Record<string, number>; total_cost_usd?: number; duration_ms?: number; ttft_ms?: number })
          : null;
        const u = r?.usage ?? {};
        const header: CassetteHeader = {
          v: "mitori.cassette/1",
          key,
          match: "exact",
          engine: "claude-cli",
          model: argAfter(spec.argv, "--model") ?? "",
          effort: argAfter(spec.argv, "--effort") ?? "",
          tools: (argAfter(spec.argv, "--tools") ?? "") === "" ? "none" : "read_edit",
          systemHash: testHasher.xxh3(normalizeForKey(readSafe(opts.readFile, argAfter(spec.argv, "--system-prompt-file")), opts.keyContext)),
          promptHash: testHasher.xxh3(normalizeForKey(promptOfStdin(spec.stdin), opts.keyContext)),
          recordedAt: new Date().toISOString() as Iso8601,
          usage: {
            in: u.input_tokens ?? 0,
            cacheWrite: u.cache_creation_input_tokens ?? 0,
            cacheWrite1h: 0,
            cacheRead: u.cache_read_input_tokens ?? 0,
            out: u.output_tokens ?? 0,
            apiUsd: r?.total_cost_usd ?? 0,
          },
          durationMs: r?.duration_ms ?? 0,
          exit: code,
        };
        if (r?.ttft_ms !== undefined) header.ttftMs = r.ttft_ms;
        const scrub = (s: string) => s.split(spec.cwd).join("$CWD").split(opts.keyContext.home).join("$MITORI_HOME");
        const c: Cassette = { header, lines: lines.map((l) => (l.line === undefined ? l : { ...l, line: scrub(l.line) })) };
        await store.save(
          c,
          `=== system ===\n${normalizeForKey(readSafe(opts.readFile, argAfter(spec.argv, "--system-prompt-file")), opts.keyContext)}\n=== prompt ===\n${normalizeForKey(promptOfStdin(spec.stdin), opts.keyContext)}\n`,
        );
        return code;
      });
      return {
        pid: child.pid,
        stdout: out,
        stderr: err,
        exited,
        write: (t) => child.write(t),
        closeStdin: () => child.closeStdin(),
        kill: (s) => {
          if (s === "SIGINT") sigint = true;
          child.kill(s);
        },
      };
    },
  };
}

const readSafe = (read: (p: string) => string, p: string | undefined): string => {
  if (p === undefined) return "";
  try {
    return read(p);
  } catch {
    return "";
  }
};

/** Synthesizer of claude stream-json cassettes (+ `turns` for resident multi-turn scenarios). */
export const synth = synthCassette;

/* ------------------------------------------------------------ fake engine */

export interface FakeEngineRule {
  when: (req: EngineRequest) => boolean;
  reply: Cassette | ((req: EngineRequest, n: number) => Cassette);
  times?: number;
}

export interface FakeEngine extends Engine {
  readonly requests: readonly EngineRequest[];
  on(rule: FakeEngineRule): FakeEngine;
}

/**
 * Engine double that replays cassettes through the real normalizer and turn runner (no process). `normalizer` may be a
 * factory; an instance is ignored after the first run because a normalizer belongs to one process.
 */
export function createFakeEngine(opts: {
  id?: EngineId;
  normalizer?: StreamNormalizer | ((req: EngineRequest) => StreamNormalizer);
  store?: CassetteStore;
  speed?: number;
  clock?: Clock;
}): FakeEngine {
  const rules: (FakeEngineRule & { used: number })[] = [];
  const requests: EngineRequest[] = [];
  const clock = opts.clock ?? createFakeClock();
  const log = createTestLogger();
  const self: FakeEngine = {
    id: opts.id ?? "claude-cli",
    requests,
    on(rule) {
      rules.push({ ...rule, used: 0 });
      return self;
    },
    async detect(): Promise<EngineStatus> {
      return { engine: self.id, installed: true, auth: "subscription", capabilities: [], billing: "subscription-window", problems: [], checkedAt: clock.iso() };
    },
    run(req: EngineRequest, signal: Cancel): EngineRun {
      requests.push(req);
      const rule = rules.find((r) => r.when(req) && (r.times === undefined || r.used < r.times));
      if (rule) rule.used++;
      const cassette = rule ? (typeof rule.reply === "function" ? rule.reply(req, rule.used) : rule.reply) : null;
      const spec: SpawnSpec = {
        command: "/fake/claude",
        argv: ["-p"],
        env: {},
        cwd: req.cwd,
        stdin: "",
        keepStdinOpen: req.keepAlive,
        timeoutMs: 600_000,
        processGroup: true,
      };
      const spawner = createFakeSpawner(opts.speed === undefined ? {} : { speed: opts.speed }).script(
        () => true,
        cassette ? cassetteScript(cassette) : { lines: [{ stderr: "no fake engine rule matched" }], exitCode: 1 },
      );
      const meta: ConstructorParameters<typeof ClaudeProc>[2] = {
        mode: req.mode,
        model: req.model as "claude-sonnet-5-5",
        expect: { subscription: true, tools: expectedTools(req), model: req.model as "claude-sonnet-5-5" },
        estimateInTokens: 0,
        countsAsResident: false,
      };
      if (req.mode === "agent") meta.worktree = req.cwd;
      const proc = new ClaudeProc(
        {
          spawner,
          clock,
          timers: timersFor(clock),
          log,
          metrics: countingMetrics(),
          secrets: createSecretScanner(),
          stopFraction: () => 0.8,
          newId: () => `fk_${requests.length}`,
        },
        spec,
        meta,
      );
      return proc.beginTurn("{}\n", req.budget, { firstLineMs: 600_000, idleMs: 600_000, turnMs: 600_000 }, signal, !req.keepAlive);
    },
  };
  return self;
}

/* ------------------------------------------------------- immediate scheduler */

export interface RecordingScheduler extends AgentScheduler {
  readonly submitted: readonly ScheduledRequest[];
  setWindow(w: SubscriptionWindow | null): void;
}

/** Scheduler double: runs submissions immediately (no concurrency/yield) and records them. */
export function createImmediateScheduler(engines: Partial<Record<EngineId, Engine>>): RecordingScheduler {
  const submitted: ScheduledRequest[] = [];
  let window: SubscriptionWindow | null = null;
  const listeners = new Set<(s: ReturnType<AgentScheduler["status"]> & { window: SubscriptionWindow | null }) => void>();
  const status = (): ReturnType<AgentScheduler["status"]> => ({
    concurrency: 3,
    effective: 3,
    running: 0,
    queued: 0,
    yielding: false,
    reservedInteractive: 1,
    lanePaused: { interactive: null, doc: null, background: null },
    resident: { procs: 0, rssMb: 0 },
  });
  return {
    submitted,
    setWindow(w) {
      window = w;
      for (const cb of listeners) cb({ ...status(), window });
    },
    submit(req, signal) {
      submitted.push(req);
      const e = engines[req.engine];
      if (!e) throw new MitoriError("E_AGENT_NOT_INSTALLED", `no engine ${req.engine}`);
      return e.run(req, signal);
    },
    continueSession(session: EngineSession, prompt, req, signal) {
      return session.continue(prompt, req.budget, signal);
    },
    prewarm() {},
    status,
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    window: () => window,
    async drain() {},
  };
}

/* ---------------------------------------------------------- test bridge */

export interface TestBridge {
  scheduler: AgentScheduler;
  engines: Record<EngineId, Engine | null>;
  ledger: UsageLedgerImpl & { readonly rows: readonly UsageRecord[] };
  fs: ReturnType<typeof memFs>;
  clock: FakeClock;
  log: ReturnType<typeof createTestLogger>;
  events: ReturnType<typeof collectingSink<import("@mitori/core").SseEventPayload>>;
  metrics: ReturnType<typeof countingMetrics>;
  home: string;
}

/** The real bridge over fakes: memory fs/ledger, fake clock (virtual timers), the given spawner. */
export function createTestBridge(opts: {
  spawner: Spawner;
  /** Overrides (deep-merged) or a mutator of the full settings object. */
  settings?: Parameters<typeof testSettings>[0] | ((s: ReturnType<typeof testSettings>) => void);
  env?: Record<string, string | undefined>;
  clock?: FakeClock;
  fetch?: (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<Response>;
}): TestBridge {
  const clock = opts.clock ?? createFakeClock();
  const fs = memFs();
  const ledger = memLedger(clock);
  const log = createTestLogger();
  const events = collectingSink<import("@mitori/core").SseEventPayload>();
  const metrics = countingMetrics();
  const settings = testSettings(typeof opts.settings === "function" ? {} : (opts.settings ?? {}));
  if (typeof opts.settings === "function") opts.settings(settings);
  const home = "/home/u/.mitori";
  fs.dirs.add(`${home}/run/empty`);
  const extra: Parameters<typeof assembleBridge>[0] = {
    random: { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)) },
    metrics,
    safePath: "/usr/bin:/bin",
    settings: () => settings,
    spawner: opts.spawner,
    ledger,
    log,
    clock,
    hasher: testHasher,
    events,
    home,
    env: opts.env ?? { HOME: "/home/u", PATH: "/usr/bin:/bin", USER: "u" },
    safeWrite: fs.safeWrite,
    fs: fs.fs,
  };
  if (opts.fetch) extra.fetch = opts.fetch;
  const { scheduler, engines } = assembleBridge(extra);
  return { scheduler, engines, ledger, fs, clock, log, events, metrics, home };
}

/** Lines of a recording in `fixtures/agent-streams/` (raw stream-json). */
export function loadAgentStream(name: string, root = join(import.meta.dir, "../../../fixtures/agent-streams")): string[] {
  return readFileSync(join(root, `${name}.jsonl`), "utf8")
    .split("\n")
    .filter((l) => l.length > 0);
}

/** A scripted child from raw recorded lines (`$CWD` restored). */
export function streamChild(lines: readonly string[], cwd: string, extra: Partial<ScriptedChild> = {}): ScriptedChild {
  return { lines: lines.map((l) => ({ line: l.split("$CWD").join(cwd) })), ...extra };
}
