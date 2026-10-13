import {
  type Cancel,
  type Clock,
  createSecretScanner,
  type EngineStatus,
  type GlobalSettings,
  type JobEvent,
  type Logger,
  MitoriError,
  priceUsage,
} from "@mitori/core";
import { runProbe } from "../claude/detect.ts";
import { type ChildHandle, type Engine, type EngineRequest, type EngineResult, type EngineRun, SIGINT_GRACE_MS, type Spawner } from "../contract.ts";
import { type FileId, type FollowIo, type FollowPorts, followMuseUpdate, museCandidateFor, sameFileId } from "../follow.ts";
import { RESULT_META, RelayRun, zeroUsage } from "../util/run.ts";
import type { Timers } from "../util/timers.ts";
import type { FetchLike } from "./anthropic-engine.ts";
import { genericApiTarget, runGenericApi } from "./generic-http.ts";
import { assertMuseTextOnlyArgv, buildGenericSpawn, extractJsonFromText } from "./index.ts";

export interface GenericEngineDeps {
  spawner: Spawner;
  settings: () => GlobalSettings;
  env: Readonly<Record<string, string | undefined>>;
  safePath: string;
  emptyCwd: string;
  /** Make sure the empty sandbox exists and is empty. */
  ensureEmptyCwd: () => Promise<string>;
  /** The existing content-addressed SafeWriter store (only used by argv's {promptFile}). */
  systemPromptFile?: (text: string) => Promise<string>;
  policyPlan?: () => string;
  /** Whether the configured CLI still exists (Muse's self-update deletes the previous versioned native binary). */
  binaryExists?: (path: string) => boolean;
  /** Read the Muse `.muse-version` marker / candidate binary (null ⇒ no auto-follow; only `binaryExists` applies). */
  fs?: { read: (abs: string) => Promise<Uint8Array>; stat: (abs: string) => { isFile: boolean } | null; realpath: (abs: string) => string | null } | null;
  /**
   * Vendor-update auto-follow (WP28): POSIX ownership + file identity for the re-check and workspace roots
   * for the SEC-10 path check (Muse has no pin, so no hash is taken). Absent ⇒ a gone binary keeps
   * reporting `E_AGENT_NOT_INSTALLED` (spec §B).
   */
  follow?: FollowPorts;
  /** Persist a followed Muse binary (composition root → `engines.generic.argv[0]`, daemon-internal). */
  saveBinary?: (path: string) => Promise<void>;
  /** Fail closed when user-local ordinary hooks/MCP/extension config would bypass the text-only profile. */
  validateMuseConfig?: () => Promise<void>;
  /** Private per-call text-only settings and a credential copy; cleanup runs after the child exits. */
  prepareMuseConfig?: () => Promise<{ root: string; cleanup: () => Promise<void> }>;
  clock: Clock;
  timers: Timers;
  log: Logger;
  fetch: FetchLike;
}

/** stdout read limit (spec §6.11). */
const STDOUT_MAX = 1024 * 1024;

