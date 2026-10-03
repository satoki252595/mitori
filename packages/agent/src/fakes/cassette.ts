import { CHARS_PER_TOKEN, type ClaudeModelId, type EngineId, type Iso8601, PRICING, priceUsage, type Xxh3 } from "@mitori/core";
import type { ScriptedChild, ScriptLine } from "./child.ts";

/* Shapes of the testkit contract §5 (packages/testkit/src/contract.ts), restated structurally: agent cannot import testkit. */

export interface CassetteHeader {
  v: "mitori.cassette/1";
  key: string;
  match: "exact" | "scenario" | "synthetic";
  engine: EngineId;
  cli?: string;
  model: string;
  effort: string;
  tools: "none" | "read_edit";
  promptVer?: string;
  systemHash: Xxh3;
  promptHash: Xxh3;
  recordedAt: Iso8601;
  usage: { in: number; cacheWrite: number; cacheWrite1h: number; cacheRead: number; out: number; apiUsd: number };
  durationMs: number;
  ttftMs?: number;
  /** Process exit code (−1 = the replayed child never exits on its own: `hang`). */
  exit: number;
}

export interface CassetteLine {
  dt: number;
  line?: string;
  stderr?: string;
  effect?: { kind: "patch"; diff: string };
  phase?: "main" | "after_sigint";
}

export interface Cassette {
  header: CassetteHeader;
  lines: readonly CassetteLine[];
}

export interface KeyContext {
  cwd: string;
  home: string;
  root?: string;
}

export type SynthFailure =
  | "rate_limit_429"
  | "refusal"
  | "auth_source_api_key"
  | "truncated_no_result"
  | "hang"
  | "garbage_stdout"
  | "budget_exceeded"
  | "exit_nonzero"
  | "stdin_warning"
  | "permission_denied"
  | "split_multibyte";

export interface SynthOptions {
  model?: string;
  sessionId?: string;
  apiKeySource?: string;
  chunkChars?: number;
  dtMs?: number;
  usage?: Partial<{ input_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number; output_tokens: number }>;
  window?: { fiveHour: number; sevenDay?: number; overage?: boolean };
  structured?: unknown;
  denials?: readonly { tool: string; target?: string }[];
  /** `init.tools` override (agent-mode scenarios). */
  tools?: readonly string[];
}

/**
 * `normalizeForKey` (testing spec §3.3), applied in this order: CRLF, fence nonces, absolute paths (longest first),
 * ISO timestamps, model-invisible random ids. `tmp` is `realpath(os.tmpdir())` (passed in: this module is pure).
 */
export function normalizeForKeyWith(text: string, ctx: KeyContext, tmp: string | null): string {
  let s = text.replace(/\r\n/g, "\n");
  // gen's labelled fence is `<<<DATA nonce label>>>` (spec regex); loop's UNTRUSTED_FENCE is `<<<DATA nonce>>>` — both
  s = s.replace(/<<<DATA [0-9a-hjkmnp-tv-z]{8}(?=[ >])/g, "<<<DATA ########").replace(/<<<END [0-9a-hjkmnp-tv-z]{8}>>>/g, "<<<END ########>>>");
  const paths: [string, string][] = [
    [ctx.cwd, "$CWD"],
    [ctx.home, "$MITORI_HOME"],
  ];
  if (ctx.root) paths.push([ctx.root, "$ROOT"]);
  if (tmp) paths.push([tmp, "$TMP"]);
  for (const [p, v] of paths.filter(([p]) => p.length > 0).sort((a, b) => b[0].length - a[0].length)) s = s.split(p).join(v);
  s = s.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z/g, "$TS");
  s = s.replace(/\b(th|m|j|es|rq|us|tr|pr|ck)_[0-9a-hjkmnp-tv-z]{8,12}\b/g, (_m, p: string) => `$${p}_ID`);
  return s;
}

const SID = "00000000-0000-4000-8000-000000000000";

/** Cassette → child script (stdout/stderr lines; effects are applied by the replay spawner). */
export function cassetteScript(c: Cassette): ScriptedChild {
  const lines: ScriptLine[] = [];
  for (const l of c.lines) {
    if (l.line !== undefined) lines.push({ line: l.line, dt: l.dt, phase: l.phase ?? "main" });
    else if (l.stderr !== undefined) lines.push({ stderr: l.stderr, dt: l.dt, phase: l.phase ?? "main" });
  }
  return c.header.exit < 0 ? { lines, hang: true } : { lines, exitCode: c.header.exit };
}

/* ---- synth: hand-written claude stream-json scenarios (testing spec §3.6) ---- */

interface Built {
  lines: CassetteLine[];
  exit: number;
}

const priced = (model: string): ClaudeModelId => (model in PRICING ? (model as ClaudeModelId) : "claude-sonnet-5-5");

