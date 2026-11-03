import {
  type Cancel,
  type Clock,
  createSecretScanner,
  type EngineStatus,
  type FsReader,
  type GlobalSettings,
  type Hasher,
  type JobEvent,
  type Logger,
  MitoriError,
  priceUsage,
} from "@mitori/core";
import { runProbe } from "../claude/detect.ts";
import { scrubEnv } from "../claude/env.ts";
import type { SandboxStore } from "../claude/fsports.ts";
import { isBareName, resolveOnSafePath } from "../claude/resolve.ts";
import { type ChildHandle, type Engine, type EngineRequest, type EngineRun, SIGINT_GRACE_MS, type Spawner } from "../contract.ts";
import { RESULT_META, RelayRun, zeroUsage } from "../util/run.ts";
import type { Timers } from "../util/timers.ts";
import { buildGrokSpawn, emptyGrokTurn, GROK_UNAUTHENTICATED_RE, grokFoldLine, grokPricing } from "./grok-policy.ts";
import { extractJsonFromText } from "./index.ts";

interface GrokDeps {
  spawner: Spawner;
  settings(): GlobalSettings;
  env: Readonly<Record<string, string | undefined>>;
  safePath: string;
  clock: Clock;
  timers: Timers;
  hasher: Hasher;
  fs: FsReader | null;
  sandbox: SandboxStore;
  prepareConfig(): Promise<{ root: string; auth: "subscription" | "api-key" | "none"; cleanup(): Promise<void> }>;
  /** Daemon log (absent in unit tests). */
  log?: Logger;
}

const enc = new TextEncoder();
const bytes = (text: string) => enc.encode(text).length;

/** `grok models` output when nobody is signed in (no LLM is ever called by detect). */
const LOGIN_HINT = "Grok is not logged in; run `grok login` in a terminal, then re-check";

