/**
 * `mitori gen` (loop spec §10.5, gen spec §8.4, gL-7):
 * - `gen [--effort E] [--scope s…]` — push generation with mitori's engine: estimate, show it, confirm on a TTY (refused
 *   under CLAUDECODE / CODEX_* with `E_TTY_REQUIRED`, exit 2 — a run spends the user's quota) [CONS-21, SEC-04];
 * - `gen --prep [--effort E] [--scope s…] [--continue <pr>]` — the session engine's packet: four lines, the agent reads
 *   the README it names (mitori makes no API call);
 * - `gen --ingest <pr> [--partial] [--model <id>]` — reads `<dir>/fingerprint` (the agent never handles it) and takes in
 *   `out/*.ndjson`; exit 0 all valid / 1 errors (fix, re-run) / 3 expired packet or fingerprint mismatch.
 */
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { Effort, GenEstimate, IngestReport, ModelId, PrepId, SectionId } from "@mitori/core";
import { MitoriError } from "@mitori/core";
import { oneOf, parse } from "./args.ts";
import { errorLines } from "./check.ts";
import { helpLang } from "./help.ts";
import { CliExit, type Io, usage } from "./io.ts";
import { PULL_EXIT } from "./loop-contract.ts";
import { connectWorkspace, requireTty } from "./session.ts";
import { docDirOf, real, whenReady } from "./workspace.ts";

const EFFORTS = ["overview", "standard", "complete"] as const;
const PREP_RE = /^pr_[0-9a-z]{8}$/;

const prepArg = (raw: string | undefined, flag: string): PrepId => {
  if (raw === undefined || !PREP_RE.test(raw)) throw usage(`${flag} needs a packet id (pr_…)`, "mitori gen --help");
  return raw as PrepId;
};

/** `mitori.prep/1` header block (spec §10.5). */
export function prepText(p: { id: string; tasks: number; expiresAt: string; dir: string; readme: string }): string {
  return `mitori.prep/1 id=${p.id} tasks=${p.tasks} expires=${p.expiresAt}\ndir: ${p.dir}\nreadme: ${p.readme}\nNEXT: mitori gen --ingest ${p.id}\n`;
}

/** Summary of an IngestReport: counts, ≤ 20 CheckError lines, missing tasks, then the NEXT phase. */
export function ingestText(r: IngestReport): string {
  let t = `mitori.ingest/1 prep=${r.prep} ok=${r.ok} tasks=${r.accepted.tasks} blocks=${r.accepted.blocks} claims=${r.accepted.claims} coverage=${Math.round(r.coveragePct)}%\n`;
  t += errorLines(r.errors);
  if (r.missing.length > 0) t += `missing: ${r.missing.slice(0, 20).join(" ")}${r.missing.length > 20 ? ` … ${r.missing.length - 20} more` : ""}\n`;
  if (r.next) t += `NEXT: mitori gen --prep --continue ${r.next.prep}\n`;
  return t;
}

/** Human summary of a generation estimate (localized: only a person at a terminal reads it). */
export function estimateText(e: GenEstimate, lang: "ja" | "en"): string {
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n));
  const tokens = k(e.inTokens + e.cacheReadTokens + e.cacheWriteTokens + e.outTokens);
  const min = Math.max(1, Math.round(e.seconds.p50 / 60));
  const billed = e.billing === "metered-api" || e.billing === "overage";
  const jaBilling = e.billing === "unknown" ? "（課金形態はプロバイダーによります）" : billed ? "（課金されます）" : "（サブスクの枠内）";
  const enBilling = e.billing === "unknown" ? " (billing depends on the provider)" : billed ? " (billed)" : " (within the subscription)";
  if (lang === "ja") return `見積り: ${e.effort} · 約 ${tokens} token · API 換算 $${e.apiUsd.toFixed(2)}${jaBilling} · 約 ${min} 分 · ${e.engine}\n`;
  return `estimate: ${e.effort} · ≈${tokens} tokens · API-equivalent $${e.apiUsd.toFixed(2)}${enBilling} · ≈${min} min · ${e.engine}\n`;
}

