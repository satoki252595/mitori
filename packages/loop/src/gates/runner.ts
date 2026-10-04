// The gate runner (spec §7.6.3, ADR-0013): argv only, process group, env = allowlist + fixed offline values, a
// timeout per gate and for the whole phase, format (autofix) → typecheck → test with a stop at the first failure.
// A gate that can execute repository code runs inside the OS sandbox, or — without one — only after the human
// consented (`pending_consent` until `POST /jobs/:job/gates/run`).
import type { Spawner, SpawnSpec } from "@mitori/agent";
import {
  type Cancel,
  type Clock,
  type FsReader,
  type GateResult,
  type GateSpec,
  MitoriError,
  type RepoPath,
  type SafeWriter,
  type SecretScanner,
} from "@mitori/core";
import { runToExit } from "@mitori/platform";
import { GATE_ENV_ALLOWLIST, GATE_ENV_FIXED, GATE_TIMEOUTS, type GateRunner } from "../contract.ts";
import { addedLines } from "../git/diff.ts";
import { relatedTests } from "./checks.ts";
import { dependencyFingerprint, dependencyLinks } from "./deps.ts";
import { excerpt } from "./excerpt.ts";
import { expandGate, filesFor } from "./expand.ts";
import { type LoopbackPolicy, mergeListeners, parseLsofListeners, parseNetstatListeners, type SandboxPaths, sandboxed } from "./sandbox.ts";

/** Ports of the runner. */
export interface GateRunnerDeps {
  /** Spawner. */
  spawner: Spawner;
  /** Reads (autofix detection, sandbox paths). */
  fs: FsReader;
  /** Writes (the job TMPDIR). */
  safeWrite: SafeWriter;
  /** Daemon env (only `GATE_ENV_ALLOWLIST` names are passed on). */
  env: Readonly<Record<string, string | undefined>>;
  /** Absolute realpath of `~/.mitori`. */
  home: string;
  /** Workspace key and root (repo-local gate binaries resolve against the root). */
  ws: { key: string; root: string };
  /** Durations. */
  clock: Clock;
  /** Token estimate for excerpts. */
  estimateTokens: (text: string) => number;
  /** Secret redaction of excerpts. */
  secrets: SecretScanner;
  /**
   * macOS: the ports already bound on loopback / wildcard addresses (ADR-0013 R2), or null when they cannot be listed
   * (then the gate gets no loopback at all). Default: `/usr/sbin/netstat` through the spawner. Tests override it.
   */
  loopbackListeners?: (signal: Cancel) => Promise<LoopbackPolicy | null>;
}

const KIND_ORDER: readonly GateSpec["kind"][] = ["format", "lint", "typecheck", "test", "build", "custom"];
const dec = new TextDecoder();

/** Where a tree's job TMPDIR lives: worktrees `wt/<ws>/<job>` and temp copies `repos/<ws>/tmp/<job>/tree`. */
export function jobTmpOf(home: string, ws: string, tree: string): string {
  const wt = `${home}/wt/${ws}/`;
  if (tree.startsWith(wt)) return `${home}/repos/${ws}/tmp/${tree.slice(wt.length).split("/")[0]}/tmp`;
  const tmp = `${home}/repos/${ws}/tmp/`;
  if (tree.startsWith(tmp)) return `${tmp}${tree.slice(tmp.length).split("/")[0]}/tmp`;
  throw new MitoriError("E_INVALID_INPUT", "gates run only in a job worktree or a job temp tree", { params: { tree } });
}

/** The child env of a gate (CONS-35: `{home}`, `{jobTmp}`, `{ws}` substituted without a shell). */
export function gateEnv(deps: Pick<GateRunnerDeps, "env" | "home" | "ws" | "fs">, jobTmp: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of GATE_ENV_ALLOWLIST) {
    const v = deps.env[k];
    if (typeof v === "string" && v !== "") env[k] = v;
  }
  for (const [k, v] of Object.entries(GATE_ENV_FIXED))
    env[k] = v.replaceAll("{home}", deps.home).replaceAll("{jobTmp}", jobTmp).replaceAll("{ws}", deps.ws.key);
  const venv = `${deps.ws.root}/.venv`;
  if (deps.fs.stat(venv)?.isDir) env.VIRTUAL_ENV = venv;
  return env;
}

