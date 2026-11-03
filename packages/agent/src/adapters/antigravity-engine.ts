import {
  type BinaryPin,
  type Cancel,
  type Clock,
  createSecretScanner,
  type EngineStatus,
  type FsReader,
  type GlobalSettings,
  type Hasher,
  type Logger,
  MitoriError,
  priceUsage,
} from "@mitori/core";
import { runProbe } from "../claude/detect.ts";
import { scrubEnv } from "../claude/env.ts";
import { isBareName, resolveOnSafePath } from "../claude/resolve.ts";
import { type ChildHandle, type Engine, type EngineRequest, type EngineRun, SIGINT_GRACE_MS, type Spawner } from "../contract.ts";
import { type FileId, type FollowIo, type FollowPorts, followPinUpdate, sameFileId } from "../follow.ts";
import { RESULT_META, RelayRun, zeroUsage } from "../util/run.ts";
import type { Timers } from "../util/timers.ts";
import {
  AGY_AUTH_URL_RE,
  AGY_AUTHENTICATED_RE,
  AGY_REQUIRED_FLAGS,
  AGY_UNKNOWN_AGENT_RE,
  ANTIGRAVITY_AGENT,
  antigravityCapabilityOk,
  antigravityFoldLine,
  antigravityPricing,
  buildAntigravitySpawn,
  emptyAntigravityTurn,
} from "./antigravity-policy.ts";
import { extractJsonFromText } from "./index.ts";

interface AntigravityDeps {
  spawner: Spawner;
  settings(): GlobalSettings;
  env: Readonly<Record<string, string | undefined>>;
  safePath: string;
  clock: Clock;
  timers: Timers;
  hasher: Hasher;
  fs: FsReader | null;
  // No SandboxStore: the per-call isolated HOME/workdir replaces the shared empty cwd, and the prompt
  // travels on agy stdin (no system-prompt file).
  prepareIsolation(): Promise<{ home: string; work: string; auth: "subscription" | "none"; cleanup(): Promise<void> }>;
  pin?(pin: BinaryPin): Promise<void>;
  /**
   * Vendor-update auto-follow (WP28, WP36b): POSIX ownership + file identity for the re-check, one streamed hash,
   * and workspace roots for the SEC-10 path check. Absent ⇒ a changed binary keeps reporting
   * `E_AGENT_CAPABILITY` (spec §B).
   */
  follow?: FollowPorts;
  /** Daemon log (absent in unit tests). */
  log?: Logger;
}

const enc = new TextEncoder();
const bytes = (text: string) => enc.encode(text).length;

/** Antigravity subscription login is missing; the run-time auth failure guides here too. */
const LOGIN_HINT = "Antigravity にログインしていません。`mitori auth antigravity` の案内に従ってサインインしてください";

/** `agy models` output when nobody is signed in (no LLM is ever called by detect). */
const AGY_UNAUTHENTICATED_RE = /not logged in|not signed in|sign in|authenticate|no auth|login/i;

