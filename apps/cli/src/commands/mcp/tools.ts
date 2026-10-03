/**
 * The 8 MCP tools over the daemon HTTP API (spec §10.8 table). Text results only; repository-derived text
 * (`get_doc`, `find_symbol`, `list_threads`) is wrapped in an UNTRUSTED_FENCE with the copy-mode preamble [SEC-04].
 * Arguments are checked against the catalogue schemas before any call; errors become `error <CODE>: <message>`.
 */
import type { ApiClient } from "@mitori/client";
import {
  type Anchor,
  type DocOutline,
  ID_ALPHABET,
  MitoriError,
  type PatchEdit,
  type Random,
  type RepoPath,
  type ThreadId,
  type ThreadSummary,
  type WorkspaceKey,
} from "@mitori/core";
import { errorLines } from "../check.ts";
import { formatError } from "../io.ts";
import { COPY_PREAMBLE, MCP_LIMITS, UNTRUSTED_FENCE } from "../loop-contract.ts";

/** What the tools need: an API client for the workspace (resolved lazily on the first call) and entropy. */
export interface ToolEnv {
  workspace(client: string, signal: AbortSignal): Promise<{ api: ApiClient; ws: WorkspaceKey }>;
  random: Random;
  /** Wait between job polls (submit_patch). */
  sleep(ms: number): Promise<void>;
  now(): number;
}

const TH_RE = /^th_[0-9a-z]{8}$/;
const bad = (msg: string) => new MitoriError("E_INVALID_INPUT", msg);

function str(args: Record<string, unknown>, k: string, opts: { min?: number; max?: number; optional?: boolean } = {}): string | undefined {
  const v = args[k];
  if (v === undefined && opts.optional) return undefined;
  if (typeof v !== "string") throw bad(`${k} must be a string`);
  if (v.length < (opts.min ?? 0) || v.length > (opts.max ?? Number.MAX_SAFE_INTEGER)) throw bad(`${k} length must be in ${opts.min ?? 0}..${opts.max ?? "∞"}`);
  return v;
}
function int(args: Record<string, unknown>, k: string, min: number, max: number): number | undefined {
  const v = args[k];
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw bad(`${k} must be an integer in ${min}..${max}`);
  return v;
}
function oneOf<T extends string>(args: Record<string, unknown>, k: string, values: readonly T[]): T | undefined {
  const v = args[k];
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !(values as readonly string[]).includes(v)) throw bad(`${k} must be one of ${values.join("|")}`);
  return v as T;
}
function thread(args: Record<string, unknown>): ThreadId {
  const v = args.thread_id;
  if (typeof v !== "string" || !TH_RE.test(v)) throw bad("thread_id must match ^th_[0-9a-z]{8}$");
  return v as ThreadId;
}
function only(args: Record<string, unknown>, keys: readonly string[]): void {
  for (const k of Object.keys(args)) if (!keys.includes(k)) throw bad(`unknown argument ${k}`);
}

/** Repository-derived text inside a fresh-nonce DATA fence, every line `> `-prefixed, after the copy-mode preamble. */
export function fenced(text: string, random: Random): string {
  let nonce = "";
  do {
    nonce = Array.from(random.bytes(UNTRUSTED_FENCE.nonceLength), (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
  } while (text.includes(nonce));
  const body = text
    .replace(/\n$/, "")
    .split("\n")
    .map((l) => (l === "" ? ">" : `${UNTRUSTED_FENCE.quotePrefix}${l}`))
    .join("\n");
  return `${COPY_PREAMBLE}\n${UNTRUSTED_FENCE.open.replace("{nonce}", nonce)}\n${body}\n${UNTRUSTED_FENCE.close.replace("{nonce}", nonce)}`;
}

const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return [...t].length > max ? `${[...t].slice(0, max).join("")}…` : t;
};

/** `path:start-end` / `§<section> "<quote 40>"` / `diagram:<dg>/<node>` (spec §10.1 anchor labels). */
export function anchorLabel(a: Anchor, sectionOf: (block: string) => string | null): string {
  if (a.primary === "code" && a.code) return `${a.code.path}:${a.code.start}-${a.code.end}`;
  if (a.primary === "diagram" && a.diagram) return `diagram:${a.diagram.diagram}/${oneLine(a.diagram.node ?? a.diagram.edge ?? "", 30)}`;
  if (a.doc) {
    const section = sectionOf(a.doc.block) ?? "?";
    const quote = a.doc.quote?.exact;
    return quote ? `§${section} "${oneLine(quote, 40).replaceAll('"', '\\"')}"` : `§${section} ${a.doc.block}`;
  }
  if (a.code) return `${a.code.path}:${a.code.start}-${a.code.end}`;
  return "?";
}

const STATE_FILTER: Record<string, (t: ThreadSummary) => boolean> = {
  open: (t) => t.state === "open",
  queued: (t) => t.state === "queued" || t.state === "running",
  needs_input: (t) => t.state === "needs_input",
  answered: (t) => t.state === "answered",
  all: (t) => t.state !== "resolved" && t.state !== "draft",
};

async function sectionIndex(api: ApiClient, ws: WorkspaceKey, threads: readonly ThreadSummary[], signal: AbortSignal): Promise<(b: string) => string | null> {
  if (!threads.some((t) => t.anchor.doc)) return () => null;
  let outline: DocOutline;
  try {
    outline = await api.call("GET /ws/:ws/doc", { params: { ws }, signal });
  } catch {
    return () => null;
  }
  const of = new Map<string, string>();
  for (const s of outline.sections) for (const b of s.blocks) of.set(b, s.id);
  return (b) => of.get(b) ?? null;
}

/** Run one tool (the `ToolRunner` of the protocol). */
export async function runTool(
  env: ToolEnv,
  name: string,
  args: Record<string, unknown>,
  ctx: { client: string; signal: AbortSignal },
): Promise<{ text: string; isError?: boolean }> {
  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(MCP_LIMITS.callTimeoutMs)]);
  try {
    return { text: await dispatch(env, name, args, ctx.client, signal) };
  } catch (e) {
    return { text: formatError(MitoriError.from(e)).trimEnd(), isError: true };
  }
}