/** Generic text generation; Muse JSONL additionally supplies the served model and text-only diagnostics. */
export function createGenericEngine(deps: GenericEngineDeps): Engine {
  const cfg = () => deps.settings().engines.generic;
  const secrets = createSecretScanner();
  /** Latest vendor-update follow of this daemon (Muse has no pin; shown as 「旧版→新版」, lost on restart). */
  let lastFollow: { from: string; to: string; at: string } | null = null;
  /** Last follow attempt that failed: the same marker + candidate is not re-probed (WP28b; lost on restart). */
  let failedFollow: { path: string; id: FileId; marker: string } | null = null;

  /**
   * Follow a Muse self-update (WP28 §A): the `.muse-version` marker in the same directory as the saved
   * `argv[0]` names the successor (`binaryOf` rule); only `argv[0]` changes, the rest of argv (model,
   * effort, …) is preserved. SEC-10 path + POSIX ownership re-checked, `--version` re-verified like
   * `setup-pin`, and the Muse text-only argv + config gates must still pass. Returns the followed status,
   * or `null` when there is no successor or any check fails (the caller keeps the gone-binary status; §B).
   */
  const tryFollowMuse = async (argv0: string): Promise<EngineStatus | null> => {
    if (!deps.follow || !deps.fs || !deps.saveBinary) return null;
    const fs = deps.fs;
    const follow = deps.follow;
    // A failed marker + candidate is not re-probed while both are unchanged (WP28b).
    const dir = argv0.slice(0, argv0.lastIndexOf("/")) || "/";
    const markerPath = `${dir.replace(/\/+$/, "")}/.muse-version`;
    let marker: string | null = null;
    try {
      marker = new TextDecoder().decode(await fs.read(markerPath));
    } catch {
      return null;
    }
    const candidatePath = museCandidateFor(dir, marker, argv0);
    if (!candidatePath) return null;
    const id = follow.fileId(candidatePath);
    if (id && failedFollow && failedFollow.path === candidatePath && failedFollow.marker === marker && sameFileId(failedFollow.id, id)) return null;
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
        const env: Record<string, string> = { PATH: deps.safePath };
        if (typeof deps.env.HOME === "string") env.HOME = deps.env.HOME;
        const r = await runProbe(deps.spawner, deps.timers, { command: candidate, argv: ["--version"], env, cwd: deps.emptyCwd });
        if (r.code !== 0 || new TextEncoder().encode(r.out).byteLength > 4096) return null;
        return r.out.split("\n")[0]?.trim() ?? null;
      },
      euid: follow.euid,
      platform: follow.platform,
      workspaceRoots: follow.workspaceRoots(),
      tmpdir: typeof deps.env.TMPDIR === "string" ? deps.env.TMPDIR : undefined,
    };
    const rememberFailed = () => {
      const now = follow.fileId(candidatePath);
      failedFollow = now ? { path: candidatePath, id: now, marker } : null;
    };
    const candidate = await followMuseUpdate(argv0, io);
    if (!candidate) {
      rememberFailed();
      return null;
    }
    // Engine safety gate: the text-only profile and the user-config isolation must still hold.
    try {
      assertMuseTextOnlyArgv(cfg().argv.slice(1));
      if (!deps.validateMuseConfig) {
        rememberFailed();
        return null;
      }
      await deps.validateMuseConfig();
    } catch {
      rememberFailed();
      return null;
    }
    try {
      await deps.saveBinary(candidate.path);
    } catch {
      rememberFailed();
      return null;
    }
    failedFollow = null;
    // `from`/`to` are both the `muse-bin-<ver>` `<ver>` (the `.muse-version` text), never the `--version` line.
    const from = /\/muse-bin-([^/]+)$/.exec(argv0)?.[1] ?? lastFollow?.to ?? "";
    const at = deps.clock.iso();
    lastFollow = { from, to: candidate.version, at };
    deps.log.info("agent.generic.auto_follow", { from, to: candidate.version, path: candidate.path });
    const s: EngineStatus = {
      engine: "generic",
      installed: true,
      auth: "unknown",
      capabilities: [],
      billing: "unknown",
      problems: [],
      checkedAt: at,
      path: candidate.path,
      version: candidate.version,
      followed: lastFollow,
    };
    if (deps.policyPlan) s.plan = deps.policyPlan();
    return s;
  };

  const detect = async (): Promise<EngineStatus> => {
    const c = cfg();
    // Vendor auto-update (WP28): try the marker successor before reporting the binary as gone.
    if (c.enabled && c.protocol === "muse-jsonl" && c.argv[0]?.startsWith("/") && deps.binaryExists && !deps.binaryExists(c.argv[0])) {
      const next = await tryFollowMuse(c.argv[0]);
      if (next) return next;
    }
    const problems: EngineStatus["problems"] = [];
    if (!c.enabled) problems.push({ code: "E_AGENT_NOT_INSTALLED", message: "the generic engine is disabled" });
    let apiAuth: EngineStatus["auth"] = "unknown";
    if (c.protocol === "openai-chat") {
      try {
        const target = genericApiTarget(c);
        const hasKey = !!(c.api?.keyEnv && deps.env[c.api.keyEnv]);
        apiAuth = hasKey ? "api-key" : "none";
        if ((!target.local || c.api?.keyEnv) && !hasKey)
          problems.push({ code: "E_AGENT_AUTH", message: "the configured API key environment variable is not set" });
      } catch (err) {
        const e = MitoriError.from(err);
        problems.push({ code: e.code, message: e.message });
      }
    } else if (!c.argv[0]?.startsWith("/")) problems.push({ code: "E_CFG_INVALID", message: "engines.generic.argv[0] must be an absolute path" });
    else if (c.enabled && deps.binaryExists && !deps.binaryExists(c.argv[0]))
      problems.push({
        code: "E_AGENT_NOT_INSTALLED",
        message:
          c.protocol === "muse-jsonl"
            ? "the configured Muse native binary is gone (a Muse update replaces it); run `mitori setup muse` again"
            : "the configured CLI binary was not found",
      });
    if (c.enabled && c.protocol === "muse-jsonl") {
      try {
        assertMuseTextOnlyArgv(c.argv.slice(1));
        if (!deps.validateMuseConfig) throw new MitoriError("E_PRECONDITION", "Muse config inspection is not wired");
        await deps.validateMuseConfig();
      } catch (err) {
        const e = MitoriError.from(err);
        problems.push({ code: e.code, message: e.message });
      }
    }
    const s: EngineStatus = {
      engine: "generic",
      installed: c.enabled && problems.length === 0,
      auth: apiAuth,
      capabilities: [],
      billing: "unknown",
      problems,
      checkedAt: deps.clock.iso(),
    };
    if (c.protocol !== "openai-chat" && c.argv[0]) s.path = c.argv[0];
    if (deps.policyPlan) s.plan = deps.policyPlan();
    if (lastFollow) s.followed = lastFollow;
    return s;
  };

  const run = (req: EngineRequest, signal: Cancel): EngineRun => {
    if (cfg().protocol === "openai-chat") return runGenericApi(deps, req, signal);
    const outer = new RelayRun(deps.clock);
    let settings = cfg();
    const textRequest = {
      ...req,
      system: `Text-only request: do not call tools, read/write files, run commands, delegate, or start reminders. Use only the supplied context and return the requested text/JSON directly. Paths identify proposed edits; do not access them.\n\n${req.system}`,
    };
    void (async () => {
      let spec: ReturnType<typeof buildGenericSpawn>;
      let inputText = "";
      let museConfig: Awaited<ReturnType<NonNullable<GenericEngineDeps["prepareMuseConfig"]>>> | null = null;
      let exited: Promise<number> | null = null;
      const cleanup = async () => {
        if (!museConfig) return;
        if (exited) await exited.catch(() => -1);
        const prepared = museConfig;
        museConfig = null;
        await prepared.cleanup();
      };
      try {
        try {
          if (!settings.enabled) throw new MitoriError("E_AGENT_NOT_INSTALLED", "the generic engine is disabled");
          // A Muse update between detects leaves a deleted binary behind: refresh (detect follows it) first —
          // only when auto-follow is wired, otherwise detect could not change anything anyway.
          if (
            deps.follow &&
            settings.protocol === "muse-jsonl" &&
            settings.argv[0]?.startsWith("/") &&
            deps.binaryExists &&
            !deps.binaryExists(settings.argv[0])
          ) {
            await detect().catch(() => null);
            settings = cfg();
          }
          await deps.ensureEmptyCwd();
          const paths: { emptyCwd: string; promptFile?: string; museHooksFile?: string; museConfigRoot?: string } = { emptyCwd: deps.emptyCwd };
          if (settings.protocol === "muse-jsonl") {
            if (!deps.systemPromptFile || !deps.validateMuseConfig || !deps.prepareMuseConfig)
              throw new MitoriError("E_PRECONDITION", "Muse isolation ports are not wired");
            await deps.validateMuseConfig();
            museConfig = await deps.prepareMuseConfig();
            paths.museConfigRoot = museConfig.root;
            paths.museHooksFile = await deps.systemPromptFile('{"hooks":{}}');
          }
          if (settings.argv.some((arg) => arg.includes("{promptFile}"))) {
            if (!deps.systemPromptFile) throw new MitoriError("E_PRECONDITION", "generic prompt-file storage is not wired");
            // Build the complete prompt once using the stdin path, then pass only its secure file path to the CLI.
            const stdinSettings = { ...settings, protocol: "text" as const, argv: [settings.argv[0] ?? "/invalid"] };
            const full = buildGenericSpawn(textRequest, stdinSettings, paths, {}).stdin;
            inputText = full;
            paths.promptFile = await deps.systemPromptFile(full);
          }
          spec = buildGenericSpawn(textRequest, settings, paths, { ...deps.env, PATH: deps.safePath });
          if (!inputText) inputText = spec.stdin;
        } catch (err) {
          await cleanup();
          const e = MitoriError.from(err);
          outer.fail(e.code, e.message);
          return;
        }
        if (signal.aborted || outer.stopRequested !== null) {
          await cleanup();
          outer.fail("E_CANCELLED", "cancelled", { cancelled: true });
          return;
        }
        const started = deps.clock.now();
        let child: ChildHandle;
        try {
          child = deps.spawner.spawn(spec);
          exited = child.exited;
        } catch (err) {
          await cleanup();
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
        const muse = settings.protocol === "muse-jsonl";
        let terminal: string | null = null;
        let terminalText: string | null = null;
        let museText = "";
        let protocolError: string | null = null;
        let servedBy: string | null = null;
        const usage = zeroUsage();
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
            if (!muse) {
              if (req.mode === "answer" || req.mode === "generate") outer.events.push({ t: "text", delta: `${line}\n`, at: deps.clock.now() });
              continue;
            }
            try {
              const record = JSON.parse(line) as { payload_type?: unknown; payload?: Record<string, unknown> };
              const payload = record.payload;
              if (!payload || typeof payload !== "object" || typeof record.payload_type !== "string") throw new Error("invalid Muse JSONL envelope");
              const type = record.payload_type;
              const event = payload.event as { task_kind?: unknown; operation?: unknown } | undefined;
              if (
                /^(?:hook|mcp|tool)[.:]|(?:^|\.)tool(?:_call|\.call)/.test(type) ||
                (typeof event?.task_kind === "string" && /^(?:tool|reminder|subagent|workflow)[.:]/.test(event.task_kind)) ||
                (typeof event?.operation === "string" && /^(?:reminder|tool|subagent|workflow)[.:]/.test(event.operation))
              ) {
                const identifier = (value: unknown) => (typeof value === "string" && /^[a-z\d_.:-]{1,160}$/i.test(value) ? value : "unknown");
                protocolError ??= `Muse attempted a forbidden task in text-only mode: ${identifier(type)}, task=${identifier(event?.task_kind)}, operation=${identifier(event?.operation)}`;
                interrupt("cancel");
              }
              if (type === "run.output.delta" && typeof payload.text === "string") {
                museText += payload.text;
                if (req.mode === "answer" || req.mode === "generate") outer.events.push({ t: "text", delta: payload.text, at: deps.clock.now() });
              }
              if (type.startsWith("run.terminal.")) {
                if (terminal !== null) throw new Error("multiple Muse terminal records");
                if (typeof payload.terminal !== "string") throw new Error("Muse terminal state is missing");
                terminal = payload.terminal;
                terminalText = typeof payload.text === "string" ? payload.text : null;
                if (terminal !== "completed") protocolError ??= typeof payload.reason === "string" ? secrets.redact(payload.reason).text : `Muse ${terminal}`;
              }
              if (type === "run.model.configured") {
                if (typeof payload.model_id === "string") servedBy = `generic:${payload.model_id}`;
              }
            } catch (err) {
              protocolError ??= err instanceof Error ? err.message : "invalid Muse JSONL";
              interrupt("cancel");
            }
          }
        } catch (err) {
          ioError = err instanceof Error ? err.message : String(err);
          interrupt("cancel");
        }
        const code = await child.exited.catch(() => -1);
        let cleanupFailed = false;
        try {
          await cleanup();
        } catch {
          cleanupFailed = true;
        }
        // the stderr tail belongs to this exit, but a child whose stderr never closes must not hold the run
        await Promise.race([errPump, new Promise<void>((r) => globalThis.setTimeout(r, 50))]);
        deps.timers.clear(turn);
        if (kill !== null) deps.timers.clear(kill);
        signal.removeEventListener("abort", onAbort);
        if (truncated) deps.log.warn("agent.generic.stdout_truncated", { bytes: STDOUT_MAX });
        const res: EngineResult = {
          stop: "end",
          usage,
          usageEstimated: true,
          denials: [],
          auth: "unknown",
          durationMs: Math.max(0, deps.clock.now() - started),
        };
        const text = muse ? (terminalText ?? museText) : out.replace(/\n$/, "");
        // ponytail: byte-count text estimate excludes hidden thinking/provider overhead; replace when CLI native usage is verified.
        usage.in = new TextEncoder().encode(inputText).byteLength;
        usage.out = new TextEncoder().encode(text).byteLength;
        // Unknown prices/usage reserve the caller's cap, never report a free successful call.
        res.usage.apiUsd = req.budget.usd;
        res.usage.pricingVer = "generic-unpriced-budget@1";
        if (settings.pricing) {
          try {
            res.usage.apiUsd = priceUsage(
              req.model,
              { in: usage.in, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: usage.cacheRead, out: usage.out },
              false,
              settings.pricing,
            );
            res.usage.pricingVer = "generic-configured-estimated@1";
          } catch {
            protocolError = "generic configured pricing is invalid";
          }
        }
        if (servedBy) RESULT_META.set(res, { servedBy, continuations: 0 });
        if (muse) deps.log.info("agent.generic.muse_profile", { requestedModel: req.model, servedBy, requestedEffort: req.effort });
        const tail = (): string[] => stderr.slice(-3).map((l) => secrets.redact(l).text);
        if (cleanupFailed) {
          res.stop = "error";
          res.error = { code: "E_AGENT_EXIT", message: "isolated Muse config cleanup failed", retryable: false };
        } else if (protocolError !== null || truncated) {
          res.stop = "error";
          res.error = {
            code: "E_AGENT_PROTOCOL",
            message: protocolError ?? "generic stdout exceeded its read limit",
            retryable: false,
          };
        } else if (ioError !== null) {
          res.stop = "error";
          res.error = { code: "E_AGENT_EXIT", message: `generic engine I/O failed: ${ioError}`, retryable: true, stderrTail: tail() };
        } else if (stopped === "cancel") res.stop = "cancelled";
        else if (stopped === "timeout") {
          res.stop = "error";
          res.error = { code: "E_AGENT_TIMEOUT", message: "engine timeout (turn)", retryable: true };
        } else if (code !== 0) {
          res.stop = "error";
          res.error = { code: "E_AGENT_EXIT", message: `generic engine exited with code ${code}`, retryable: true, stderrTail: tail() };
        } else if (muse && terminal !== "completed") {
          res.stop = "error";
          res.error = { code: "E_AGENT_PROTOCOL", message: "Muse stdout ended without a completed terminal record", retryable: false };
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
        const at = deps.clock.now();
        if (res.error) outer.events.push({ t: "error", code: res.error.code, message: res.error.message, retryable: res.error.retryable, at });
        outer.events.push({ t: "usage", usage: res.usage, final: false, at });
        const r: Extract<JobEvent, { t: "result" }> = { t: "result", stop: res.stop, denials: [], durationMs: res.durationMs, at };
        if (res.structured !== undefined) r.structured = res.structured;
        if (res.text !== undefined) r.text = res.text;
        outer.events.push(r);
        outer.resolve(res);
      } finally {
        await cleanup();
      }
    })().catch(() => outer.fail("E_AGENT_EXIT", "generic run failed or isolated Muse config cleanup failed"));
    return outer;
  };

  return { id: "generic", detect, run };
}