/** Isolated single-turn text generation via the Antigravity CLI (no agent/patch modes, no tools). */
export function createAntigravityEngine(deps: AntigravityDeps): Engine {
  const cfg = () => deps.settings().engines["antigravity-cli"];
  const secrets = createSecretScanner();
  /** Live spawned children (daemon stop closes them even when the job record is gone, WP36h). */
  const live = new Set<ChildHandle>();
  /** Trust-on-first-use pin of this daemon (until the composition root persists it into settings). */
  let tofu: BinaryPin | undefined;
  /** Latest vendor-update follow of this daemon (shown as 「旧版→新版」; lost on restart, the log keeps it). */
  let lastFollow: { from: string; to: string; at: string } | null = null;
  /** Last follow attempt that failed: the same candidate is not re-probed (WP28b; lost on restart). */
  let failedFollow: { path: string; id: FileId } | null = null;

  /**
   * Follow a vendor update of the pinned binary (WP28 §A, WP36b): the saved `pin.path` re-resolved, SEC-10
   * path + POSIX ownership re-checked, `--version` re-verified like `setup-pin`, and the `--help`
   * capability gate (every flag mitori passes) re-probed. Persists the new pin and returns it with the
   * follow notice, or `null` when any check fails (the caller keeps the `E_AGENT_CAPABILITY` status; §B).
   */
  const tryFollow = async (pin: BinaryPin): Promise<{ pin: BinaryPin; followed: { from: string; to: string; at: string } } | null> => {
    if (!deps.follow || !deps.fs) return null;
    const fs = deps.fs;
    const follow = deps.follow;
    const resolved = fs.realpath(pin.path);
    if (!resolved || resolved === pin.realpath) return null;
    const id = follow.fileId(resolved);
    if (id && failedFollow && failedFollow.path === resolved && sameFileId(failedFollow.id, id)) return null;
    const probeEnv = scrubEnv({ ...deps.env, PATH: deps.safePath }, []);
    const io: FollowIo = {
      realpath: (p) => fs.realpath(p),
      statIsFile: (p) => fs.stat(p)?.isFile === true,
      readText: async (p) => {
        try {
          return new TextDecoder().decode(await fs.read(p));
        } catch {
          return null;
        }
      },
      fileId: (p) => follow.fileId(p),
      sha256File: (p) => follow.sha256File(p),
      ownership: (p) => follow.ownership(p),
      runVersion: async (candidate) => {
        const r = await runProbe(deps.spawner, deps.timers, { command: candidate, argv: ["--version"], env: probeEnv, cwd: "/" });
        if (r.code !== 0 || new TextEncoder().encode(r.out).byteLength > 4096) return null;
        return r.out.split("\n")[0]?.trim() ?? null;
      },
      euid: follow.euid,
      platform: follow.platform,
      workspaceRoots: follow.workspaceRoots(),
      tmpdir: deps.env.TMPDIR,
    };
    const fail = (candidatePath: string | null) => {
      const now = candidatePath ? follow.fileId(candidatePath) : null;
      failedFollow = now && candidatePath ? { path: candidatePath, id: now } : null;
      return null;
    };
    const candidate = await followPinUpdate(pin, io);
    if (!candidate) return fail(resolved);
    // The engine capability gate runs against the new binary: every flag mitori passes must be documented.
    const help = await runProbe(deps.spawner, deps.timers, { command: candidate.realpath, argv: ["--help"], env: probeEnv, cwd: "/" });
    if (help.code !== 0 || new TextEncoder().encode(help.out).byteLength > 65536 || !antigravityCapabilityOk(help.out)) return fail(candidate.realpath);
    failedFollow = null;
    const now = deps.clock.iso();
    const next: BinaryPin = {
      path: pin.path,
      realpath: candidate.realpath,
      sha256: candidate.sha256,
      version: candidate.version,
      pinnedAt: now,
      by: "auto-update",
      previousVersion: pin.version,
    };
    if (deps.pin) {
      try {
        await deps.pin(next);
      } catch {
        return null;
      }
    }
    if (!deps.settings().pins.agy) tofu = next;
    const followed = { from: pin.version, to: candidate.version, at: now };
    lastFollow = followed;
    deps.log?.info("agent.antigravity.auto_follow", { from: pin.version, to: candidate.version, path: pin.path });
    return { pin: next, followed };
  };

  const resolveBinary = (): string | null => {
    if (!deps.fs) return null;
    const name = cfg().binary;
    if (isBareName(name)) return resolveOnSafePath(deps.fs, deps.safePath, name)?.realpath ?? null;
    const real = deps.fs.realpath(name);
    return real && deps.fs.stat(real)?.isFile ? real : null;
  };

  const detect = async (): Promise<EngineStatus> => {
    const problems: EngineStatus["problems"] = [];
    let version = "";
    let path: string | undefined;
    let auth: EngineStatus["auth"] = "none";
    let pin = deps.settings().pins.agy ?? tofu;
    let followed: { from: string; to: string; at: string } | null = null;
    try {
      if (!cfg().enabled) throw new MitoriError("E_AGENT_NOT_INSTALLED", "Antigravity CLI is disabled");
      if (!deps.fs) throw new MitoriError("E_PRECONDITION", "Antigravity filesystem ports are not wired");
      const fs = deps.fs;
      if (pin) {
        path = pin.path;
        const resolved = fs.realpath(pin.path);
        if (!resolved?.startsWith("/") || !fs.stat(resolved)?.isFile)
          throw new MitoriError("E_AGENT_NOT_INSTALLED", "Antigravity native binary was not found on SAFE_PATH");
        if (resolved !== pin.realpath || deps.hasher.sha256(await fs.read(resolved)) !== pin.sha256) {
          const next = await tryFollow(pin);
          if (!next)
            throw new MitoriError("E_AGENT_CAPABILITY", "Antigravity binary changed; repin after human review", {
              hint: "re-register it with the setup command on the engine card (`mitori setup antigravity --cli`)",
            });
          pin = next.pin;
          followed = next.followed;
        }
      } else {
        const bin = resolveBinary();
        if (!bin) throw new MitoriError("E_AGENT_NOT_INSTALLED", "Antigravity native binary was not found on SAFE_PATH");
        path = cfg().binary;
      }
      const bin = pin?.realpath ?? resolveBinary();
      if (!bin) throw new MitoriError("E_AGENT_NOT_INSTALLED", "Antigravity native binary was not found on SAFE_PATH");
      // Probes run under the isolated root too, so even `--version` never touches the user's `~/.gemini`.
      const isolated = await deps.prepareIsolation();
      try {
        const env = { ...scrubEnv({ ...deps.env, PATH: deps.safePath }, []), HOME: isolated.home };
        const ver = await runProbe(deps.spawner, deps.timers, { command: bin, argv: ["--version"], env, cwd: isolated.work });
        version = ver.out.split("\n")[0]?.trim() ?? "";
        if (ver.code !== 0 || !version) throw new MitoriError("E_AGENT_CAPABILITY", "Antigravity binary did not answer --version");
        const gate = AGY_REQUIRED_FLAGS.map((f) => (f === "-p" ? "--print" : f));
        const help = await runProbe(deps.spawner, deps.timers, { command: bin, argv: ["--help"], env, cwd: isolated.work });
        if (help.code !== 0 || !gate.every((f) => help.out.includes(f)))
          throw new MitoriError("E_AGENT_CAPABILITY", "Antigravity binary lacks a flag mitori passes; update mitori for this agy");
        // Login state without calling an LLM: `agy models` lists the effort-suffixed models when signed in.
        const models = await runProbe(deps.spawner, deps.timers, { command: bin, argv: ["models"], env, cwd: isolated.work });
        if (models.code !== 0 || AGY_UNAUTHENTICATED_RE.test(models.out)) throw new MitoriError("E_AGENT_AUTH", LOGIN_HINT);
        auth = isolated.auth === "none" ? "none" : "subscription";
        if (auth === "none") throw new MitoriError("E_AGENT_AUTH", LOGIN_HINT);
      } finally {
        await isolated.cleanup();
      }
    } catch (err) {
      const e = MitoriError.from(err);
      problems.push({ code: e.code, message: e.message });
    }
    const out: EngineStatus = {
      engine: "antigravity-cli",
      installed: !!path && problems.every((p) => p.code === "E_AGENT_AUTH"),
      auth,
      capabilities: [],
      billing: "unknown",
      problems,
      checkedAt: deps.clock.iso(),
      ...(path ? { path, version } : {}),
    };
    if (pin && problems.length === 0) out.pin = pin;
    const notice =
      followed ?? lastFollow ?? (pin?.by === "auto-update" && pin.previousVersion ? { from: pin.previousVersion, to: pin.version, at: pin.pinnedAt } : null);
    if (notice) out.followed = notice;
    return out;
  };

  const run = (req: EngineRequest, signal: Cancel): EngineRun => {
    const outer = new RelayRun(deps.clock);
    void (async () => {
      let prepared: Awaited<ReturnType<AntigravityDeps["prepareIsolation"]>> | null = null;
      let child: ChildHandle | null = null;
      const cleanup = async () => {
        if (!prepared) return;
        const p = prepared;
        prepared = null;
        await p.cleanup();
      };
      try {
        const settings = cfg();
        if (!settings.enabled) throw new MitoriError("E_AGENT_NOT_INSTALLED", "Antigravity CLI is disabled");
        if (!/^antigravity:[^\s]{1,100}$/u.test(req.model))
          throw new MitoriError("E_INVALID_INPUT", "Antigravity requests must name an exact antigravity:<model> id");
        if (req.mode === "agent" || req.mode === "patch")
          throw new MitoriError("E_UNSUPPORTED", "the antigravity engine has no agent or patch mode (text-only)");
        if (req.tools !== "none") throw new MitoriError("E_UNSUPPORTED", "the antigravity engine only accepts text-only requests");
        if (!(req.budget.usd > 0)) throw new MitoriError("E_BUDGET_EXCEEDED", "Antigravity requests need a positive USD budget (unpriced turns reserve it)");
        const status = await detect();
        if (!status.installed || status.problems.length > 0)
          throw new MitoriError(status.problems[0]?.code ?? "E_AGENT_CAPABILITY", status.problems[0]?.message ?? "Antigravity unavailable");
        const bin = status.pin?.realpath ?? resolveBinary();
        if (!bin) throw new MitoriError("E_AGENT_CAPABILITY", "Antigravity binary was not found on SAFE_PATH");
        prepared = await deps.prepareIsolation();
        if (prepared.auth === "none") throw new MitoriError("E_AGENT_AUTH", LOGIN_HINT);
        const spec = buildAntigravitySpawn(
          req,
          settings,
          { agyBinary: bin, home: prepared.home, workdir: prepared.work },
          { ...deps.env, PATH: deps.safePath },
        );
        if (signal.aborted || outer.stopRequested !== null) {
          outer.fail("E_CANCELLED", "cancelled", { cancelled: true });
          return;
        }
        child = deps.spawner.spawn(spec);
        live.add(child);
        const started = deps.clock.now();
        let stopped: "cancel" | "timeout" | null = null;
        let kill: unknown = null;
        const interrupt = (why: "cancel" | "timeout") => {
          if (stopped) return;
          stopped = why;
          try {
            child?.kill("SIGINT");
          } catch {
            /* gone */
          }
          kill = deps.timers.set(() => {
            try {
              child?.kill("SIGKILL");
            } catch {
              /* gone */
            }
          }, SIGINT_GRACE_MS);
        };
        const onAbort = () => interrupt("cancel");
        signal.addEventListener("abort", onAbort, { once: true });
        outer.onStopEarly = () => interrupt("cancel");
        const turn = deps.timers.set(() => interrupt("timeout"), spec.timeoutMs);
        const stderr: string[] = [];
        // An auth URL on stderr means the subscription login is missing: stop at once instead of
        // waiting out the 60 s login wait, and guide to `mitori auth antigravity`.
        let authFailure: string | null = null;
        const errPump = (async () => {
          try {
            for await (const l of child!.stderr) {
              stderr.push(secrets.redact(l).text.slice(0, 1000));
              if (stderr.length > 8) stderr.shift();
              if (authFailure === null && AGY_AUTH_URL_RE.test(l)) {
                authFailure = l.slice(0, 200);
                interrupt("cancel");
              }
            }
          } catch {
            /* stderr closed abruptly */
          }
        })();
        let folded = emptyAntigravityTurn();
        let emitted = 0;
        let readBytes = 0;
        let failure: MitoriError | null = null;
        /** First non-text `step_update` seen (`<step_type>:<tool_name>`), if the turn ran a tool. */
        let toolStop: string | null = null;
        try {
          for await (const line of child.stdout) {
            readBytes += bytes(line);
            if (readBytes > 1024 * 1024) {
              failure = new MitoriError("E_AGENT_PROTOCOL", "agy stdout exceeded 1 MiB");
              interrupt("cancel");
              continue;
            }
            folded = antigravityFoldLine(folded, line);
            // fail-closed (WP40): ANY step outside `user_input`/`agent_response` ran something mitori did
            // not allow — kill the child at once, before later lines run. A tool stop is never retried.
            if (folded.toolStep !== null && failure === null) {
              toolStop = folded.toolStep;
              failure = new MitoriError("E_AGENT_PROTOCOL", `agy がツール "${folded.toolStep.split(":").at(-1)}" を使おうとしたので止めました`);
              interrupt("cancel");
              break;
            }
            if (authFailure !== null) {
              failure = new MitoriError("E_AGENT_AUTH", `${LOGIN_HINT}（${authFailure}）`);
              interrupt("cancel");
              break;
            }
            if ((req.mode === "answer" || req.mode === "generate") && folded.text.length > emitted) {
              outer.events.push({ t: "text", delta: folded.text.slice(emitted), at: deps.clock.now() });
              emitted = folded.text.length;
            }
          }
        } catch (err) {
          failure ??= MitoriError.from(err);
          interrupt("cancel");
        }
        const exit = await child.exited.catch(() => -1);
        await errPump.catch(() => {});
        // The stderr line may arrive after stdout closed: a late auth URL still fails the turn as auth.
        if (failure === null && authFailure !== null) failure = new MitoriError("E_AGENT_AUTH", `${LOGIN_HINT}（${authFailure}）`);
        deps.timers.clear(turn);
        if (kill !== null) deps.timers.clear(kill);
        signal.removeEventListener("abort", onAbort);
        const usage = zeroUsage();
        const modelId = req.model.startsWith("antigravity:") ? req.model.slice("antigravity:".length) : settings.model;
        const pricing = antigravityPricing(settings, modelId);
        if (folded.usage) {
          usage.in = folded.usage.in;
          usage.cacheRead = folded.usage.cacheRead;
          usage.cacheWrite = 0;
          // thinking tokens are billed as output (WP40)
          usage.out = folded.usage.out;
          usage.thinking = folded.usage.thinking;
        } else {
          // No usage event: byte-count estimate like generic (hidden thinking is not visible).
          usage.in = bytes(spec.stdin);
          usage.out = bytes(folded.text);
        }
        if (pricing) {
          try {
            usage.apiUsd = priceUsage(
              req.model,
              { in: usage.in, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: usage.cacheRead, out: usage.out },
              false,
              pricing,
            );
            usage.pricingVer = "antigravity-configured-estimated@1";
          } catch {
            failure ??= new MitoriError("E_AGENT_PROTOCOL", "antigravity configured pricing is invalid");
          }
        } else {
          // Unknown prices reserve the caller's cap, never report a free successful call.
          usage.apiUsd = req.budget.usd;
          usage.pricingVer = "antigravity-unpriced-budget@1";
        }
        // mitori stopped the turn itself (a tool step or the timeout) and agy reported no usage:
        // nothing was spent, so record zero — never a byte estimate. A reported usage is kept.
        if ((toolStop !== null || authFailure !== null || stopped === "timeout") && folded.usage === null) {
          usage.in = 0;
          usage.out = 0;
          usage.apiUsd = 0;
        }
        // The turn never reached the model (no result, no text, no tool ran, exit ≠ 0): record zero.
        const preModel =
          stopped === null &&
          failure === null &&
          folded.usage === null &&
          folded.text === "" &&
          folded.toolStep === null &&
          !folded.ended &&
          (folded.streamError !== null || exit !== 0);
        if (preModel) {
          usage.in = 0;
          usage.out = 0;
          usage.apiUsd = 0;
        }
        const text = toolStop !== null ? "" : folded.text;
        const res = {
          stop: "end",
          usage,
          usageEstimated: !folded.usage,
          text,
          denials: [],
          auth: prepared.auth,
          durationMs: Math.max(0, deps.clock.now() - started),
        } as import("../contract.ts").EngineResult;
        RESULT_META.set(res, { servedBy: req.model, continuations: 0, firstCallIn: bytes(spec.stdin) });
        const tail = (): string[] => stderr.slice(-3).map((l) => secrets.redact(l).text);
        if (failure) {
          res.stop = "error";
          res.error = { code: failure.code, message: failure.message, retryable: false };
        } else if (folded.toolStep !== null) {
          res.stop = "error";
          res.error = { code: "E_AGENT_PROTOCOL", message: `agy executed a forbidden tool in text-only mode: ${folded.toolStep}`, retryable: false };
        } else if ((folded.denied?.length ?? 0) > 0) {
          res.stop = "error";
          res.error = { code: "E_AGENT_PROTOCOL", message: `agy reported denied actions: ${folded.denied?.join(", ")}`, retryable: false };
        } else if (folded.status !== null && folded.status !== "SUCCESS") {
          res.stop = "error";
          if (folded.streamError && AGY_AUTHENTICATED_RE.test(folded.streamError))
            res.error = { code: "E_AGENT_AUTH", message: LOGIN_HINT, retryable: false, stderrTail: tail() };
          else if (folded.streamError && AGY_UNKNOWN_AGENT_RE.test(folded.streamError))
            res.error = {
              code: "E_AGENT_PROTOCOL",
              message: `${folded.streamError.slice(0, 200)} — agy が分離したエージェント定義 "${ANTIGRAVITY_AGENT}" を認識しませんでした。mitori を更新して \`mitori setup antigravity --cli\` をやり直してください`,
              retryable: false,
              stderrTail: tail(),
            };
          else
            res.error = { code: "E_AGENT_EXIT", message: folded.streamError ?? `agy failed with status ${folded.status}`, retryable: true, stderrTail: tail() };
        } else if (stopped === "cancel") res.stop = "cancelled";
        else if (stopped === "timeout") {
          res.stop = "error";
          res.error = { code: "E_AGENT_TIMEOUT", message: `agy が時間内（${Math.round(spec.timeoutMs / 1000)} 秒）に終わりませんでした`, retryable: true };
        } else if (!folded.ended) {
          res.stop = "error";
          const tailLines = tail();
          const unknown =
            tailLines.find((l) => AGY_UNKNOWN_AGENT_RE.test(l)) ??
            (folded.streamError && AGY_UNKNOWN_AGENT_RE.test(folded.streamError) ? folded.streamError : undefined);
          if (unknown)
            res.error = {
              code: "E_AGENT_PROTOCOL",
              message: `${unknown.slice(0, 200)} — agy が分離したエージェント定義 "${ANTIGRAVITY_AGENT}" を認識しませんでした。mitori を更新して \`mitori setup antigravity --cli\` をやり直してください`,
              retryable: false,
              stderrTail: tailLines,
            };
          else
            res.error = {
              code: "E_AGENT_EXIT",
              message: exit !== 0 ? `agy exited with code ${exit} and no terminal result record` : "agy stdout ended without a terminal result record",
              retryable: true,
              stderrTail: tailLines,
            };
        } else if (req.mode === "answer" || req.mode === "generate") res.text = text;
        else {
          const j = extractJsonFromText(text);
          if (j.ok) res.structured = j.value;
          else {
            res.stop = "error";
            res.error = { code: "E_AGENT_PROTOCOL", message: j.error.message, retryable: true };
          }
          res.text = text;
        }
        let cleanupFailed = false;
        try {
          await cleanup();
        } catch {
          cleanupFailed = true;
        }
        if (cleanupFailed) {
          res.stop = "error";
          res.error = { code: "E_AGENT_EXIT", message: "isolated antigravity config cleanup failed", retryable: false };
        }
        if (child) live.delete(child);
        const at = deps.clock.now();
        if (res.error) outer.events.push({ t: "error", code: res.error.code, message: res.error.message, retryable: res.error.retryable, at });
        outer.events.push({ t: "usage", usage: res.usage, final: !!folded.usage, at });
        const done: Extract<import("@mitori/core").JobEvent, { t: "result" }> = { t: "result", stop: res.stop, denials: [], durationMs: res.durationMs, at };
        if (res.structured !== undefined) done.structured = res.structured;
        if (res.text !== undefined) done.text = res.text;
        outer.events.push(done);
        outer.resolve(res);
      } catch (err) {
        if (child) {
          try {
            child.kill("SIGKILL");
          } catch {
            /* gone */
          }
          live.delete(child);
        }
        if (prepared) await prepared.cleanup().catch(() => {});
        const e = MitoriError.from(err);
        outer.fail(e.code, e.message);
      }
    })();
    return outer;
  };

  // Daemon stop (scheduler drain) closes live children the way grok-cli does: SIGINT now
  // (the process group, so grandchildren die too), SIGKILL after the grace period (WP36h).
  const closeAll = async (): Promise<void> => {
    const closing = [...live];
    for (const c of closing) {
      try {
        c.kill("SIGINT");
      } catch {
        /* gone */
      }
      deps.timers.set(() => {
        try {
          c.kill("SIGKILL");
        } catch {
          /* gone */
        }
      }, SIGINT_GRACE_MS);
    }
    await Promise.allSettled(closing.map((c) => c.exited));
  };

  return { id: "antigravity-cli", detect, run, closeAll };
}