async function dispatch(env: ToolEnv, name: string, args: Record<string, unknown>, client: string, signal: AbortSignal): Promise<string> {
  switch (name) {
    case "mitori_status": {
      only(args, []);
      const { api, ws } = await env.workspace(client, signal);
      const st = await api.call("GET /ws/:ws", { params: { ws }, signal });
      return `doc r${st.rev} · open threads ${st.counts.openThreads} · stale blocks ${st.counts.staleBlocks} · running jobs ${st.counts.runningJobs}`;
    }
    case "mitori_list_threads": {
      only(args, ["state", "limit"]);
      const state = oneOf(args, "state", ["open", "queued", "needs_input", "answered", "all"] as const) ?? "open";
      const limit = int(args, "limit", 1, 50) ?? 20;
      const { api, ws } = await env.workspace(client, signal);
      const page = await api.call("GET /ws/:ws/threads", { params: { ws }, query: { limit: 200 }, signal });
      const keep = STATE_FILTER[state] as (t: ThreadSummary) => boolean;
      const threads = page.items.filter(keep).slice(0, limit);
      if (threads.length === 0) return `no ${state === "all" ? "" : `${state} `}threads`;
      const sectionOf = await sectionIndex(api, ws, threads, signal);
      const lines = threads.map((t) => `${t.id} ${t.state} ${t.intent} ${anchorLabel(t.anchor, sectionOf)} "${oneLine(t.title, 40).replaceAll('"', '\\"')}"`);
      return fenced(lines.join("\n"), env.random);
    }
    case "mitori_get_bundle": {
      only(args, ["thread_id", "budget_tokens", "line_numbers"]);
      const th = thread(args);
      const budget = int(args, "budget_tokens", 500, 12_000) ?? 4000;
      if (args.line_numbers !== undefined && typeof args.line_numbers !== "boolean") throw bad("line_numbers must be a boolean");
      const { api, ws } = await env.workspace(client, signal);
      return api.call("GET /ws/:ws/threads/:th/bundle", {
        params: { ws, th },
        query: { budget, mode: "pull", ...(args.line_numbers === true ? { lines: "1" } : {}) },
        signal,
      });
    }
    case "mitori_get_doc": {
      only(args, ["ref", "depth"]);
      const ref = str(args, "ref", { min: 1, max: 200 }) as string;
      const depth = int(args, "depth", 0, 3);
      const { api, ws } = await env.workspace(client, signal);
      return fenced(await api.call("GET /ws/:ws/doc/text", { params: { ws }, query: { ref, ...(depth !== undefined ? { depth } : {}) }, signal }), env.random);
    }
    case "mitori_find_symbol": {
      only(args, ["query", "limit"]);
      const q = str(args, "query", { min: 1, max: 200 }) as string;
      const limit = int(args, "limit", 1, 20) ?? 10;
      const { api, ws } = await env.workspace(client, signal);
      const found = await api.call("GET /ws/:ws/symbols", { params: { ws }, query: { q, limit }, signal });
      if (found.length === 0) return `no symbol matches ${JSON.stringify(q)}`;
      return fenced(found.map((s) => `${s.qualname} ${s.kind} ${s.path}:${s.start}-${s.end} ${oneLine(s.signature, 160)}`).join("\n"), env.random);
    }
    case "mitori_reply": {
      only(args, ["thread_id", "kind", "body", "files"]);
      const th = thread(args);
      const kind = oneOf(args, "kind", ["done", "answer", "question"] as const);
      if (!kind) throw bad("kind is required");
      const body = str(args, "body", { min: 1, max: 8000 }) as string;
      const files = args.files;
      if (files !== undefined && (!Array.isArray(files) || files.length > 20 || !files.every((f) => typeof f === "string")))
        throw bad("files must be ≤ 20 strings");
      const { api, ws } = await env.workspace(client, signal);
      const res = await api.call("POST /ws/:ws/threads/:th/reply", {
        params: { ws, th },
        body: { kind, body, ...(files ? { files: files as RepoPath[] } : {}) },
        signal,
      });
      return `ok ${th} → ${res.state}`;
    }
    case "mitori_submit_patch":
      return submitPatch(env, args, client, signal);
    case "mitori_propose_resolution": {
      only(args, ["thread_id", "resolution", "note"]);
      const th = thread(args);
      const resolution = oneOf(args, "resolution", ["applied", "answered", "wontfix", "duplicate", "obsolete", "needs_human"] as const);
      if (!resolution) throw bad("resolution is required");
      const note = str(args, "note", { max: 500, optional: true });
      const { api, ws } = await env.workspace(client, signal);
      await api.call("POST /ws/:ws/threads/:th/propose-resolution", {
        params: { ws, th },
        body: { resolution, ...(note !== undefined ? { note } : {}) },
        signal,
      });
      return `proposed ${resolution} for ${th} (a human confirms in mitori)`;
    }
    default:
      throw new MitoriError("E_NOT_FOUND", `unknown tool ${name}`);
  }
}

