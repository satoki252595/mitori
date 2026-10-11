import {
  type BinaryPin,
  type Cancel,
  type Clock,
  createSecretScanner,
  type EngineStatus,
  type FsReader,
  type GlobalSettings,
  type Hasher,
  MitoriError,
  priceUsage,
} from "@mitori/core";
import { runProbe } from "../claude/detect.ts";
import { scrubEnv } from "../claude/env.ts";
import type { SandboxStore } from "../claude/fsports.ts";
import { firstRunPin, isBareName, resolveOnSafePath, untrustedOnFirstUse } from "../claude/resolve.ts";
import { type ChildHandle, type Engine, type EngineRequest, type EngineRun, SIGINT_GRACE_MS, type Spawner } from "../contract.ts";
import { RESULT_META, RelayRun, zeroUsage } from "../util/run.ts";
import type { Timers } from "../util/timers.ts";
import { CODEX_VERSION, codexCatalog, codexPreflight } from "./codex-policy.ts";
import { buildCodexSpawn, extractJsonFromText } from "./index.ts";

interface CodexDeps {
  spawner: Spawner;
  settings(): GlobalSettings;
  env: Readonly<Record<string, string | undefined>>;
  safePath: string;
  clock: Clock;
  timers: Timers;
  hasher: Hasher;
  fs: FsReader | null;
  sandbox: SandboxStore;
  prepareConfig(): Promise<{ root: string; auth: "subscription" | "none"; cleanup(): Promise<void> }>;
  pin?(pin: BinaryPin): Promise<void>;
}

const enc = new TextEncoder();
const bytes = (text: string) => enc.encode(text).length;