/** Isolated single-turn text generation via the Grok Build CLI (no agent/patch modes, no tools). */
export function createGrokEngine(deps: GrokDeps): Engine {
  const cfg = () => deps.settings().engines["grok-cli"];
  const secrets = createSecretScanner();

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
    try {
      if (!cfg().enabled) throw new MitoriError("E_AGENT_NOT_INSTALLED", "Grok CLI is disabled");
      if (!deps.fs) throw new MitoriError("E_PRECONDITION", "Grok filesystem ports are not wired");
      const bin = resolveBinary();
      if (!bin) throw new MitoriError("E_AGENT_NOT_INSTALLED", "Grok native binary was not found on SAFE_PATH");
      path = cfg().binary;
      // Probes run under the isolated root too, so even `--version` never touches the user's `~/.grok`.
      const isolated = await deps.prepareConfig();
      try {
        const env = { ...scrubEnv({ ...deps.env, PATH: deps.safePath }, []), HOME: isolated.root, GROK_HOME: isolated.root };
        const ver = await runProbe(deps.spawner, deps.timers, { command: bin, argv: ["--version"], env, cwd: "/" });
        version = ver.out.split("\n")[0]?.trim() ?? "";
        if (ver.code !== 0 || !version) throw new MitoriError("E_AGENT_CAPABILITY", "Grok binary did not answer --version");
        // Login state without calling an LLM: `grok models` lists models when signed in.
        const models = await runProbe(deps.spawner, deps.timers, { command: bin, argv: ["models"], env, cwd: "/" });
        if (models.code !== 0 || GROK_UNAUTHENTICATED_RE.test(models.out)) throw new MitoriError("E_AGENT_AUTH", LOGIN_HINT);
        auth = isolated.auth === "none" ? "subscription" : isolated.auth;
      } finally {
        await isolated.cleanup();
      }
    } catch (err) {
      const e = MitoriError.from(err);
      problems.push({ code: e.code, message: e.message });
    }
    return {
      engine: "grok-cli",
      installed: !!path && problems.every((p) => p.code === "E_AGENT_AUTH"),
      auth,
      capabilities: [],
      billing: "unknown",
      problems,
      checkedAt: deps.clock.iso(),
      ...(path ? { path, version } : {}),
    };
  };

  const run = (req: EngineRequest, signal: Cancel): EngineRun => {
    const outer = new RelayRun(deps.clock);
    void (async () => {
      let prepared: Awaited<ReturnType<GrokDeps["prepareConfig"]>> | null = null;
      let child: ChildHandle | null = null;
      const cleanup = async () => {
        if (!prepared) return;
        const p = prepared;
        prepared = null;
        await p.cleanup();
      };
      try {
        const settings = cfg();
        if (!settings.enabled) throw new MitoriError("E_AGENT_NOT_INSTALLED", "Grok CLI is disabled");
        if (!/^grok:[^\s]{1,100}$/u.test(req.model)) throw new MitoriError("E_INVALID_INPUT", "Grok requests must name an exact grok:<model> id");
        if (req.mode === "agent" || req.mode === "patch") throw new MitoriError("E_UNSUPPORTED", "the grok engine has no agent or patch mode (text-only)");
        if (req.tools !== "none") throw new MitoriError("E_UNSUPPORTED", "the grok engine only accepts text-only requests");
        if (!(req.budget.usd > 0)) throw new MitoriError("E_BUDGET_EXCEEDED", "Grok requests need a positive USD budget (unpriced turns reserve it)");
        const status = await detect();
        if (!status.installed || status.problems.length > 0)
          throw new MitoriError(status.problems[0]?.code ?? "E_AGENT_CAPABILITY", status.problems[0]?.message ?? "Grok unavailable");
        const bin = resolveBinary();
        if (!bin) throw new MitoriError("E_AGENT_CAPABILITY", "Grok binary was not found on SAFE_PATH");
        prepared = await deps.prepareConfig();
        if (prepared.auth === "none") throw new MitoriError("E_AGENT_AUTH", LOGIN_HINT);
        const emptyCwd = await deps.sandbox.ensureEmptyCwd();
        const contract = req.jsonSchema === undefined ? "" : `\n\nReply with one JSON object matching this schema:\n${JSON.stringify(req.jsonSchema)}`;
        const promptText = `Text-only request: do not call tools, read/write files, run commands, delegate, or start reminders. Use only the supplied context and return the requested text/JSON directly. Paths identify proposed edits; do not access them.\n\n${req.system}\n\n${(req.promptBlocks ?? [req.prompt]).join("\n\n")}${contract}`;
        const spec = buildGrokSpawn(
          req,
          settings,
          { grokBinary: bin, promptFile: await deps.sandbox.systemPromptFile(promptText), emptyCwd, configRoot: prepared.root },
          { ...deps.env, PATH: deps.safePath },
        );
        if (signal.aborted || outer.stopRequested !== null) {
          outer.fail("E_CANCELLED", "cancelled", { cancelled: true });
          return;
        }
        child = deps.spawner.spawn(spec);
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
        const errPump = (async () => {
          try {
            for await (const l of child!.stderr) {
              stderr.push(secrets.redact(l).text.slice(0, 1000));
              if (stderr.length > 8) stderr.shift();
            }
          } catch {
            /* stderr closed abruptly */
          }
        })();
        let folded = emptyGrokTurn();
        let emitted = 0;
        let readBytes = 0;
        let failure: MitoriError | null = null;
        try {
          for await (const line of child.stdout) {
            readBytes += bytes(line);
            if (readBytes > 1024 * 1024) {
              failure = new MitoriError("E_AGENT_PROTOCOL", "Grok stdout exceeded 1 MiB");
              interrupt("cancel");
              continue;
            }
            folded = grokFoldLine(folded, line);
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
        deps.timers.clear(turn);
        if (kill !== null) deps.timers.clear(kill);
        signal.removeEventListener("abort", onAbort);
        const usage = zeroUsage();
        const modelId = req.model.startsWith("grok:") ? req.model.slice("grok:".length) : settings.model;
        const pricing = grokPricing(settings, modelId);
        if (folded.usage) {
          usage.in = folded.usage.in;
          usage.cacheRead = folded.usage.cacheRead;
          usage.cacheWrite = folded.usage.cacheWrite;
          usage.out = folded.usage.out;
          if (folded.usage.thinking) usage.thinking = folded.usage.thinking;
        } else {
          // No usage event: byte-count estimate like generic (hidden thinking is not visible).
          usage.in = bytes(promptText);
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
            usage.pricingVer = "grok-configured-estimated@1";
          } catch {
            failure ??= new MitoriError("E_AGENT_PROTOCOL", "grok configured pricing is invalid");
          }
        } else {
          // Unknown prices reserve the caller's cap, never report a free successful call.
          usage.apiUsd = req.budget.usd;
          usage.pricingVer = "grok-unpriced-budget@1";
        }
        const text = folded.text;
        const res = {
          stop: "end",
          usage,
          usageEstimated: !folded.usage,
          text,
          denials: [],
          auth: prepared.auth,
          durationMs: Math.max(0, deps.clock.now() - started),
        } as import("../contract.ts").EngineResult;
        RESULT_META.set(res, { servedBy: req.model, continuations: 0, firstCallIn: bytes(promptText) });
        const tail = (): string[] => stderr.slice(-3).map((l) => secrets.redact(l).text);
        if (failure) {
          res.stop = "error";
          res.error = { code: failure.code, message: failure.message, retryable: false };
        } else if (folded.toolCall !== null) {
          res.stop = "error";
          res.error = { code: "E_AGENT_PROTOCOL", message: `grok executed a forbidden tool in text-only mode: ${folded.toolCall}`, retryable: false };
        } else if (folded.streamError !== null) {
          res.stop = "error";
          res.error = { code: "E_AGENT_EXIT", message: folded.streamError, retryable: true, stderrTail: tail() };
        } else if (!folded.ended) {
          res.stop = "error";
          res.error = {
            code: "E_AGENT_EXIT",
            message: exit !== 0 ? `grok exited with code ${exit} and no terminal end record` : "grok stdout ended without a terminal end record",
            retryable: true,
            stderrTail: tail(),
          };
        } else if (stopped === "cancel") res.stop = "cancelled";
        else if (stopped === "timeout") {
          res.stop = "error";
          res.error = { code: "E_AGENT_TIMEOUT", message: "engine timeout (turn)", retryable: true };
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
          res.error = { code: "E_AGENT_EXIT", message: "isolated grok config cleanup failed", retryable: false };
        }
        const at = deps.clock.now();
        if (res.error) outer.events.push({ t: "error", code: res.error.code, message: res.error.message, retryable: res.error.retryable, at });
        outer.events.push({ t: "usage", usage: res.usage, final: !!folded.usage, at });
        const done: Extract<JobEvent, { t: "result" }> = { t: "result", stop: res.stop, denials: [], durationMs: res.durationMs, at };
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
        }
        if (prepared) await prepared.cleanup().catch(() => {});
        const e = MitoriError.from(err);
        outer.fail(e.code, e.message);
      }
    })();
    return outer;
  };

  return { id: "grok-cli", detect, run };
}
