// Replay recorded real generations (gen-real.ts --record) through the CURRENT line validator: how many first replies
// would still be retried, and why — free, no engine call. It isolates what validator / input changes do to the same
// model output (prompt changes need a new run). The task is read back from the recorded prompt (TASK line, DATA
// sections) and the system prompt file (the repo pack is citable); file line counts come from the repository.
//
//   scripts/nd bun bench/measure/gen-replay.ts --rec <recording dir> --repo <clone> [--lang ja] [--verbose]
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { AnchorEngine } from "@mitori/anchor";
import {
  API_PREFIX,
  type Clock,
  type DocLang,
  type Hasher,
  type L1Result,
  type SectionId,
  type WorkspaceKey,
  type WorkspaceStatus,
  type WorkspaceSummary,
} from "@mitori/core";
import type { Indexer } from "@mitori/indexer";
import { startServerDaemon } from "../../apps/cli/src/daemon/server.ts";
import type { GenClaimDraft, GenPromptId, PlannedTask } from "../../packages/gen/src/contract.ts";
import { createLineValidator, planRetry } from "../../packages/gen/src/line/index.ts";
import { deriveSpans } from "../../packages/gen/src/line/mdscan.ts";
import { buildContext } from "../../packages/gen/src/prompts/context.ts";
import { createVerifier } from "../../packages/gen/src/verify/verifier.ts";

const { values: a } = parseArgs({
  options: { rec: { type: "string" }, repo: { type: "string" }, lang: { type: "string", default: "ja" }, verbose: { type: "boolean", default: false } },
});
if (!a.rec || !a.repo) throw new Error("--rec <dir> and --repo <dir> are required");
const repo = resolve(a.repo);

const textOf = (content: unknown): string =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (c as { text?: string }).text ?? "").join("\n") : "";

/** DATA sections of a rendered user message. */
function sectionsOf(msg: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re = /^<<<DATA (\w{8}) (\w+)>>>\n([\s\S]*?)\n<<<END \1>>>$/gm;
  for (const m of msg.matchAll(re)) out.set(m[2] as string, (m[3] as string).split("\n"));
  return out;
}

/** The task of a recorded prompt (prompt id, mode, target, sections) from its TASK line. */
function taskOf(msg: string): Pick<PlannedTask, "prompt" | "mode" | "target" | "sections"> | null {
  const t = /^TASK: (.*)$/m.exec(msg)?.[1] ?? "";
  const page = /^Write the page for module (md_\w{8}) .* in section (s6\/\S+)\.$/.exec(t);
  if (page) return { prompt: "gen.module", target: { kind: "module", id: page[1] as string }, sections: [page[2] as SectionId] };
  const parent = /^Write the page for parent module (md_\w{8}) .* in section (s6\/\S+)\./.exec(t);
  if (parent) return { prompt: "gen.parent", target: { kind: "parent", id: parent[1] as string }, sections: [parent[2] as SectionId] };
  if (t.startsWith("Write the opening of the design document"))
    return {
      prompt: "gen.overview",
      mode: t.includes("MODULES is not available") ? "early" : "final",
      target: { kind: "overview", id: "x" },
      sections: ["s0", "s1", "s2"],
    };
  const fixed: [string, GenPromptId, SectionId][] = [
    ["Describe the quality attributes", "gen.quality", "s9"],
    ["Describe the ", "gen.flows", "s3"],
    ["Build the glossary", "gen.glossary", "s12"],
    ["Explain the data model", "gen.datamodel", "s7"],
    ["Recover the main design decisions", "gen.decisions", "s10"],
    ["Summarize risks", "gen.risks", "s11"],
    ["Consolidate the open questions", "gen.questions", "s13"],
    ["Name the modules", "gen.labels", "s5"],
  ];
  for (const [head, prompt, section] of fixed)
    if (t.startsWith(head)) return { prompt, target: { kind: "section", id: section }, sections: prompt === "gen.labels" ? [] : [section] };
  return null;
}

