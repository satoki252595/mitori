/**
 * Scripted `GenEngine` (scenario cassettes in miniature): a router picks the reply per call; text is streamed in
 * `chunk`-char deltas; usage models the prompt cache (a system prompt seen before is a cache read — the
 * PT-05 / GEN-I-020 observable); `continueWith` is available while the process is "parked".
 */
import { type ClaudeModelId, type Hasher, priceUsage, type StopReason, type Usage } from "@mitori/core";
import type { GenCall, GenCallResult, GenCallRun, GenEngine } from "../contract.ts";

/** One scripted reply. */
export interface ScriptReply {
  /** NDJSON lines (joined with "\n"). */
  lines?: string[];
  /** Raw text instead of lines. */
  text?: string;
  /** Stop reason (default "end"). */
  stop?: StopReason;
  /** Refusal details. */
  refusal?: { category: string | null };
  /** CLI-internal continuations. */
  continuations?: number;
  /** Error details. */
  error?: { code: "E_AGENT_EXIT" | "E_AGENT_AUTH_SOURCE" | "E_AGENT_TIMEOUT" | "E_BUDGET_EXCEEDED"; message: string; retryable: boolean };
  /** Stream the first chunk (or the first `hangAfterLines` complete lines), then wait until stopped. */
  hang?: boolean;
  /** With `hang`: complete lines streamed before hanging. */
  hangAfterLines?: number;
  /** Override the reported API-equivalent cost. */
  apiUsd?: number;
  /** Wait for this before streaming. */
  gate?: Promise<void>;
  /** The process exits after this turn (no longer parked, although `continueWith` is still present). */
  exits?: boolean;
}

/** Router input. */
export interface Turn {
  /** Attempt of the call (2 for any retry). */
  attempt: 1 | 2;
  /** True for a continuation of the parked process. */
  continuation: boolean;
  /** User message text of this turn (unit, or the retry message). */
  message: string;
}

/** A recorded engine turn. */
export interface RecordedCall {
  /** The call (first turn) or the call of the parked process (continuation). */
  call: GenCall;
  /** Turn. */
  turn: Turn;
  /** System prompt bytes. */
  system: string;
  /** Usage reported. */
  usage: Usage;
  /** Stop reasons requested via stop(). */
  stopped: string[];
}

/** Factory options. */
export interface ScriptedEngineOptions {
  /** Reply picker. */
  router: (call: GenCall, turn: Turn) => ScriptReply;
  /** Hasher (system identity). */
  hasher: Hasher;
  /** Token estimate. */
  tokens?: (s: string) => number;
  /** Delta size. */
  chunk?: number;
  /** Keep the process parked after a result (continuation available). */
  parkable?: boolean;
}

/** Scripted engine handle. */
export interface ScriptedEngine extends GenEngine {
  /** Recorded turns. */
  calls: RecordedCall[];
  /** Number of close() calls. */
  closed: number;
}

/** Factory. */
export function createScriptedEngine(opts: ScriptedEngineOptions): ScriptedEngine {
  const tokens = opts.tokens ?? ((s: string) => Math.ceil(s.length / 2.3));
  const chunk = opts.chunk ?? 7;
  const seen = new Set<string>();
  const engine: ScriptedEngine = {
    id: "claude-cli",
    caps: { streaming: true, batch: false, countTokens: false, structuredOutputs: true, serverFallback: false, explicitCache: false },
    calls: [],
    closed: 0,
    run(call) {
      return turn(call, { attempt: call.attempt, continuation: false, message: call.layout.retry ?? call.layout.unit }, 0);
    },
  };

  function turn(call: GenCall, t: Turn, convTokens: number): GenCallRun {
    const reply = opts.router(call, t);
    const text = reply.text ?? (reply.lines ?? []).join("\n");
    const system = call.layout.pack === null ? call.layout.system : `${call.layout.system}\n${call.layout.pack}`;
    const sysKey = opts.hasher.xxh3(`${call.model}\n${system}`);
    const p = tokens(system);
    const msg = tokens(t.message) + (call.attempt === 2 && !t.continuation && call.layout.retry ? tokens(call.layout.unit) : 0);
    const warm = seen.has(sysKey);
    seen.add(sysKey);
    const cacheRead = t.continuation ? p + convTokens : warm ? p : 0;
    const cacheWrite = t.continuation ? msg : warm ? msg : p + msg;
    const out = tokens(text);
    const model = call.model as ClaudeModelId;
    const usage: Usage = {
      in: 0,
      cacheWrite,
      cacheWrite1h: 0,
      cacheRead,
      out,
      apiUsd: reply.apiUsd ?? priceUsage(model, { in: 0, cacheWrite5m: cacheWrite, cacheWrite1h: 0, cacheRead, out }, false),
      pricingVer: "test",
    };
    const rec: RecordedCall = { call, turn: t, system, usage, stopped: [] };
    engine.calls.push(rec);
    let stopped = false;
    let release: () => void = () => undefined;
    const halted = new Promise<void>((r) => {
      release = r;
    });
    let resolveResult: (r: GenCallResult) => void = () => undefined;
    const result = new Promise<GenCallResult>((r) => {
      resolveResult = r;
    });
    const finish = (stop: StopReason) => {
      const r: GenCallResult & { continuations?: number; error?: ScriptReply["error"] } = {
        stop,
        text,
        usage,
        refusal: reply.refusal ?? null,
        durationMs: 10,
        auth: "subscription",
      };
      if (reply.continuations) r.continuations = reply.continuations;
      if (reply.error) r.error = reply.error;
      resolveResult(r);
    };
    let parked = opts.parkable ?? true;
    const run: GenCallRun = {
      text: {
        async *[Symbol.asyncIterator]() {
          if (reply.gate) await Promise.race([reply.gate, halted]);
          let cutoff = text.length;
          if (reply.hang && reply.hangAfterLines !== undefined) {
            cutoff = 0;
            for (let k = 0; k < reply.hangAfterLines; k++) cutoff = text.indexOf("\n", cutoff) + 1;
          }
          for (let i = 0; i < text.length; i += chunk) {
            if (stopped) break;
            await Promise.resolve();
            const end = Math.min(i + chunk, cutoff);
            if (end > i) yield text.slice(i, end);
            if (reply.hang && (reply.hangAfterLines === undefined || end >= cutoff)) {
              await halted;
              break;
            }
          }
          if (reply.exits) parked = false;
          finish(stopped ? "cancelled" : (reply.stop ?? "end"));
        },
      },
      result,
      stop(reason) {
        rec.stopped.push(reason);
        stopped = true;
        release();
      },
      async close() {
        parked = false;
        engine.closed++;
      },
    };
    if (opts.parkable ?? true) {
      run.continueWith = (message) => {
        if (!parked) throw new Error("process gone");
        return turn(call, { attempt: 2, continuation: true, message }, msg + out);
      };
    }
    return run;
  }

  return engine;
}

