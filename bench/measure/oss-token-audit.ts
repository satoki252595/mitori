// Offline, fresh uncalibrated Muse Pass 1 only. Output contains allowlisted metadata, never prompts/argv/env/paths.

import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { CHARS_PER_TOKEN, type FileClass, type GenRun, INCLUDED_CLASSES, type UsageRecord } from "@mitori/core";
import { CJK_RANGES } from "../../packages/indexer/src/contract.ts";
import { estimateFromCounts, kindOfFile } from "../../packages/indexer/src/tokens/estimate.ts";
import { estimateTokensRaw } from "../../packages/indexer/src/tokens/index.ts";
import type { RecordedProcess } from "./gen-real-record.ts";
import type { TaskRowLite } from "./gen-real-report.ts";

let refusal = "missing, inconsistent or unsupported provenance";
const check: (ok: unknown, message: string) => asserts ok = (ok, message) => {
  if (!ok) {
    refusal = message;
    throw new Error("audit refused");
  }
};
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const read = (path: string) => {
  check(lstatSync(path).isFile() && realpathSync(path) === resolve(path), "regular input required");
  return readFileSync(path, "utf8");
};
const wrapper =
  "Text-only request: do not call tools, read/write files, run commands, delegate, or start reminders. Use only the supplied context and return the requested text/JSON directly. Paths identify proposed edits; do not access them.\n\n";
