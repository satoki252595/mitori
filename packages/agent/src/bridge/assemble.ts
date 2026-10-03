import {
  type BinaryPin,
  CHARS_PER_TOKEN,
  type ClaudeModelId,
  type Clock,
  createSecretScanner,
  type EngineId,
  type EngineStatus,
  type EventSink,
  type GlobalSettings,
  type Hasher,
  type Logger,
  type Metrics,
  PRICING,
  type Random,
  type SseEventPayload,
} from "@mitori/core";
import { createAnthropicApiEngine, type FetchLike } from "../adapters/anthropic-engine.ts";
import { createGenericEngine } from "../adapters/generic-engine.ts";
import { createClaudeCliEngine } from "../claude/engine.ts";
import { type BridgeFs, createSandboxStore, EMPTY_REL } from "../claude/fsports.ts";
import type { AgentScheduler, Engine, EngineResult, ScheduledRequest, Spawner, UsageLedger } from "../contract.ts";
import type { UsageLedgerImpl } from "../ledger/ledger.ts";
import { createAgentScheduler } from "../scheduler/scheduler.ts";
import { RESULT_META } from "../util/run.ts";
import { timersFor } from "../util/timers.ts";

/** Deps applied by CR m1-57 / m1-65 (optional until the composition root passes all of them). */
export interface BridgeExtraDeps extends BridgeFs {
  /** HTTP for anthropic-api (defaults to the global `fetch`). */
  fetch: FetchLike;
  /** Persist a first-run binary pin into settings `pins` [CR m1-65]. Absent ⇒ the pin lives for this daemon only. */
  pin: (engine: EngineId, pin: BinaryPin) => Promise<void>;
}

export interface BridgeDeps {
  random: Random;
  metrics: Metrics;
  safePath: string;
  settings: () => GlobalSettings;
  spawner: Spawner;
  ledger: UsageLedger;
  log: Logger;
  clock: Clock;
  hasher: Hasher;
  events: EventSink<SseEventPayload>;
  home: string;
  env: Readonly<Record<string, string | undefined>>;
}

const CJK_RE = /[぀-ヿ㐀-鿿豈-﫿ｦ-ﾟ]/g;

/** Rough token count of the user message (fixed-overhead samples only). */
function promptTokens(text: string, model: ClaudeModelId): number {
  const cpt = CHARS_PER_TOKEN[PRICING[model].tokenizer];
  const cjk = text.match(CJK_RE)?.length ?? 0;
  return (text.length - cjk) / cpt.code + cjk / cpt.markdown_ja;
}

export function assembleBridge(deps: BridgeDeps & Partial<BridgeExtraDeps>): { scheduler: AgentScheduler; engines: Record<EngineId, Engine | null> } {
  const timers = timersFor(deps.clock);
  const secrets = createSecretScanner();
  const ports: BridgeFs | null = deps.safeWrite && deps.fs ? { safeWrite: deps.safeWrite, fs: deps.fs } : null;
  if (!ports) deps.log.warn("agent.bridge.no_fs_ports", { note: "claude-cli and generic runs fail until SafeWriter/FsReader are wired (CR-PENDING WP-05)" });
  const sandbox = createSandboxStore(deps.home, deps.hasher, ports);
  const home = deps.home.replace(/\/+$/, "");
  let scheduler: AgentScheduler | null = null;
  const claude = createClaudeCliEngine({
    spawner: deps.spawner,
    clock: deps.clock,
    timers,
    log: deps.log,
    metrics: deps.metrics,
    hasher: deps.hasher,
    random: deps.random,
    secrets,
    settings: deps.settings,
    home,
    env: deps.env,
    safePath: deps.safePath,
    sandbox,
    window: () => scheduler?.window() ?? null,
    fs: ports?.fs ?? null,
    ...(deps.pin ? { pin: (p: BinaryPin) => deps.pin?.("claude-cli", p) ?? Promise.resolve() } : {}),
  });
  const anthropic = createAnthropicApiEngine({
    settings: deps.settings,
    env: deps.env,
    clock: deps.clock,
    timers,
    log: deps.log,
    ledger: deps.ledger,
    fetch: deps.fetch ?? ((url, init) => globalThis.fetch(url, init)),
  });
  const generic = createGenericEngine({
    spawner: deps.spawner,
    settings: deps.settings,
    env: deps.env,
    safePath: deps.safePath,
    emptyCwd: `${home}/${EMPTY_REL}`,
    ensureEmptyCwd: () => sandbox.ensureEmptyCwd(),
    clock: deps.clock,
    timers,
    log: deps.log,
  });

  // `engines.updated` whenever a detect() result changes
  const statuses = new Map<EngineId, string>();
  const latest = new Map<EngineId, EngineStatus>();
  const withEvents = (e: Engine): Engine => {
    const detect = e.detect.bind(e);
    e.detect = async () => {
      const s = await detect();
      const sig = JSON.stringify({ ...s, checkedAt: "" });
      latest.set(e.id, s);
      if (statuses.get(e.id) !== sig) {
        statuses.set(e.id, sig);
        deps.events.emit({ type: "engines.updated", engines: [...latest.values()] });
      }
      return s;
    };
    return e;
  };

  const engines: Record<EngineId, Engine | null> = {
    "claude-cli": withEvents(claude),
    "anthropic-api": withEvents(anthropic),
    generic: withEvents(generic),
    // `session` is gen's in-session Pull engine (no process); codex-cli comes after the MVP (WP-16)
    session: null,
    "codex-cli": null,
  };

  const ledger = deps.ledger as Partial<UsageLedgerImpl>;
  const recordOverhead =
    typeof ledger.recordOverhead === "function"
      ? (req: ScheduledRequest, res: EngineResult): void => {
          const meta = RESULT_META.get(res);
          if (!meta || res.usageEstimated || res.stop !== "end" || !(req.model in PRICING)) return;
          // the fixed overhead is in the FIRST call of a turn; an agent turn's result sums every tool round-trip
          const first = meta.firstCallIn ?? (req.mode === "agent" ? null : res.usage.in + res.usage.cacheWrite + res.usage.cacheRead);
          if (first === null) return;
          const over = Math.round(first - promptTokens(req.prompt, req.model as ClaudeModelId));
          // CR-PENDING(WP-05) cr-requests #6: the profile key callers can compute (engine, mode, model, prompt version)
          ledger.recordOverhead?.(deps.hasher.xxh3(`${req.engine}\n${req.mode}\n${req.model}\n${req.promptVer}`), over);
        }
      : undefined;

  const sdeps: Parameters<typeof createAgentScheduler>[0] = {
    engines: () => engines,
    settings: deps.settings,
    ledger: deps.ledger,
    clock: deps.clock,
    timers,
    random: deps.random,
    log: deps.log,
    metrics: deps.metrics,
    events: deps.events,
    residents: () => claude.residents(),
    onBilling: (billing) => {
      if (billing === "overage") claude.closeWarm();
    },
  };
  if (recordOverhead) sdeps.recordOverhead = recordOverhead;
  scheduler = createAgentScheduler(sdeps);
  return { scheduler, engines };
}