async function readText(fs: FsReader, abs: string): Promise<string | null> {
  return fs.stat(abs)?.isFile ? dec.decode(await fs.read(abs)) : null;
}

const NETSTAT = "/usr/sbin/netstat";
const LSOF = "/usr/sbin/lsof";

/**
 * Ports bound on loopback / wildcard addresses of this Mac: `netstat` (every user's sockets — but the kernel shows a
 * Bun- or Node-spawned netstat no sockets at all on macOS 26+) ∪ `lsof` (the user's own processes, ≈ 50–100 ms).
 * Null when neither could run.
 */
export async function hostListeners(deps: Pick<GateRunnerDeps, "spawner" | "fs">, signal: Cancel): Promise<LoopbackPolicy | null> {
  const run = async (command: string, argv: string[], ok: (code: number) => boolean): Promise<string | null> => {
    if (!deps.fs.stat(command)?.isFile) return null;
    const spec: SpawnSpec = { command, argv, env: {}, cwd: "/", stdin: "", keepStdinOpen: false, timeoutMs: 5_000, processGroup: true };
    try {
      const r = await runToExit(deps.spawner, spec, { signal });
      return ok(r.code) && !r.timedOut && !r.cancelled ? r.stdout.join("\n") : null;
    } catch {
      return null;
    }
  };
  const [v4, v6, lsof] = await Promise.all([
    run(NETSTAT, ["-an", "-f", "inet"], (c) => c === 0),
    run(NETSTAT, ["-an", "-f", "inet6"], (c) => c === 0),
    // exit 1 = nothing matched
    run(LSOF, ["-nP", "-w", "-iTCP", "-sTCP:LISTEN", "-iUDP", "-F", "Pn"], (c) => c === 0 || c === 1),
  ]);
  const parts: LoopbackPolicy[] = [];
  if (v4 !== null && v6 !== null) parts.push(parseNetstatListeners(`${v4}\n${v6}`));
  if (lsof !== null) parts.push(parseLsofListeners(lsof));
  return parts.length === 0 ? null : mergeListeners(...parts);
}