/** First `N|` line under a `=== <path>` header of a message (to build valid cites). */
export function firstShown(message: string, pathPrefix = ""): { path: string; line: number } | null {
  let file: string | null = null;
  for (const l of message.split("\n")) {
    const h = /^=== (\S+)/.exec(l);
    if (h) {
      file = h[1] as string;
      continue;
    }
    const n = /^(\d+)\|/.exec(l);
    if (n && file?.startsWith(pathPrefix)) return { path: file, line: Number(n[1]) };
  }
  return null;
}

/** A router that answers every M2 prompt with a valid compact reply. */
export function validRouter(call: GenCall, t: Turn): ScriptReply {
  const msg = call.layout.unit;
  const j = (o: unknown) => JSON.stringify(o);
  const end = (n: number) => j({ t: "end", blocks: n });
  if (t.continuation || t.attempt === 2) return { lines: [end(0)] };
  switch (call.spec.id) {
    case "gen.overview": {
      const doc = firstShown(msg, "README");
      const cite = doc ? `fact ${doc.path}:${doc.line}` : "fact";
      const existing = (aspect: string) => new RegExp(`^> (b_\\w{8}) aspect=${aspect} `, "m").exec(msg)?.[1];
      return {
        lines: [
          j({
            t: "block",
            id: existing("tldr") ?? "new:1",
            aspect: "tldr",
            md: `読書リストを管理する[[1]]。${call.mode === "final" ? "最終版だ。" : ""}`,
            claims: { "1": cite },
          }),
          j({
            t: "block",
            id: existing("problem") ?? "new:2",
            aspect: "problem",
            md: "読みたい本を忘れないようにする[[1]]。",
            claims: { "1": "architecture" },
          }),
          end(2),
        ],
      };
    }
    case "gen.module": {
      const mod = /TASK: Write the page for module (md_\w{8})/.exec(msg)?.[1] as string;
      const shown = firstShown(msg);
      const cite = shown ? `behavior ${shown.path}:${shown.line}-${shown.line}` : "behavior";
      return {
        lines: [
          j({ t: "block", id: "new:1", aspect: "responsibility", md: "このモジュールの責務を説明する[[1]]。", claims: { "1": cite } }),
          j({ t: "block", id: "new:2", aspect: "interface", md: "- 公開関数を提供する[[1]]。", claims: { "1": cite } }),
          j({ t: "module", module: mod, name: `名前${mod.slice(-2)}`, summary: "要約" }),
          j({ t: "term", term: `用語${mod.slice(-1)}`, yomi: "ようご", def: "説明。" }),
          end(2),
        ],
      };
    }
    case "gen.parent": {
      const mod = /TASK: Write the page for parent module (md_\w{8})/.exec(msg)?.[1] as string;
      return {
        lines: [
          j({ t: "block", id: "new:1", aspect: "responsibility", md: "子モジュールをまとめる[[1]]。", claims: { "1": "architecture" } }),
          j({ t: "block", id: "new:2", aspect: "structure", md: "- 二つの子がある[[1]]。", claims: { "1": "architecture" } }),
          j({ t: "module", module: mod, name: "中核", summary: "中核の部品" }),
          end(2),
        ],
      };
    }
    case "gen.labels": {
      const ids = [...msg.matchAll(/^> (md_\w{8}) paths=/gm)].map((m) => m[1] as string);
      return { lines: [...ids.map((id) => j({ t: "module", module: id, name: `ラベル${id.slice(-2)}` })), end(0)] };
    }
    case "gen.flows":
      return {
        lines: [
          j({ t: "block", id: "new:1", aspect: "intro", md: "入口から処理が流れる。", claims: {} }),
          j({ t: "flow", key: "login", title: "ログイン" }),
          j({ t: "block", id: "new:2", aspect: "summary", md: "ログインの流れだ。", claims: {} }),
          j({ t: "block", id: "new:3", aspect: "steps", md: "1. 受け付ける[[1]]", claims: { "1": "behavior src/http/server.ts:5-7" } }),
          j({ t: "flow", key: "cli", title: "コマンド" }),
          j({ t: "block", id: "new:4", aspect: "summary", md: "コマンドから呼ぶ。", claims: {} }),
          j({ t: "block", id: "new:5", aspect: "steps", md: "1. 引数を渡す", claims: {} }),
          end(5),
        ],
      };
    case "gen.glossary":
      return { lines: [j({ t: "term", term: "セッション", yomi: "せっしょん", en: "session", def: "ログイン状態の記録。" }), end(0)] };
    default:
      return { lines: [end(0)] };
  }
}