function base(o: SynthOptions) {
  const model = o.model ?? "claude-sonnet-5-5";
  const sid = o.sessionId ?? SID;
  const dt = o.dtMs ?? 10;
  const L = (obj: unknown): CassetteLine => ({ dt, line: JSON.stringify(obj) });
  const init = (tools: string[]) =>
    L({
      type: "system",
      subtype: "init",
      cwd: "$CWD",
      session_id: sid,
      tools,
      mcp_servers: [],
      model,
      permissionMode: "default",
      slash_commands: [],
      apiKeySource: o.apiKeySource ?? "none",
      skills: [],
      plugins: [],
    });
  return { model, sid, dt, L, init };
}

function usageOf(o: SynthOptions, outChars: number, model: string) {
  const tok = CHARS_PER_TOKEN[PRICING[priced(model)].tokenizer].code;
  return {
    input_tokens: o.usage?.input_tokens ?? 900,
    cache_creation_input_tokens: o.usage?.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: o.usage?.cache_read_input_tokens ?? 0,
    output_tokens: o.usage?.output_tokens ?? Math.max(1, Math.ceil(outChars / tok)),
  };
}

function turn(o: SynthOptions, text: string, extra: { result?: Record<string, unknown>; stop?: string; skipResult?: boolean } = {}): CassetteLine[] {
  const { model, sid, L, init } = base(o);
  const structured = o.structured !== undefined;
  const u = usageOf(o, structured ? JSON.stringify(o.structured).length : text.length, model);
  const out: CassetteLine[] = [init(o.tools ? [...o.tools] : structured ? ["StructuredOutput"] : [])];
  out.push(L({ type: "system", subtype: "status", status: "requesting", session_id: sid }));
  out.push(
    L({ type: "stream_event", event: { type: "message_start", message: { model, id: "msg_synth", usage: { ...u, output_tokens: 1 } } }, session_id: sid }),
  );
  const chunk = Math.max(1, o.chunkChars ?? 40);
  if (structured) {
    const json = JSON.stringify(o.structured);
    out.push(
      L({
        type: "stream_event",
        event: { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_synth", name: "StructuredOutput", input: {} } },
      }),
    );
    for (let i = 0; i < json.length; i += chunk)
      out.push(
        L({
          type: "stream_event",
          event: { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: json.slice(i, i + chunk) } },
        }),
      );
    out.push(
      L({ type: "assistant", message: { id: "msg_synth", content: [{ type: "tool_use", id: "toolu_synth", name: "StructuredOutput", input: o.structured }] } }),
    );
    out.push(
      L({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_synth", content: "Structured output provided successfully" }] } }),
    );
  } else {
    out.push(L({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } }));
    for (let i = 0; i < text.length; i += chunk)
      out.push(L({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(i, i + chunk) } } }));
    out.push(L({ type: "assistant", message: { id: "msg_synth", content: [{ type: "text", text }] } }));
  }
  out.push(L({ type: "stream_event", event: { type: "content_block_stop", index: 0 } }));
  const stop = extra.stop ?? (structured ? "tool_use" : "end_turn");
  out.push(L({ type: "stream_event", event: { type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: u.output_tokens } } }));
  out.push(L({ type: "stream_event", event: { type: "message_stop" } }));
  if (o.window) {
    const w = o.window;
    out.push(
      L({
        type: "rate_limit_event",
        rate_limit_info: {
          status: "allowed",
          isUsingOverage: w.overage === true,
          unifiedWindows: {
            five_hour: { utilization: w.fiveHour, resetsAt: 1_767_240_000 },
            ...(w.sevenDay !== undefined ? { seven_day: { utilization: w.sevenDay, resetsAt: 1_767_800_000 } } : {}),
          },
        },
      }),
    );
  }
  if (extra.skipResult) return out;
  const usd = priceUsage(
    priced(model),
    { in: u.input_tokens, cacheWrite5m: u.cache_creation_input_tokens, cacheWrite1h: 0, cacheRead: u.cache_read_input_tokens, out: u.output_tokens },
    false,
  );
  out.push(
    L({
      type: "result",
      subtype: "success",
      is_error: false,
      result: structured ? JSON.stringify(o.structured) : text,
      ...(structured ? { structured_output: o.structured } : {}),
      session_id: sid,
      total_cost_usd: usd,
      usage: {
        ...u,
        output_tokens_details: { thinking_tokens: 0 },
        cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: u.cache_creation_input_tokens },
      },
      modelUsage: {
        [model]: {
          inputTokens: u.input_tokens,
          outputTokens: u.output_tokens,
          cacheReadInputTokens: u.cache_read_input_tokens,
          cacheCreationInputTokens: u.cache_creation_input_tokens,
          costUSD: usd,
        },
      },
      permission_denials: (o.denials ?? []).map((d) => ({ tool_name: d.tool, tool_input: d.target === undefined ? {} : { file_path: d.target } })),
      duration_ms: 1200,
      ttft_ms: 600,
      num_turns: 1,
      stop_reason: stop,
      terminal_reason: "completed",
      ...extra.result,
    }),
  );
  return out;
}