// the index of the repository (line counts, symbol ranges for the V17 gap rule), from an in-process daemon
const home = mkdtempSync(join(tmpdir(), "mitori-replay-"));
const d = await startServerDaemon({ home, port: 0, version: "0.0.0", build: "test", overrides: {} });
const origin = d.url.replace(/\/$/, "");
const api = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const res = await fetch(`${origin}${API_PREFIX}${path}`, {
    method,
    headers: { authorization: `Bearer ${d.token}`, "x-mitori-client": "cli/gen-replay", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
};
const ws = (await api<WorkspaceSummary>("POST", "/workspaces", { target: repo })).info.key;
for (let st = await api<WorkspaceStatus>("GET", `/ws/${ws}`); st.state !== "ready"; st = await api<WorkspaceStatus>("GET", `/ws/${ws}`)) {
  if (st.state === "error") throw new Error(`open failed: ${JSON.stringify(st.lastError)}`);
  await Bun.sleep(20);
}
const ix = (d.handle as unknown as { domain(ws: WorkspaceKey): { indexer: Indexer; staticReady(): Promise<void> } | null }).domain(ws)?.indexer;
if (!ix) throw new Error("no workspace index");
const fileLines = (p: string): number | null => {
  const f = ix.file(p);
  return f && !f.excluded ? f.lines : null;
};

const handle = d.handle as unknown as { anchors: AnchorEngine };
const verifier = createVerifier({
  indexer: ix,
  anchors: handle.anchors,
  hasher: { xxh3: (s: string) => Bun.hash.xxHash3(s).toString(16).padStart(16, "0") } as unknown as Hasher,
  clock: { iso: () => new Date().toISOString() } as unknown as Clock,
});
const l1: Record<L1Result, number> = { pass: 0, fail: 0, vacuous: 0 };
let tasks = 0;
let wouldRetry = 0;
let rejectedLines = 0;
let lines = 0;
const reasons = new Map<string, number>();
for (const f of readdirSync(resolve(a.rec))
  .filter((x) => x.endsWith(".json"))
  .sort()) {
  const rec = JSON.parse(readFileSync(join(resolve(a.rec), f), "utf8")) as { argv: string[]; out: [number, string][]; stdin: string };
  const msg = textOf((JSON.parse(rec.stdin) as { message: { content: unknown } }).message.content);
  const task = taskOf(msg);
  if (!task) continue;
  // the first result of the process is attempt 1 (continuations follow in the same recording)
  let reply: string | null = null;
  for (const [, chunk] of rec.out)
    for (const raw of chunk.split("\n")) {
      if (reply !== null || !raw.startsWith("{")) continue;
      try {
        const ev = JSON.parse(raw) as { type?: string; result?: string };
        if (ev.type === "result") reply = ev.result ?? "";
      } catch {
        /* partial line */
      }
    }
  if (reply === null) continue;
  const spFile = rec.argv[rec.argv.indexOf("--system-prompt-file") + 1] ?? "";
  const sp = existsSync(spFile) ? readFileSync(spFile, "utf8") : "";
  const pack = /<<<DATA \w{8} REPO_PACK>>>\n([\s\S]*?)\n<<<END/.exec(sp)?.[1]?.split("\n") ?? [];
  const planned = { ...task, id: "gt_replay", stage: "S5", deps: [], softDeps: [], model: "claude-sonnet-5-5", effort: "low" } as unknown as PlannedTask;
  const ctx = buildContext(planned, sectionsOf(msg), (a.lang ?? "ja") as DocLang, { fileLines, symbolRanges: (p) => ix.symbols(p) }, [pack]);
  const v = createLineValidator(ctx);
  const verdicts = reply
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l, i) => v.validate(l, i + 1));
  const coverage = v.finish("end");
  const plan = planRetry(verdicts, coverage, 1);
  // L1 of the accepted claims through the current Verifier (current blobs: a pinned checkout, so the same lines)
  for (const vd of verdicts) {
    if (vd.value?.t !== "block") continue;
    const claims = vd.value.claims as GenClaimDraft[];
    const spans = deriveSpans(vd.value.md);
    for (const cl of claims) {
      const span = spans.find((s) => s.n === cl.n) ?? { n: cl.n, start: 0, end: 0, quote: "", identifiers: [] };
      const r = await verifier.stamp(cl.cites, span);
      l1[r.checks.l1]++;
    }
  }
  tasks++;
  lines += verdicts.length;
  const rejected = verdicts.filter((x) => x.errors.length > 0);
  rejectedLines += rejected.length;
  if (plan) wouldRetry++;
  for (const r of rejected)
    for (const e of r.errors) reasons.set(e.expected.split(" ")[0] as string, (reasons.get(e.expected.split(" ")[0] as string) ?? 0) + 1);
  for (const m of plan?.missing ?? []) reasons.set(`missing ${m.replace(/ \(.*$/, "")}`, (reasons.get(`missing ${m.replace(/ \(.*$/, "")}`) ?? 0) + 1);
  if (a.verbose && plan)
    console.log(`${f} ${task.prompt} ${task.target.id}: ${[...plan.errors.map((e) => `${e.at} ${e.expected}`), ...plan.missing].join(" | ")}`);
}
console.log(
  `replayed ${tasks} first replies: ${wouldRetry} would be retried (${tasks ? Math.round((wouldRetry / tasks) * 1000) / 10 : 0} %), ${rejectedLines} of ${lines} lines rejected`,
);
for (const [k, n] of [...reasons].sort((x, y) => y[1] - x[1])) console.log(`  ${k}: ${n}`);
const checked = l1.pass + l1.fail;
console.log(
  `L1 of the first replies' claims: pass ${l1.pass}, fail ${l1.fail}, vacuous ${l1.vacuous} → ${checked ? Math.round((l1.pass / checked) * 1000) / 10 : 0} %`,
);
await d.stop("gen-replay").catch(() => undefined);
rmSync(home, { recursive: true, force: true });
process.exit(0);