/** No native shell/Read/MCP; native apply_patch is OS-scoped, then ordinary loop review/gates apply. */
export function createCodexEngine(deps: CodexDeps): Engine {
  let tofu: BinaryPin | undefined;
  const secrets = createSecretScanner();
  const cfg = () => deps.settings().engines["codex-cli"];
  const detect = async (): Promise<EngineStatus> => {
    const problems: EngineStatus["problems"] = [];
    let bin: BinaryPin | undefined = deps.settings().pins.codex ?? tofu;
    let auth: EngineStatus["auth"] = "none";
    let version = "";
    try {
      if (!cfg().enabled) throw new MitoriError("E_AGENT_NOT_INSTALLED", "Codex is disabled");
      if (!cfg().pricing) throw new MitoriError("E_CFG_INVALID", "Codex requires explicit API-equivalent pricing");
      if (!(Number.isFinite(cfg().maxEstimatedSpendUsd) && (cfg().maxEstimatedSpendUsd ?? 0) > 0))
        throw new MitoriError("E_CFG_INVALID", "Codex requires explicit estimated spend consent; native thinking has no hard token cap");
      if (!deps.fs) throw new MitoriError("E_PRECONDITION", "Codex filesystem ports are not wired");
      const name = cfg().binary;
      const found = bin ?? (isBareName(name) ? resolveOnSafePath(deps.fs, deps.safePath, name) : { path: name, realpath: deps.fs.realpath(name) ?? "" });
      if (!found?.realpath.startsWith("/") || !deps.fs.stat(found.realpath)?.isFile)
        throw new MitoriError("E_AGENT_NOT_INSTALLED", "Codex native binary was not found on SAFE_PATH");
      if (!bin && untrustedOnFirstUse(found, deps.env.TMPDIR))
        throw new MitoriError("E_AGENT_CAPABILITY", "Codex binary in a temporary directory needs explicit repinning");
      if (bin && (deps.fs.realpath(bin.path) !== bin.realpath || deps.hasher.sha256(await deps.fs.read(bin.realpath)) !== bin.sha256))
        throw new MitoriError("E_AGENT_CAPABILITY", "Codex binary changed; repin after human review");
      const isolated = await deps.prepareConfig();
      try {
        auth = isolated.auth;
        const env = { ...scrubEnv({ ...deps.env, PATH: deps.safePath }, []), HOME: isolated.root, CODEX_HOME: isolated.root };
        const probe = await runProbe(deps.spawner, deps.timers, { command: found.realpath, argv: ["--version"], env, cwd: isolated.root });
        version = probe.out.trim();
        if (probe.code !== 0 || !new RegExp(`^codex(?:-cli)? ${CODEX_VERSION.replaceAll(".", "\\.")}$`).test(version))
          throw new MitoriError("E_AGENT_CAPABILITY", `Codex apply_patch profile requires verified version ${CODEX_VERSION}`);
        if (!bin) {
          bin = await firstRunPin(deps.fs, deps.hasher, found, version, deps.clock.iso());
          tofu = bin;
          if (deps.pin) await deps.pin(bin);
        }
      } finally {
        await isolated.cleanup();
      }
      if (auth !== "subscription") throw new MitoriError("E_AGENT_AUTH", "Codex requires subscription login; run codex login");
    } catch (err) {
      const e = MitoriError.from(err);
      problems.push({ code: e.code, message: e.message });
    }
    return {
      engine: "codex-cli",
      installed: !!bin && problems.every((p) => p.code === "E_AGENT_AUTH"),
      auth,
      capabilities: problems.length ? [] : ["apply_patch", "precise-filesystem", "json-schema"],
      billing: "unknown",
      problems,
      checkedAt: deps.clock.iso(),
      ...(bin ? { path: bin.path, version } : {}),
    };
  };

  const run = (req: EngineRequest, signal: Cancel): EngineRun => {
    const outer = new RelayRun(deps.clock);
    void (async () => {
      let prepared: Awaited<ReturnType<CodexDeps["prepareConfig"]>> | null = null;
      let child: ChildHandle | null = null;
      try {
        const settings = cfg();
        // Refuse unknown pricing/consent before any native call (even a detect probe).
        if (!settings.enabled) throw new MitoriError("E_AGENT_NOT_INSTALLED", "Codex is disabled");
        if (!settings.pricing || !(settings.maxEstimatedSpendUsd && Number.isFinite(settings.maxEstimatedSpendUsd)))
          throw new MitoriError("E_CFG_INVALID", "Codex needs explicit pricing and estimated spend consent (native thinking is not hard-capped)");
        if (!/^codex:[^\s]{1,100}$/u.test(req.model)) throw new MitoriError("E_INVALID_INPUT", "Codex requests must name an exact codex:<model> id");
        if (
          [req.budget.usd, req.budget.outTokens, req.budget.inTokens, req.budget.ms].some((n) => !Number.isFinite(n) || n <= 0) ||
          req.budget.usd > settings.maxEstimatedSpendUsd
        )
          throw new MitoriError("E_BUDGET_EXCEEDED", "Codex request needs bounded input/output and an estimated USD ceiling within the configured consent");
        const maxCalls = req.mode === "agent" ? (settings.maxPatchSteps ?? 2) : 0;
        if (!Number.isInteger(maxCalls) || maxCalls < (req.mode === "agent" ? 1 : 0) || maxCalls > 8)
          throw new MitoriError("E_CFG_INVALID", "Codex maxPatchSteps must be 1–8");
        const preflight = codexPreflight({ ...req, outTokens: req.budget.outTokens, maxCalls }, settings.pricing);
        const input = preflight.inTokens;
        if (preflight.inTokens > req.budget.inTokens || preflight.usd > req.budget.usd)
          throw new MitoriError("E_BUDGET_EXCEEDED", "Codex conservative preflight exceeds the confirmed turn budget");
        if (!deps.fs) throw new MitoriError("E_PRECONDITION", "Codex filesystem ports are not wired");
        const status = await detect();
        if (!status.installed || status.problems.length > 0)
          throw new MitoriError(status.problems[0]?.code ?? "E_AGENT_CAPABILITY", status.problems[0]?.message ?? "Codex unavailable");
        const pin = deps.settings().pins.codex ?? tofu;
        if (!pin) throw new MitoriError("E_AGENT_CAPABILITY", "Codex binary is not pinned");
        const cwd = req.mode === "agent" ? deps.fs.realpath(req.cwd) : await deps.sandbox.ensureEmptyCwd();
        if (!cwd?.startsWith("/")) throw new MitoriError("E_PATH_OUTSIDE", "Codex cwd must resolve to an absolute directory");
        // No symlink component may become a writable root, including a parent of a new file.
        for (const path of [...req.writeScope, ...(req.newFiles ?? [])]) {
          let component = cwd;
          for (const part of path.split("/")) {
            if (!part || part === "." || part === "..") throw new MitoriError("E_PATH_OUTSIDE", "unsafe Codex write path");
            component += `/${part}`;
            if (deps.fs.stat(component)?.isSymlink) throw new MitoriError("E_PATH_SYMLINK", "Codex write scope contains a symlink");
          }
        }
        prepared = await deps.prepareConfig();
        if (prepared.auth !== "subscription") throw new MitoriError("E_AGENT_AUTH", "Codex subscription auth is missing");
        const model = req.model.startsWith("codex:") ? req.model.slice(6) : settings.model;
        const spec = buildCodexSpawn(
          { ...req, cwd },
          settings,
          {
            codexBinary: pin.realpath,
            configRoot: prepared.root,
            emptyCwd: cwd,
            schemaFile: req.jsonSchema ? await deps.sandbox.systemPromptFile(JSON.stringify(req.jsonSchema)) : null,
            lastMessageFile: `${prepared.root}/last-message.txt`,
            modelCatalogFile: await deps.sandbox.systemPromptFile(codexCatalog(model, req.mode === "agent")),
            systemPromptFile: await deps.sandbox.systemPromptFile(
              `Only apply_patch is available in agent mode. Never run commands, use network, delegate or read outside the supplied context.\n${req.system}`,
            ),
          },
          { ...deps.env, PATH: deps.safePath },
        );
        if (signal.aborted || outer.stopRequested !== null) {
          outer.fail("E_CANCELLED", "cancelled", { cancelled: true });
          return;
        }
        child = deps.spawner.spawn(spec);
        const started = deps.clock.now();
        const usage = zeroUsage();
        let terminal = false,
          text = "",
          observedBytes = 0,
          calls = 0,
          readBytes = 0;
        let failure: MitoriError | null = null;
        let stop: "cancelled" | "timeout" | "budget" | "error" | null = null;
        let kill: unknown = null;
        const interrupt = (why: typeof stop, error?: MitoriError) => {
          if (stop !== null) return;
          stop = why;
          failure =
            error ??
            (why === "timeout"
              ? new MitoriError("E_AGENT_TIMEOUT", "Codex turn timeout")
              : why === "budget"
                ? new MitoriError("E_BUDGET_EXCEEDED", "Codex turn stopped at budget")
                : failure);
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
        const onAbort = () => interrupt("cancelled");
        signal.addEventListener("abort", onAbort, { once: true });
        outer.onStopEarly = (reason) => interrupt(reason === "budget" ? "budget" : reason === "timeout" ? "timeout" : "cancelled");
        const turn = deps.timers.set(() => interrupt("timeout"), spec.timeoutMs);
        const stderr: string[] = [];
        const errPump = (async () => {
          for await (const line of child!.stderr) {
            stderr.push(secrets.redact(line).text.slice(0, 1000));
            if (stderr.length > 8) stderr.shift();
          }
        })().catch(() => {});
        const ids = new Set<string>();
        try {
          for await (const line of child.stdout) {
            readBytes += bytes(line);
            if (readBytes > 1024 * 1024) {
              interrupt("error", new MitoriError("E_AGENT_PROTOCOL", "Codex stdout exceeded 1 MiB"));
              continue;
            }
            const record = JSON.parse(line) as {
              type?: string;
              item?: { id?: string; type?: string; text?: string; status?: string; changes?: { path?: string; kind?: string }[] };
              usage?: Record<string, number>;
              error?: { message?: string };
            };
            const item = record.item;
            if (record.type === "item.started" || record.type === "item.completed") {
              if (!item?.type) throw new MitoriError("E_AGENT_PROTOCOL", "Codex item lacks type");
              if (item.type === "file_change") {
                if (req.mode !== "agent" || !item.id || !Array.isArray(item.changes) || item.changes.length === 0)
                  throw new MitoriError("E_AGENT_PROTOCOL", "Codex attempted a file change outside agent mode");
                if (!ids.has(item.id)) {
                  ids.add(item.id);
                  calls++;
                }
                if (calls > maxCalls) interrupt("budget", new MitoriError("E_BUDGET_EXCEEDED", "Codex native apply_patch step limit reached"));
                for (const change of item.changes) {
                  const target = change.path?.startsWith(`${cwd}/`) ? change.path.slice(cwd.length + 1) : "";
                  if (![...req.writeScope, ...(req.newFiles ?? [])].includes(target as never) || !["add", "delete", "update"].includes(change.kind ?? ""))
                    throw new MitoriError("E_PATH_OUTSIDE", "Codex attempted a file change outside the anchored scope");
                  outer.events.push({
                    t: "tool",
                    name: "apply_patch",
                    target: target as never,
                    status: record.type === "item.started" ? "start" : item.status === "completed" ? "ok" : "error",
                    at: deps.clock.now(),
                  });
                }
              } else if (item.type === "agent_message" || item.type === "reasoning") {
                if (record.type === "item.completed" && typeof item.text === "string") {
                  observedBytes += bytes(item.text);
                  if (item.type === "agent_message") {
                    text = item.text;
                    outer.events.push({ t: "text", delta: item.text, at: deps.clock.now() });
                  }
                }
              } else throw new MitoriError("E_AGENT_PROTOCOL", `Codex attempted a forbidden native tool: ${item.type.slice(0, 80)}`);
            } else if (record.type === "turn.completed") {
              if (terminal || !record.usage) throw new MitoriError("E_AGENT_PROTOCOL", "Codex terminal usage is missing or repeated");
              const u = record.usage;
              for (const key of ["input_tokens", "cached_input_tokens", "output_tokens"])
                if (!Number.isSafeInteger(u[key]) || (u[key] ?? -1) < 0) throw new MitoriError("E_AGENT_PROTOCOL", "Codex terminal usage is invalid");
              if (u.cached_input_tokens! > u.input_tokens!) throw new MitoriError("E_AGENT_PROTOCOL", "Codex cached input exceeds total input");
              usage.in = u.input_tokens! - u.cached_input_tokens!;
              usage.cacheRead = u.cached_input_tokens!;
              usage.out = u.output_tokens!;
              usage.thinking = u.reasoning_output_tokens ?? 0;
              terminal = true;
            } else if (record.type === "turn.failed" || record.type === "error")
              throw new MitoriError("E_AGENT_EXIT", secrets.redact(record.error?.message ?? "Codex failed").text);
            else if (!["thread.started", "turn.started", "item.updated"].includes(record.type ?? ""))
              throw new MitoriError("E_AGENT_PROTOCOL", "unknown Codex JSONL event");
            // A tool-free agent_message is already complete. Bytes are not tokens: keep its following terminal usage.
            // Agent-mode step metering remains conservative while further tool calls can still be made.
            if ((req.mode === "agent" && observedBytes >= req.budget.outTokens) || input * (calls + 1) > req.budget.inTokens)
              interrupt("budget", new MitoriError("E_BUDGET_EXCEEDED", "Codex conservative input/output meter reached budget"));
          }
        } catch (err) {
          interrupt("error", MitoriError.from(err));
        }
        const exit = await child.exited;
        await errPump.catch(() => {});
        deps.timers.clear(turn);
        if (kill !== null) deps.timers.clear(kill);
        signal.removeEventListener("abort", onAbort);
        if (!terminal) {
          usage.in = input * (calls + 1);
          usage.out = observedBytes;
        }
        usage.apiUsd = priceUsage(
          req.model,
          { in: usage.in, out: usage.out, cacheRead: usage.cacheRead, cacheWrite5m: 0, cacheWrite1h: 0 },
          false,
          settings.pricing,
        );
        if (usage.in + usage.cacheRead > req.budget.inTokens || usage.out > req.budget.outTokens || usage.apiUsd > req.budget.usd) {
          stop = "budget";
          failure = new MitoriError("E_BUDGET_EXCEEDED", "Codex reported usage exceeds the confirmed estimate; native thinking is not hard-capped");
        }
        if (!stop && (exit !== 0 || !terminal)) {
          stop = "error";
          failure = new MitoriError("E_AGENT_EXIT", "Codex exited without a successful terminal record");
        }
        const result = {
          stop: stop ?? "end",
          usage,
          usageEstimated: !terminal,
          text,
          denials: [],
          auth: "subscription" as const,
          durationMs: deps.clock.now() - started,
        } as import("../contract.ts").EngineResult;
        if (req.jsonSchema && !stop) {
          const parsed = extractJsonFromText(text);
          if (parsed.ok) result.structured = parsed.value;
          else {
            result.stop = "error";
            failure = new MitoriError("E_AGENT_PROTOCOL", parsed.error.message);
          }
        }
        if (failure) result.error = { code: failure.code, message: failure.message, retryable: false, stderrTail: stderr };
        // Auth copies must be removed before the result can advance the loop to gates/human review.
        try {
          await prepared.cleanup();
          prepared = null;
        } catch {
          result.stop = "error";
          result.error = { code: "E_CFG_INVALID", message: "Codex isolated credential cleanup failed", retryable: false };
        }
        RESULT_META.set(result, { servedBy: req.model, continuations: 0, firstCallIn: input });
        outer.events.push({ t: "usage", usage, final: terminal, at: deps.clock.now() });
        outer.events.push({ t: "result", stop: result.stop, denials: [], durationMs: result.durationMs, at: deps.clock.now() });
        outer.resolve(result);
      } catch (err) {
        if (child) {
          try {
            child.kill("SIGKILL");
          } catch {
            /* gone */
          }
        }
        const e = MitoriError.from(err);
        outer.fail(e.code, e.message);
      } finally {
        if (child) await child.exited.catch(() => -1);
        if (prepared) await prepared.cleanup().catch(() => {});
      }
    })();
    return outer;
  };
  return { id: "codex-cli", detect, run };
}