export async function run(io: Io): Promise<number> {
  const { values, positionals } = parse(
    io.argv,
    {
      repo: { type: "string" },
      prep: { type: "boolean" },
      ingest: { type: "string" },
      continue: { type: "string" },
      effort: { type: "string" },
      scope: { type: "string", multiple: true },
      partial: { type: "boolean" },
      model: { type: "string" },
    },
    "gen",
  );
  if (positionals.length > 0) throw usage(`unexpected argument ${positionals[0]}`, "mitori gen --help");
  if (values.repo !== undefined) {
    const cwd = real(resolve(io.cwd, values.repo));
    try {
      if (!values.repo.trim() || !statSync(cwd).isDirectory()) throw new Error("not a directory");
    } catch {
      throw usage("--repo must name an existing directory");
    }
    io = { ...io, cwd };
  }
  const effort: Effort = oneOf(values.effort, EFFORTS, "effort", "gen") ?? "standard";
  const scope = (values.scope ?? []) as SectionId[];

  if (values.ingest !== undefined) {
    if (values.prep) throw usage("--prep and --ingest are separate steps", "mitori gen --help");
    const prep = prepArg(values.ingest, "--ingest");
    const s = await connectWorkspace(io);
    const dir = `${docDirOf(s.ws.info)}/tmp/prep/${prep}`;
    let fingerprint: string;
    try {
      fingerprint = readFileSync(`${dir}/fingerprint`, "utf8").trim();
    } catch {
      throw new CliExit(PULL_EXIT.expired, new MitoriError("E_GEN_FINGERPRINT", `no fingerprint in ${dir}`), "run `mitori gen --prep` again");
    }
    let report: IngestReport;
    try {
      report = await whenReady(io, () =>
        s.api.call("POST /ws/:ws/gen/ingest", {
          params: { ws: s.ws.info.key },
          body: { prep, fingerprint, partial: values.partial === true, ...(values.model ? { model: values.model as ModelId } : {}) },
        }),
      );
    } catch (e) {
      const m = MitoriError.from(e);
      if (m.code === "E_GEN_PREP_EXPIRED" || m.code === "E_GEN_FINGERPRINT") throw new CliExit(PULL_EXIT.expired, m, "run `mitori gen --prep` again");
      throw m;
    }
    io.out(ingestText(report));
    return report.ok ? PULL_EXIT.ok : PULL_EXIT.errors;
  }

  if (values.prep) {
    const s = await connectWorkspace(io);
    const info = await whenReady(io, () =>
      s.api.call("POST /ws/:ws/gen/prep", {
        params: { ws: s.ws.info.key },
        body: {
          effort,
          ...(scope.length ? { scope } : {}),
          ...(values.continue !== undefined ? { continueFrom: prepArg(values.continue, "--continue") } : {}),
        },
      }),
    );
    io.out(prepText(info));
    return PULL_EXIT.ok;
  }

  if (values.continue !== undefined || values.partial || values.model)
    throw usage("--continue / --partial / --model belong to --prep / --ingest", "mitori gen --help");
  const lang = helpLang(io.env);
  requireTty(io, "mitori gen", "start the generation from the browser, or use `mitori gen --prep` from an agent session");
  const s = await connectWorkspace(io);
  const ws = s.ws.info.key;
  const est = await whenReady(io, () => s.api.call("POST /ws/:ws/gen/estimate", { params: { ws }, body: { effort, ...(scope.length ? { scope } : {}) } }));
  io.err(estimateText(est, lang));
  if (!(await io.confirm(lang === "ja" ? "生成を始めますか？" : "Start the generation?"))) {
    io.err(lang === "ja" ? "中止しました\n" : "cancelled\n");
    return 1;
  }
  const run = await s.api.call("POST /ws/:ws/gen/runs", { params: { ws }, body: { estimateId: est.id, confirm: true } });
  io.out(`${run.id} ${run.state} ${s.daemon.origin}/w/${ws}/gen?run=${run.id}\n`);
  return 0;
}
