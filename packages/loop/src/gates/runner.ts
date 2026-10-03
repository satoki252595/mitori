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
import { type SandboxPaths, sandboxed } from "./sandbox.ts";

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
      exists: (abs) => deps.fs.stat(abs) !== null,
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
    const full = sandboxed(opts.sandbox, { ...sandboxPaths(tree, jobTmp), caches: caches.dirs }, cwd, argv);
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
      r = await runToExit(deps.spawner, spec, { signal });
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