/** The daemon's port from `~/.mitori/daemon.json` (the snapshot must contain it). */
async function registryPort(fs: FsReader, home: string): Promise<number | null> {
  try {
    const text = await readText(fs, `${home}/daemon.json`);
    const port = text === null ? null : (JSON.parse(text) as { port?: unknown }).port;
    return typeof port === "number" && Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

/** Build the runner. */
export function createGateRunner(deps: GateRunnerDeps): GateRunner {
  const sandboxPaths = (tree: string, jobTmp: string): SandboxPaths => {
    const userHome = deps.env.HOME ? (deps.fs.realpath(deps.env.HOME) ?? deps.env.HOME) : null;
    return {
      tree,
      jobTmp,
      cargoTarget: `${deps.home}/cache/cargo/${deps.ws.key}`,
      userHome,
      mitoriHome: deps.home,
      claudeEntries: userHome ? (deps.fs.readdir(userHome) ?? []).filter((n) => n.startsWith(".claude")).map((n) => `${userHome}/${n}`) : [],
      // a dangling symlink hides nothing (and bwrap could not mount over it)
      exists: (abs) => deps.fs.realpath(abs) !== null,
      isDir: (abs) => {
        const real = deps.fs.realpath(abs);
        return real !== null && deps.fs.stat(real)?.isDir === true;
      },
      realpath: (abs) => deps.fs.realpath(abs),
    };
  };

  /** Go package patterns of the changed `.go` files, relative to the gate cwd (`./dir`, `.` for the cwd itself). */
  const pkgsOf =
    (cwd: string) =>
    (ps: readonly RepoPath[]): string[] =>
      [
        ...new Set(
          ps.map((p) => {
            const rel = cwd === "" ? p : p.slice(cwd.length + 1);
            const i = rel.lastIndexOf("/");
            return i < 0 ? "." : `./${rel.slice(0, i)}`;
          }),
        ),
      ].sort();

  /** mitori-owned caches a sandboxed gate may write (created first: the sandbox denies creating their parents). */
  async function sandboxCaches(): Promise<{ env: Record<string, string>; dirs: string[] }> {
    const goCache = `${deps.home}/cache/go/${deps.ws.key}`;
    const cargo = `${deps.home}/cache/cargo/${deps.ws.key}`;
    for (const d of [goCache, cargo]) await deps.safeWrite.write(deps.home, `${d.slice(deps.home.length + 1)}/.keep`, "", "home");
    // never the user's own GOCACHE: a poisoned build-cache entry would outlive the job
    return { env: { GOCACHE: goCache }, dirs: [goCache] };
  }

  /**
   * ADR-0013 R2 (macOS): the gate may use loopback, except every port bound before it started and the daemon's port.
   * A snapshot that does not contain the daemon's own listener cannot be trusted to have seen the others: then, and
   * without a snapshot, no loopback at all (the fully closed profile). bwrap needs none: its network namespace is private.
   */
  async function loopbackPolicy(signal: Cancel): Promise<LoopbackPolicy | undefined> {
    const [snapshot, daemon] = await Promise.all([
      (deps.loopbackListeners ?? ((s: Cancel) => hostListeners(deps, s)))(signal),
      registryPort(deps.fs, deps.home),
    ]);
    if (snapshot === null) return undefined;
    if (daemon !== null && !snapshot.tcp.includes(daemon)) return undefined;
    return snapshot;
  }

  async function runOne(
    tree: string,
    gate: GateSpec,
    changed: readonly RepoPath[],
    opts: { consent: boolean; sandbox: "sandbox-exec" | "bwrap" | "none" },
    remainingMs: number,
    signal: Cancel,
  ): Promise<GateResult> {
    const started = deps.clock.now();
    const files = filesFor(gate, changed);
    if (files.length === 0) return { gate: gate.id, status: "skipped", ms: 0 };
    if (gate.executesRepoCode && opts.sandbox === "none" && !opts.consent) return { gate: gate.id, status: "pending_consent", ms: 0 };
    const tests = gate.argvTemplate.some((a) => typeof a !== "string" && a.var === "tests")
      ? relatedTests(gate.cwd, files, (p) => deps.fs.stat(`${tree}/${p}`)?.isFile === true)
      : null;
    // a related-tests gate without related tests has nothing to run (never the whole suite)
    if (tests !== null && tests.length === 0) return { gate: gate.id, status: "skipped", ms: 0 };
    const argv = expandGate(gate, changed, { pkgsOf: pkgsOf(gate.cwd), testsOf: () => tests ?? [] });
    const bin = argv[0] as string;
    argv[0] = bin.includes("/") && !bin.startsWith("/") ? `${deps.ws.root}/${bin}` : bin;
    const cwd = gate.cwd === "" ? tree : `${tree}/${gate.cwd}`;
    const jobTmp = jobTmpOf(deps.home, deps.ws.key, tree);
    await deps.safeWrite.write(deps.home, `${jobTmp.slice(deps.home.length + 1)}/.keep`, "", "home");
    const caches = opts.sandbox === "none" ? { env: {}, dirs: [] as string[] } : await sandboxCaches();
    const loopback = opts.sandbox === "sandbox-exec" ? await loopbackPolicy(signal) : undefined;
    const full = sandboxed(opts.sandbox, { ...sandboxPaths(tree, jobTmp), caches: caches.dirs, ...(loopback ? { loopback } : {}) }, cwd, argv);
    const before = new Map<RepoPath, string | null>();
    if (gate.autofix) for (const p of files) before.set(p, await readText(deps.fs, `${tree}/${p}`));
    // RT-31: without a sandbox a repo-code gate could rewrite the linked dependency trees — fingerprint them around it
    const links = gate.executesRepoCode && opts.sandbox === "none" ? dependencyLinks(deps.fs, tree) : [];
    const depsBefore = links.length > 0 ? dependencyFingerprint(deps.fs, tree, links) : null;
    const spec: SpawnSpec = {
      command: full[0] as string,
      argv: full.slice(1),
      env: { ...gateEnv(deps, jobTmp), ...caches.env },
      cwd,
      stdin: "",
      keepStdinOpen: false,
      timeoutMs: Math.max(1, Math.min(gate.timeoutMs, remainingMs)),
      processGroup: true,
    };
    let r: Awaited<ReturnType<typeof runToExit>> | null = null;
    let spawnError: MitoriError | null = null;
    try {
      // nothing the gate started outlives it: a background job could keep writing into the tree (a symlink to a
      // secret) after the post-gate checks, while the agent's next turn reads it
      r = await runToExit(deps.spawner, spec, { signal, reapGroup: true });
    } catch (e) {
      spawnError = MitoriError.from(e);
    }
    if (depsBefore && dependencyFingerprint(deps.fs, tree, links).hash !== depsBefore.hash) {
      // a tampered dependency tree overrides any gate outcome: the job must not stay acceptable
      throw new MitoriError("E_SCOPE_VIOLATION", `gate ${gate.id} changed a linked dependency tree (${links.join(", ")})`, {
        params: { reason: "dependency_changed", gate: gate.id, links: links.join(","), actions: "copy_prompt" },
      });
    }
    if (r === null) {
      return {
        gate: gate.id,
        status: "error",
        ms: deps.clock.now() - started,
        excerpt: excerpt(spawnError?.message ?? "spawn failed", { worktree: tree, estimateTokens: deps.estimateTokens }, deps.secrets),
      };
    }
    const ms = deps.clock.now() - started;
    const result: GateResult = { gate: gate.id, status: r.code === 0 ? "pass" : "fail", ms };
    if (opts.sandbox !== "none") result.sandboxed = true;
    if (r.cancelled) result.status = "skipped";
    else if (r.timedOut) result.status = "timeout";
    // 126/127: the binary could not run (missing interpreter, not executable) — a warning, not a failure
    else if (r.code === 126 || r.code === 127) result.status = "error";
    if (result.status !== "pass" && result.status !== "skipped") {
      result.excerpt = excerpt([...r.stdout, ...r.stderr].join("\n"), { worktree: tree, estimateTokens: deps.estimateTokens }, deps.secrets);
    }
    if (gate.autofix) {
      let lines = 0;
      for (const p of files) {
        const prev = before.get(p) ?? null;
        const now = await readText(deps.fs, `${tree}/${p}`);
        if (prev !== null && now !== null && prev !== now) lines += Math.max(addedLines(prev, now).length, 1);
      }
      if (lines > 0) {
        result.autofixed = true;
        result.autofixedLines = lines;
      }
    }
    return result;
  }

  return {
    expand: (gate, changed, ctx) => expandGate(gate, changed, ctx),
    async run(worktree, gates, changed, opts, signal) {
      const deadline = deps.clock.now() + GATE_TIMEOUTS.phase;
      const ordered = [...gates].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.id < b.id ? -1 : 1));
      const out: GateResult[] = [];
      let stopped = false;
      for (const gate of ordered) {
        const remaining = deadline - deps.clock.now();
        if (stopped || signal.aborted || remaining <= 0) {
          out.push({ gate: gate.id, status: remaining <= 0 ? "timeout" : "skipped", ms: 0 });
          continue;
        }
        const r = await runOne(worktree, gate, changed, opts, remaining, signal);
        out.push(r);
        // a failing typecheck makes the tests meaningless; a formatter failure (unparsable code) too
        if (r.status === "fail" || r.status === "timeout") stopped = true;
      }
      return out;
    },
  };
}