const SETTLED = new Set(["ready", "accepted", "partially_accepted", "rejected", "done", "failed", "cancelled", "reverted"]);

async function submitPatch(env: ToolEnv, args: Record<string, unknown>, client: string, signal: AbortSignal): Promise<string> {
  only(args, ["thread_id", "edits", "doc_update"]);
  const th = thread(args);
  const raw = args.edits;
  if (!Array.isArray(raw) || raw.length > 40) throw bad("edits must be an array of ≤ 40 edits");
  const edits: PatchEdit[] = raw.map((e, i) => {
    if (e === null || typeof e !== "object" || Array.isArray(e)) throw bad(`edits[${i}] must be an object`);
    const r = e as Record<string, unknown>;
    only(r, ["path", "start", "end", "first_line", "new_text", "base"]);
    const path = str(r, "path", { min: 1 }) as string;
    const start = int(r, "start", 1, Number.MAX_SAFE_INTEGER);
    if (start === undefined) throw bad(`edits[${i}].start is required`);
    const end = int(r, "end", 0, Number.MAX_SAFE_INTEGER);
    const edit: PatchEdit = { path: path as RepoPath, start, newText: str(r, "new_text") as string, firstLine: str(r, "first_line") as string };
    if (end !== undefined) edit.end = end;
    const base = str(r, "base", { optional: true });
    if (base !== undefined) edit.base = base;
    return edit;
  });
  const doc = args.doc_update;
  if (doc !== undefined && doc !== null && typeof doc !== "string") throw bad("doc_update must be a string or null");
  const { api, ws } = await env.workspace(client, signal);
  const res = await api.call("POST /ws/:ws/patches", { params: { ws }, body: { thread: th, edits, docUpdate: typeof doc === "string" ? doc : null }, signal });
  // gates run in the isolated worktree: wait for them (≤ 25 s) so the agent sees the outcome in one call
  let job = res.job;
  const until = env.now() + MCP_LIMITS.gatesWaitMs;
  while (res.applied && !SETTLED.has(job.state) && env.now() < until && !signal.aborted) {
    await env.sleep(500);
    job = await api.call("GET /ws/:ws/jobs/:job", { params: { ws, job: job.id }, signal });
  }
  const lines = [`job ${job.id} ${job.state} applied=${res.applied}`];
  for (const g of job.gates) lines.push(`gate ${g.gate} ${g.status}${g.ms ? ` ${Math.round(g.ms)}ms` : ""}`);
  let text = `${lines.slice(0, MCP_LIMITS.submitPatchMaxLines).join("\n")}\n`;
  if (res.problems.length > 0) text += errorLines(res.problems.slice(0, Math.max(0, MCP_LIMITS.submitPatchMaxLines - lines.length)));
  return text.trimEnd();
}
