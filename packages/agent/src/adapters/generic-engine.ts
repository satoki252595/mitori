import { type Cancel, type Clock, createSecretScanner, type EngineStatus, type GlobalSettings, type JobEvent, type Logger, MitoriError } from "@mitori/core";
import { type ChildHandle, type Engine, type EngineRequest, type EngineResult, type EngineRun, SIGINT_GRACE_MS, type Spawner } from "../contract.ts";
import { RelayRun, zeroUsage } from "../util/run.ts";
import type { Timers } from "../util/timers.ts";
import { buildGenericSpawn, extractJsonFromText } from "./index.ts";

export interface GenericEngineDeps {
  spawner: Spawner;
  settings: () => GlobalSettings;
  env: Readonly<Record<string, string | undefined>>;
  safePath: string;
  emptyCwd: string;
  /** Make sure the empty sandbox exists and is empty. */
  ensureEmptyCwd: () => Promise<string>;
  clock: Clock;
  timers: Timers;
  log: Logger;
}

/** stdout read limit (spec §6.11). */
const STDOUT_MAX = 1024 * 1024;

/** generic engine (global argv; prompt on stdin, reply on stdout, no usage data; spec §6.11). */
export function createGenericEngine(deps: GenericEngineDeps): Engine {
  const cfg = () => deps.settings().engines.generic;
  const secrets = createSecretScanner();

  const detect = async (): Promise<EngineStatus> => {
    const c = cfg();
    const problems: EngineStatus["problems"] = [];
    if (!c.enabled) problems.push({ code: "E_AGENT_NOT_INSTALLED", message: "the generic engine is disabled" });
    if (!c.argv[0]?.startsWith("/")) problems.push({ code: "E_CFG_INVALID", message: "engines.generic.argv[0] must be an absolute path" });
    const s: EngineStatus = {
      engine: "generic",
      installed: c.enabled && problems.length === 0,
      auth: "unknown",
      capabilities: [],
      billing: "unknown",
      problems,
      checkedAt: deps.clock.iso(),
    };
    if (c.argv[0]) s.path = c.argv[0];
    return s;
  };

  const run = (req: EngineRequest, signal: Cancel): EngineRun => {
    const outer = new RelayRun(deps.clock);
    void (async () => {
      let spec: ReturnType<typeof buildGenericSpawn>;
      try {
        if (!cfg().enabled) throw new MitoriError("E_AGENT_NOT_INSTALLED", "the generic engine is disabled");
        await deps.ensureEmptyCwd();
        spec = buildGenericSpawn(req, cfg(), { emptyCwd: deps.emptyCwd }, { ...deps.env, PATH: deps.safePath });
      } catch (err) {
        const e = MitoriError.from(err);
        outer.fail(e.code, e.message);
        return;
      }
      if (signal.aborted || outer.stopRequested !== null) {
        outer.fail("E_CANCELLED", "cancelled", { cancelled: true });
        return;
      }
      const started = deps.clock.now();
      let child: ChildHandle;
      try {
        child = deps.spawner.spawn(spec);
      } catch (err) {
        // ENOENT/EACCES of the configured argv[0]: the engine could not start (no call, no ledger row)
        outer.fail("E_AGENT_EXIT", `generic engine failed to start: ${err instanceof Error ? err.message : String(err)}`, { retryable: true });
        return;
      }
      let stopped: "cancel" | "timeout" | null = null;
      let kill: unknown = null;
      const interrupt = (why: "cancel" | "timeout") => {
        if (stopped) return;
        stopped = why;
        try {
          child.kill("SIGINT");
        } catch {
          // gone
        }
        kill = deps.timers.set(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            // gone
          }
        }, SIGINT_GRACE_MS);
      };
      const onAbort = () => interrupt("cancel");
      signal.addEventListener("abort", onAbort, { once: true });
      outer.onStopEarly = () => interrupt("cancel");
      const turn = deps.timers.set(() => interrupt("timeout"), spec.timeoutMs);
      let out = "";
      let truncated = false;
      let ioError: string | null = null;
      const stderr: string[] = [];
      const errPump = (async () => {
        try {
          for await (const l of child.stderr) {
            stderr.push(l);
            if (stderr.length > 50) stderr.shift();
          }
        } catch {
          // stderr closed abruptly
        }
      })();
      try {
        // the spawner wrote `spec.stdin` and closed stdin (keepStdinOpen false): writing again would fail
        for await (const line of child.stdout) {
          if (out.length + line.length + 1 > STDOUT_MAX) {
            truncated = true;
            continue;
          }
          out += `${line}\n`;
          if (req.mode === "answer") outer.events.push({ t: "text", delta: `${line}\n`, at: deps.clock.now() });
        }
      } catch (err) {
        ioError = err instanceof Error ? err.message : String(err);
        interrupt("cancel");
      }
      const code = await child.exited.catch(() => -1);
      // the stderr tail belongs to this exit, but a child whose stderr never closes must not hold the run
      await Promise.race([errPump, new Promise<void>((r) => globalThis.setTimeout(r, 50))]);
      deps.timers.clear(turn);
      if (kill !== null) deps.timers.clear(kill);
      signal.removeEventListener("abort", onAbort);
      if (truncated) deps.log.warn("agent.generic.stdout_truncated", { bytes: STDOUT_MAX });
      const res: EngineResult = {
        stop: "end",
        usage: zeroUsage(),
        usageEstimated: true,
        denials: [],
        auth: "unknown",
        durationMs: Math.max(0, deps.clock.now() - started),
      };
      const text = out.replace(/\n$/, "");
      const tail = (): string[] => stderr.slice(-3).map((l) => secrets.redact(l).text);
      if (ioError !== null) {
        res.stop = "error";
        res.error = { code: "E_AGENT_EXIT", message: `generic engine I/O failed: ${ioError}`, retryable: true, stderrTail: tail() };
      } else if (stopped === "cancel") res.stop = "cancelled";
      else if (stopped === "timeout") {
        res.stop = "error";
        res.error = { code: "E_AGENT_TIMEOUT", message: "engine timeout (turn)", retryable: true };
      } else if (code !== 0) {
        res.stop = "error";
        res.error = { code: "E_AGENT_EXIT", message: `generic engine exited with code ${code}`, retryable: true, stderrTail: tail() };
      } else if (req.mode === "answer") res.text = text;
      else {
        const j = extractJsonFromText(text);
        if (j.ok) res.structured = j.value;
        else {
          res.stop = "error";
          res.error = { code: "E_AGENT_PROTOCOL", message: j.error.message, retryable: true };
        }
        res.text = text;
      }
      const at = deps.clock.now();
      if (res.error) outer.events.push({ t: "error", code: res.error.code, message: res.error.message, retryable: res.error.retryable, at });
      outer.events.push({ t: "usage", usage: res.usage, final: false, at });
      const r: Extract<JobEvent, { t: "result" }> = { t: "result", stop: res.stop, denials: [], durationMs: res.durationMs, at };
      if (res.structured !== undefined) r.structured = res.structured;
      if (res.text !== undefined) r.text = res.text;
      outer.events.push(r);
      outer.resolve(res);
    })();
    return outer;
  };

  return { id: "generic", detect, run };
}