try {
  const [reportPath, rawDir] = process.argv.slice(2);
  check(reportPath && rawDir && process.argv.length === 4, "usage: oss-token-audit.ts <report.json> <raw-dir>");
  const r = JSON.parse(read(reportPath)) as {
    v: string;
    ws: string;
    run: GenRun;
    records: UsageRecord[];
    tasks: TaskRowLite[];
    sourceSnapshot: { sha: string; indexDigest: string };
    tokenBaseline: { v: string; sha: string; indexDigest: string; tokenizer: string; estimated: boolean; includedClasses: string[]; filteredTokens: number };
  };
  const b = r.tokenBaseline,
    run = r.run;
  const started = Date.parse(run.startedAt ?? ""),
    finished = Date.parse(run.finishedAt ?? "");
  check(Number.isFinite(started) && Number.isFinite(finished) && started <= finished, "run timestamps required");
  check(
    r.v === "mitori.gen-real/1" &&
      run.engine === "generic" &&
      run.effort === "standard" &&
      run.state === "done" &&
      run.trigger === "user" &&
      run.scope.length === 0,
    "fresh standard run required",
  );
  check(
    b.v === "mitori.token-baseline/1" && b.tokenizer === "claude-v5" && b.estimated === true && Number.isSafeInteger(b.filteredTokens) && b.filteredTokens > 0,
    "known denominator required",
  );
  check(/^ws_[a-z0-9]+$/.test(r.ws) && /^gr_[a-z0-9]+$/.test(run.id), "invalid run identifiers");
  check(
    b.sha === r.sourceSnapshot.sha && /^[a-f0-9]{40}$/.test(b.sha) && b.indexDigest === r.sourceSnapshot.indexDigest && b.indexDigest === run.pinned?.snapshot,
    "baseline provenance mismatch",
  );
  check([...b.includedClasses].sort().join() === [...INCLUDED_CLASSES].sort().join(), "denominator classes mismatch");
  const raws = readdirSync(rawDir)
    .filter((f) => /^\d+\.json$/.test(f))
    .sort()
    .map((f) => ({ n: Number(f.slice(0, -5)), rec: JSON.parse(read(join(rawDir, f))) as RecordedProcess }));
  check(raws.length > 0 && raws.length === r.records.length && r.tasks.length === run.progress.total && run.progress.failed === 0, "incomplete calls");
  const value = (rec: RecordedProcess, flag: string) => {
    check(rec.argv.filter((x) => x === flag).length === 1, "missing or duplicate native flag");
    return rec.argv[rec.argv.indexOf(flag) + 1] as string;
  };
  const first = raws[0];
  check(first, "missing native call");
  const firstPrompt = value(first.rec, "--prompt-file");
  check(basename(firstPrompt) === `${hash(read(firstPrompt)).slice(0, 32)}.txt`, "prompt hash mismatch");
  const home = dirname(dirname(dirname(firstPrompt)));
  const db = new Database(join(home, "repos", r.ws, "index.sqlite"), { readonly: true });
  const state = new Database(join(home, "state.sqlite"), { readonly: true });
  const snapshot = db.query<{ sha: string; digest: string }, []>('SELECT "commit" sha, index_digest digest FROM idx_snapshots ORDER BY id DESC LIMIT 1').get();
  check(snapshot?.sha === b.sha && snapshot.digest === b.indexDigest, "live index provenance mismatch");
  check(state.query<{ n: number }, []>("SELECT COUNT(*) n FROM use_calibration").get()?.n === 0, "calibrated input unsupported");
  const stored = db.query<{ pinned: string; index_digest: string }, [string]>("SELECT pinned,index_digest FROM gen_runs WHERE id=?").get(run.id);
  check(stored?.index_digest === b.indexDigest && JSON.parse(stored.pinned).systemHash === run.pinned?.systemHash, "run hash mismatch");
  const files = db
    .query<{ path: string; class: FileClass; chars: number; cjk: number }, []>(
      "SELECT f.path,f.class,b.chars,b.cjk FROM idx_files f JOIN idx_blobs b ON f.blob=b.blob",
    )
    .all();
  check(
    db.query<{ n: number }, []>("SELECT COUNT(*) n FROM (SELECT blob FROM idx_blobs GROUP BY blob HAVING COUNT(*)>1)").get()?.n === 0,
    "ambiguous blob counter",
  );
  const denominator = files
    .filter((f) => (INCLUDED_CLASSES as readonly string[]).includes(f.class))
    .reduce((n, f) => n + estimateFromCounts(f.chars, f.cjk, kindOfFile(f.path, f.class, f.chars, f.cjk), "claude-v5"), 0);
  check(denominator === b.filteredTokens, "denominator replay mismatch");
  const tasks = db
    .query<{ id: string; prompt: string; target_id: string; sections: string; state: string; attempt: number }, [string]>(
      "SELECT id,prompt,target_id,sections,state,attempt FROM gen_tasks WHERE run=?",
    )
    .all(run.id);
  check(
    tasks.length === r.tasks.length &&
      new Set(r.tasks.map((t) => t.id)).size === tasks.length &&
      tasks.every((t) => t.state === "done" && t.attempt === 1 && r.tasks.some((rt) => rt.id === t.id && rt.state === t.state)),
    "fresh task set required",
  );
  const counterSource = ["packages/indexer/src/tokens/index.ts", "packages/indexer/src/tokens/ceil.ts", "packages/indexer/src/tokens/estimate.ts"]
    .map((p) => read(join(import.meta.dir, "../..", p)))
    .join("\n");
  const counter = {
    version: "mitori.claude-v5-raw@1",
    tokenizer: "claude-v5",
    serializedKind: "code",
    calibration: "none",
    implementationSha256: hash(counterSource + JSON.stringify([CHARS_PER_TOKEN["claude-v5"], CJK_RANGES])),
  };
  const used = new Set<string>();
  const proof = raws.map(({ n, rec }) => {
    const path = value(rec, "--prompt-file"),
      text = read(path),
      utf8Bytes = new TextEncoder().encode(text).byteLength,
      inputSha256 = hash(text);
    check(dirname(dirname(dirname(path))) === home && basename(path) === `${inputSha256.slice(0, 32)}.txt`, "prompt hash mismatch");
    const pack = /<<<DATA ([0-9a-hjkmnp-tv-z]{8}) REPO_PACK>>>\n[\s\S]*?\n<<<END \1>>>/.exec(text);
    check(text.startsWith(wrapper) && pack && hash(text.slice(wrapper.length, pack.index + pack[0].length)) === run.pinned?.systemHash, "system hash mismatch");
    const matches = r.records.filter((x) => x.ws === r.ws && x.scope.kind === "gen_task" && x.usage.in === utf8Bytes && tasks.some((t) => t.id === x.scope.id));
    const record = matches[0];
    check(matches.length === 1 && record, "ambiguous ledger input");
    const task = tasks.find((t) => t.id === record.scope.id);
    check(task, "missing task");
    check(/^us_[a-z0-9]+$/.test(record.id) && /^gt_[a-z0-9]+$/.test(task.id) && /^gen\.[a-z]+$/.test(task.prompt), "invalid call identifiers");
    check(
      !used.has(record.id) && record.usageEstimated === true && record.outcome === "ok" && record.usage.cacheRead === 0 && record.usage.cacheWrite === 0,
      "ledger provenance mismatch",
    );
    check(
      record.promptId === task.prompt && record.model === `generic:${value(rec, "--model")}` && rec.exit === 0 && rec.stdin === "" && rec.writes.length === 0,
      "native call mismatch",
    );
    check(Date.parse(record.at) >= started && Date.parse(record.at) <= finished, "ledger outside run");
    const line = text.split("\n").find((l) => l.startsWith("TASK:"));
    check(
      task.prompt !== "gen.module" ||
        (line?.startsWith(`TASK: Write the page for module ${task.target_id} (`) && line.endsWith(`) in section ${JSON.parse(task.sections)[0]}.`)),
      "module target mismatch",
    );
    used.add(record.id);
    return {
      recording: n,
      run: run.id,
      task: task.id,
      usageRecord: record.id,
      prompt: task.prompt,
      inputSha256,
      utf8Bytes,
      tokens: estimateTokensRaw(text, "code", "claude-v5"),
      verified: true,
    };
  });
  check(used.size === r.records.length && r.tasks.every((t) => used.has(r.records.find((x) => x.scope.id === t.id)?.id ?? "")), "task coverage mismatch");
  const byteInputs = proof.reduce((n, p) => n + p.utf8Bytes, 0),
    serializedTokenEstimate = proof.reduce((n, p) => n + p.tokens, 0);
  console.log(
    JSON.stringify(
      {
        v: "mitori.oss-token-comparable/1",
        run: run.id,
        source: { sha: b.sha, indexDigest: b.indexDigest },
        counter,
        calls: proof.length,
        byteInputs,
        serializedTokenEstimate,
        filteredTokens: denominator,
        estimateRatio: serializedTokenEstimate / denominator,
        target: 0.5,
        limit: 0.6,
        estimated: true,
        providerExact: "unmeasured",
        originalByteRatio: byteInputs / denominator,
        proof,
      },
      null,
      2,
    ),
  );
  db.close();
  state.close();
} catch {
  console.error(`Token audit refused: ${refusal} (no private input details emitted).`);
  process.exitCode = 1;
}