function header(o: SynthOptions, name: string, built: Built): Cassette {
  const model = o.model ?? "claude-sonnet-5-5";
  let usage = { in: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, out: 0, apiUsd: 0 };
  for (const l of built.lines) {
    if (!l.line?.includes('"type":"result"')) continue;
    const r = JSON.parse(l.line) as { usage?: Record<string, number>; total_cost_usd?: number };
    const u = r.usage ?? {};
    usage = {
      in: u.input_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      cacheWrite1h: 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
      out: u.output_tokens ?? 0,
      apiUsd: r.total_cost_usd ?? 0,
    };
  }
  return {
    header: {
      v: "mitori.cassette/1",
      key: `scenario:${name}`,
      match: "synthetic",
      engine: "claude-cli",
      model,
      effort: "low",
      tools: "none",
      systemHash: "0000000000000000" as Xxh3,
      promptHash: "0000000000000000" as Xxh3,
      recordedAt: "2026-01-01T00:00:00.000Z" as Iso8601,
      usage,
      durationMs: 1200,
      exit: built.exit,
    },
    lines: built.lines,
  };
}

function failure(kind: SynthFailure, o: SynthOptions): Built {
  const { sid, L, init } = base(o);
  const errResult = (subtype: string, extra: Record<string, unknown>) =>
    L({
      type: "result",
      subtype,
      is_error: true,
      session_id: sid,
      total_cost_usd: 0,
      usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 },
      permission_denials: [],
      duration_ms: 50,
      num_turns: 1,
      ...extra,
    });
  switch (kind) {
    case "rate_limit_429": {
      const retry = (attempt: number) =>
        L({ type: "system", subtype: "api_retry", attempt, max_retries: 2, retry_delay_ms: 500, error_status: 429, error: "rate_limit", session_id: sid });
      return {
        lines: [init([]), retry(1), retry(2), errResult("error_during_execution", { api_error_status: 429, result: "API Error: 429 rate_limit_error" })],
        exit: 1,
      };
    }
    case "refusal": {
      const t = turn(o, "", { stop: "refusal", result: { stop_reason: "refusal", result: "" } });
      return {
        lines: t.map((l) =>
          l.line?.includes('"message_delta"')
            ? { ...l, line: l.line.replace('"stop_reason":"refusal"', '"stop_reason":"refusal","stop_details":{"category":"cyber"}') }
            : l,
        ),
        exit: 0,
      };
    }
    case "auth_source_api_key":
      return { lines: turn({ ...o, apiKeySource: "ANTHROPIC_API_KEY" }, "hello"), exit: 0 };
    case "truncated_no_result":
      return { lines: turn(o, "partial answer", { skipResult: true }), exit: 0 };
    case "hang":
      return { lines: turn(o, "x", { skipResult: true }).slice(0, 4), exit: -1 };
    case "garbage_stdout": {
      const t = turn(o, "hello world, this answer survives garbage");
      const g = (s: string): CassetteLine => ({ dt: 1, line: s });
      return { lines: [g("Warning: something odd"), ...t.slice(0, 3), g(""), g("\u001b[33mcolored\u001b[0m"), g("not json either"), ...t.slice(3)], exit: 0 };
    }
    case "budget_exceeded":
      return {
        lines: [
          ...turn(o, "a long answer that costs too much", { skipResult: true }),
          errResult("error_max_budget_usd", {
            terminal_reason: "budget_exhausted",
            total_cost_usd: 0.11,
            usage: { input_tokens: 900, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 400 },
          }),
        ],
        exit: 1,
      };
    case "exit_nonzero":
      return { lines: Array.from({ length: 50 }, (_, i) => ({ dt: 1, stderr: `error line ${i + 1}` })), exit: 2 };
    case "stdin_warning":
      return { lines: [{ dt: 1, stderr: "Warning: no stdin data received in 3s, proceeding without it." }, ...turn(o, "ok")], exit: 0 };
    case "permission_denied":
      return { lines: turn({ ...o, denials: o.denials ?? [{ tool: "Edit", target: "$CWD/README.md" }] }, "done"), exit: 0 };
    case "split_multibyte":
      return { lines: turn(o, "設計書の見取り図を設計する"), exit: 0 };
  }
}

/** Synthesizer of claude stream-json cassettes. */
export const synthCassette = {
  text(text: string, o: SynthOptions = {}): Cassette {
    return header(o, "text", { lines: turn(o, text), exit: 0 });
  },
  genLines(lines: readonly (object | string)[], o: SynthOptions = {}): Cassette {
    const text = lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n");
    return header(o, "genLines", { lines: turn(o, `${text}\n`), exit: 0 });
  },
  failure(kind: SynthFailure, o: SynthOptions = {}): Cassette {
    return header(o, kind, failure(kind, o));
  },
  /** Several turns of one resident process (parking / continuation). */
  turns(texts: readonly string[], o: SynthOptions = {}): Cassette {
    let cost = 0;
    const lines: CassetteLine[] = [];
    for (const t of texts) {
      const one = turn(o, t);
      const last = one[one.length - 1] as CassetteLine;
      const r = JSON.parse(last.line as string) as { total_cost_usd: number };
      cost = Math.round((cost + r.total_cost_usd) * 1e6) / 1e6;
      r.total_cost_usd = cost; // cumulative per process, like the CLI
      lines.push(...one.slice(0, -1), { ...last, line: JSON.stringify(r) });
    }
    return header(o, "turns", { lines, exit: 0 });
  },
};
